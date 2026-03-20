/**
 * Gemini API client for TERROIR
 *
 * Wraps Gemini 2.5 Flash for bulk ontology extraction from documents.
 * Uses the same output shape as extract.ts so callers are interchangeable.
 *
 * Gemini is used for:
 *  - Large documents (PDFs, DOCX) where its 1M context window helps
 *  - Batch extraction where cost matters (~10x cheaper than Sonnet)
 *
 * Claude Sonnet stays for the interactive chat loop (tools + conversation).
 */

import type {
  GraphState,
  GraphNode,
  Relationship,
  TensionMarker,
  AbstractionLayer,
  ProjectBrief,
  SynthesisResult,
  DocumentClassification,
} from "@/types";
import { v4 as uuidv4 } from "uuid";
import { ensureTypeExists } from "./entity-types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = "gemini-2.5-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface GeminiExtractionResult {
  updatedGraph: GraphState;
  graphUpdates: { type: string; label: string }[];
}

// ── Extraction prompt ────────────────────────────────────────────────────────
//
// Builds an extraction prompt tuned to the project's abstraction layer.
// Three layers correspond to three different "lenses" on the same document:
//
//   domain_objects       — focus on NOUNS: what exists in this org
//   interaction_patterns — focus on VERBS: how work actually moves
//   concerns_themes      — focus on ADJECTIVES: what matters and why
//
// Backwards compatible: no layer = original "extract comprehensively" behaviour.

function buildExtractionPrompt(
  text: string,
  graphState: GraphState,
  abstractionLayer?: AbstractionLayer,
  projectBrief?: ProjectBrief
): string {
  // Build the existing-graph context block (dedup guard)
  const existingContext =
    graphState.nodes.length > 0
      ? `\n\nExisting entities already in the graph (avoid duplicates, connect to these where relevant):\n${graphState.nodes
          .map((n) => `- "${n.label}" (${n.type}) [id: ${n.id}]`)
          .join(
            "\n"
          )}\n\nExisting entity types: ${graphState.entityTypes.map((t) => t.id).join(", ")}`
      : "";

  // Build the project context block (when a brief is available)
  const projectContext =
    projectBrief
      ? `\n\nPROJECT CONTEXT (use this to calibrate extraction focus):
- Sector: ${projectBrief.sector ?? "not specified"}
- Org size: ${projectBrief.orgSize ?? "not specified"}
- Discovery goal: ${projectBrief.discoveryGoal ?? "not specified"}
- Key themes to watch for: ${(projectBrief.keyThemes ?? []).join(", ") || "none"}`
      : "";

  // ── Abstraction-layer-specific extraction instructions ──────────────────────

  let focusInstructions: string;

  switch (abstractionLayer) {
    case "domain_objects":
      focusInstructions = `ABSTRACTION LAYER: Domain Objects (nouns)
Your focus is on WHAT EXISTS in this organisation.

Extract:
1. ENTITIES — systems, tools, platforms, teams, roles, documents, products, processes, standards. Prioritise concrete things over abstract concepts.
2. OWNERSHIP / MEMBERSHIP — who owns, uses, or is responsible for what.
3. DEPENDENCIES — what needs what to function.
4. TENSIONS — conflicting ownership, duplicate tools, unclear accountability.
5. EVALUATIVE SIGNALS — what the org values or fears losing.

Entity types should be noun-oriented: system, team, role, document, platform, product, standard, etc.`;
      break;

    case "interaction_patterns":
      focusInstructions = `ABSTRACTION LAYER: Interaction Patterns (verbs)
Your focus is on HOW WORK ACTUALLY MOVES in this organisation.

Extract:
1. WORKFLOWS — named processes, recurring flows, sequences of steps.
2. HANDOFFS — who passes what to whom, and under what conditions.
3. COMMUNICATION PATHS — how information travels, sync vs async, channels used.
4. DEPENDENCIES — what blocks what, what gates what, who needs what from whom.
5. TENSIONS — bottlenecks, broken handoffs, unclear ownership of transitions.
6. EVALUATIVE SIGNALS — what people value or fear about how work moves.

Entity types should be verb-oriented: workflow, handoff, communication, dependency, gate, blocker, channel, etc.`;
      break;

    case "concerns_themes":
      focusInstructions = `ABSTRACTION LAYER: Concerns and Themes (adjectives / values)
Your focus is on WHAT MATTERS AND WHY in this organisation.

Extract:
1. VALUES — what the organisation or individuals explicitly care about protecting or achieving.
2. TENSIONS — competing values, strategic contradictions, cultural friction.
3. THEMES — recurring concerns, shared anxieties, strategic priorities.
4. SIGNALS — things people are moving toward or away from.
5. STAKES — what people believe is at risk, what they're trying to preserve.

Entity types should be value/theme-oriented: value, concern, tension, theme, priority, risk, aspiration, etc.
Focus on the evaluative layer — what things mean to people, not just what they are.`;
      break;

    default:
      // Original behaviour — extract comprehensively across all layers
      focusInstructions = `Your task:
1. FIND all meaningful entities (concepts, organisations, platforms, processes, roles, documents, goals, values, products, etc.)
2. CLASSIFY each with an appropriate type. Types are emergent — use what fits the domain. Reuse existing types where appropriate.
3. RELATE entities to each other with descriptive relationship types.
4. FLAG tensions or conflicts between entities.
5. NOTE evaluative signals — what the organisation values, fears, or is moving toward.

Extract COMPREHENSIVELY — capture every meaningful entity and relationship.`;
  }

  return `You are TERROIR's extraction engine. Extract a structured knowledge graph from the document below.

${focusInstructions}

CRITICAL: Do NOT create duplicate entities. Check the existing graph context below.
${existingContext}${projectContext}

Respond with valid JSON ONLY — no markdown, no code blocks:
{
  "entities": [
    { "label": "string", "type": "string", "description": "string" }
  ],
  "relationships": [
    { "source_label": "string", "target_label": "string", "type": "string", "description": "string" }
  ],
  "tensions": [
    { "description": "string", "related_labels": ["string"] }
  ],
  "evaluative_signals": [
    { "label": "string", "direction": "toward|away_from|protecting", "strength": 1, "source": "string" }
  ]
}

DOCUMENT:
${text}`;
}

// ── Gemini REST call ─────────────────────────────────────────────────────────

async function callGemini(prompt: string, maxOutputTokens = 16384): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

// ── Graph assembly (mirrors extract.ts logic) ────────────────────────────────

function assembleGraph(
  extracted: {
    entities?: { label: string; type: string; description: string }[];
    relationships?: { source_label: string; target_label: string; type: string; description?: string }[];
    tensions?: { description: string; related_labels: string[] }[];
    evaluative_signals?: { label: string; direction: string; strength: number; source: string }[];
  },
  graphState: GraphState
): GeminiExtractionResult {
  let currentGraph = structuredClone(graphState);
  const updates: { type: string; label: string }[] = [];

  // Build label→id map from existing nodes
  const labelToId: Record<string, string> = {};
  for (const node of currentGraph.nodes) {
    labelToId[node.label.toLowerCase()] = node.id;
  }

  // Create entities
  let col = 0, row = 0;
  for (const entity of extracted.entities ?? []) {
    if (!entity.label) continue;
    const existingId = labelToId[entity.label.toLowerCase()];
    if (existingId) continue; // dedup

    const id = uuidv4();
    const position = { x: 150 + col * 250, y: 150 + row * 200 };
    col++;
    if (col >= 4) { col = 0; row++; }

    const node: GraphNode = {
      id,
      label: entity.label,
      type: entity.type || "concept",
      description: entity.description || "",
      position,
    };

    currentGraph = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, node],
      entityTypes: ensureTypeExists(currentGraph.entityTypes, node.type),
    };

    labelToId[entity.label.toLowerCase()] = id;
    updates.push({ type: "node_created", label: entity.label });
  }

  // Create relationships
  for (const rel of extracted.relationships ?? []) {
    const sourceId = rel.source_label ? labelToId[rel.source_label.toLowerCase()] : undefined;
    const targetId = rel.target_label ? labelToId[rel.target_label.toLowerCase()] : undefined;
    if (!sourceId || !targetId) continue;

    const relationship: Relationship = {
      id: uuidv4(),
      sourceId,
      targetId,
      type: rel.type || "related_to",
      description: rel.description,
    };

    currentGraph = {
      ...currentGraph,
      relationships: [...currentGraph.relationships, relationship],
    };
    updates.push({ type: "relationship_created", label: `${rel.source_label} → ${rel.target_label}` });
  }

  // Create tensions
  for (const t of extracted.tensions ?? []) {
    const relatedIds = (t.related_labels ?? [])
      .map((label) => labelToId[label?.toLowerCase()])
      .filter(Boolean) as string[];

    if (relatedIds.length > 0) {
      const tension: TensionMarker = {
        id: uuidv4(),
        description: t.description,
        relatedNodeIds: relatedIds,
        status: "unresolved",
      };
      currentGraph = { ...currentGraph, tensions: [...currentGraph.tensions, tension] };
      updates.push({ type: "tension_flagged", label: t.description });
    }
  }

  // Create evaluative signals (dedup by label)
  for (const s of extracted.evaluative_signals ?? []) {
    if (!s.label) continue;
    const existing = currentGraph.evaluativeSignals.find(
      (e) => e.label.toLowerCase() === s.label.toLowerCase()
    );
    if (!existing) {
      currentGraph = {
        ...currentGraph,
        evaluativeSignals: [
          ...currentGraph.evaluativeSignals,
          {
            id: uuidv4(),
            label: s.label,
            direction: (s.direction as "toward" | "away_from" | "protecting") || "toward",
            strength: s.strength || 3,
            sourceDescription: s.source || "Extracted from document",
          },
        ],
      };
      updates.push({ type: "evaluative_signal_set", label: s.label });
    }
  }

  return { updatedGraph: currentGraph, graphUpdates: updates };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extracts an ontology from document text using Gemini 2.5 Flash.
 *
 * @param text            Raw document text to extract from
 * @param graphState      Current graph state (for dedup context)
 * @param abstractionLayer Optional lens: domain_objects | interaction_patterns | concerns_themes
 * @param projectBrief    Optional project brief for calibrating extraction focus
 *
 * Backwards compatible: omit abstractionLayer to use the original
 * "extract comprehensively" behaviour.
 */
export async function extractOntologyWithGemini(
  text: string,
  graphState: GraphState,
  abstractionLayer?: AbstractionLayer,
  projectBrief?: ProjectBrief
): Promise<GeminiExtractionResult> {
  const prompt  = buildExtractionPrompt(text, graphState, abstractionLayer, projectBrief);
  const rawJson = await callGemini(prompt);

  let extracted;
  try {
    extracted = JSON.parse(rawJson);
  } catch {
    console.error("Gemini returned invalid JSON:", rawJson.slice(0, 200));
    return { updatedGraph: graphState, graphUpdates: [] };
  }

  return assembleGraph(extracted, graphState);
}

// ── Document classification ──────────────────────────────────────────────────
//
// Pre-classification step: Gemini evaluates each document and assigns a verdict
// (EXTRACT, CAUTION, SKIP) based on genre and content quality. Batch call —
// all documents classified in a single Gemini request.

function buildClassificationPrompt(
  documents: { index: number; title: string; preview: string }[],
  brief?: ProjectBrief
): string {
  const briefSection = brief
    ? `PROJECT CONTEXT:
- Sector: ${brief.sector ?? "not specified"}
- Org size: ${brief.orgSize ?? "not specified"}
- Discovery goal: ${brief.discoveryGoal ?? "not specified"}
- Key themes: ${(brief.keyThemes ?? []).join(", ") || "none"}
- Abstraction layer: ${brief.abstractionLayer}`
    : "";

  const docList = documents
    .map((d) => `--- DOCUMENT ${d.index}: "${d.title}" ---\n${d.preview}`)
    .join("\n\n");

  return `You are TERROIR's document classifier. Evaluate each document and decide whether it should be EXTRACTED into the knowledge graph, treated with CAUTION, or SKIPPED entirely.

${briefSection}

CLASSIFICATION RULES:

EXTRACT — high value for organisational intelligence:
- Process documentation, SOPs, strategy documents
- Interview transcripts, meeting notes, workshop outputs
- Org charts, team structures, role descriptions
- Content describing workflows, handoffs, dependencies, decisions
- Content revealing values, tensions, fears, or strategic priorities
- Partner/professional portal content showing operational relationships

CAUTION — may contain useful signals but is heavily curated:
- Marketing materials, press releases, annual reports
- Product catalogues (useful for domain vocabulary, not relationships)
- About/mission pages (aspirational, not necessarily operational)

SKIP — noise that pollutes the graph:
- Legal boilerplate: terms and conditions, cookie policies, privacy notices
- DSGVO/GDPR compliance text, liability disclaimers, IP notices
- Navigation artefacts: menus, footers, breadcrumbs, button labels, login pages
- Generic compliance text (identifiable by: passive voice, enumerated clauses, regulatory citations)

Also check for DUPLICATES — documents with the same or near-identical content under different names.

DOCUMENTS TO CLASSIFY (${documents.length} total):
${docList}

Return valid JSON — no markdown, no code blocks:
{
  "classifications": [
    {
      "documentIndex": number,
      "title": "string",
      "verdict": "EXTRACT" | "CAUTION" | "SKIP",
      "genre": "string (e.g. legal, marketing, operational, interview, compliance, navigation)",
      "confidence": number (0-1),
      "reason": "one sentence explaining why",
      "isDuplicate": boolean,
      "duplicateOf": "string or null"
    }
  ]
}`;
}

/**
 * Batch-classifies documents before extraction using Gemini.
 *
 * Sends document titles + first ~2000 chars as previews in a single call.
 * Gemini's 1M context handles large batches natively.
 *
 * @param documents  Array of { index, title, preview } — preview is first ~2000 chars
 * @param brief      Optional project brief for context (sector, goal, themes)
 * @returns          Array of classifications (one per document)
 */
export async function classifyDocuments(
  documents: { index: number; title: string; preview: string }[],
  brief?: ProjectBrief
): Promise<DocumentClassification[]> {
  if (documents.length === 0) return [];

  const prompt  = buildClassificationPrompt(documents, brief);
  const rawJson = await callGemini(prompt, 8192);

  let parsed: { classifications: DocumentClassification[] };
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    console.error("[classify] Gemini returned invalid JSON:", rawJson.slice(0, 200));
    // Fallback: classify everything as EXTRACT (safe default — current behaviour)
    return documents.map((d) => ({
      documentIndex: d.index,
      title:         d.title,
      verdict:       "EXTRACT" as const,
      genre:         "unknown",
      confidence:    0,
      reason:        "Classification failed — defaulting to extract",
    }));
  }

  return parsed.classifications ?? [];
}

// ── Synthesis prompt ──────────────────────────────────────────────────────────
//
// Sends the full document corpus + graph state to Gemini in a single call.
// Gemini's 1M context window handles large corpora natively — no chunking,
// no pre-summarisation, no context guard needed.

function buildSynthesisPrompt(
  graphState: GraphState,
  documents: { id: string; title: string; content: string }[],
  brief?: ProjectBrief
): string {
  const briefSection = brief
    ? `PROJECT BRIEF:
  Sector: ${brief.sector ?? "not specified"}
  Org size: ${brief.orgSize ?? "not specified"}
  Discovery goal: ${brief.discoveryGoal ?? "not specified"}
  Abstraction layer: ${brief.abstractionLayer}
  Key themes: ${(brief.keyThemes ?? []).join(", ") || "none"}
  Summary: ${brief.summary ?? "none"}`
    : "PROJECT BRIEF: not set (general extraction mode)";

  const graphSection = [
    `EXISTING KNOWLEDGE GRAPH:`,
    `Nodes (${graphState.nodes.length}):`,
    ...graphState.nodes.map((n) => `  - "${n.label}" [${n.type}]: ${n.description}`),
    "",
    `Relationships (${graphState.relationships.length}):`,
    ...graphState.relationships.map((r) => {
      const src = graphState.nodes.find((n) => n.id === r.sourceId)?.label ?? r.sourceId;
      const tgt = graphState.nodes.find((n) => n.id === r.targetId)?.label ?? r.targetId;
      return `  - "${src}" ${r.type} "${tgt}"`;
    }),
    "",
    `Unresolved tensions (${graphState.tensions.filter((t) => t.status === "unresolved").length}):`,
    ...graphState.tensions
      .filter((t) => t.status === "unresolved")
      .map((t) => `  - ${t.description}`),
    "",
    `Evaluative signals (${graphState.evaluativeSignals.length}):`,
    ...graphState.evaluativeSignals.map(
      (s) => `  - "${s.label}" (${s.direction}, strength: ${s.strength}/5)`
    ),
  ].join("\n");

  const docSections = documents
    .map((doc, i) => `--- DOCUMENT ${i + 1}: "${doc.title}" ---\n${doc.content}`)
    .join("\n\n");

  return `You are TERROIR's synthesis engine. Read across all ${documents.length} documents and the knowledge graph to surface cross-source patterns that no single source reveals on its own.

${briefSection}

${graphSection}

DOCUMENTS TO SYNTHESISE (${documents.length} sources):
${docSections}

YOUR FOUR TASKS:

1. TERM COLLISIONS — the same concept called different names across sources. Suggest a canonical term.

2. CONNECTING THREADS — recurring themes or structural patterns that span multiple sources.

3. SIGNAL CONVERGENCE — places where sources agree or disagree on something evaluative (values, fears, priorities).

4. GRAPH GAPS — meaningful concepts in the documents but absent or underrepresented in the graph. For each gap, suggest an exact follow-up question the consultant should ask.

Return valid JSON matching this schema exactly — no markdown, no code blocks:
{
  "narrativeSummary": "string — 2-3 paragraphs describing the key cross-source findings",
  "termCollisions": [
    { "variants": ["string"], "sources": ["document title"], "suggestedCanonical": "string", "context": "string" }
  ],
  "connectingThreads": [
    { "theme": "string", "description": "string", "relatedSources": ["document title"], "relatedNodeIds": ["string"] }
  ],
  "signalConvergence": [
    { "signal": "string", "convergenceType": "agreement|disagreement|partial", "sources": ["document title"], "description": "string" }
  ],
  "graphGaps": [
    { "description": "string", "suggestedQuestion": "string", "relatedNodeIds": ["string"] }
  ]
}`;
}

/**
 * Runs cross-source synthesis across all documents using Gemini 2.5 Flash.
 *
 * Gemini's 1M token context window handles large corpora natively — no
 * chunking, pre-summarisation, or context guard needed. Replaces the
 * former Haiku synthesis which failed at scale (>10 documents).
 *
 * @param graphState  Current in-memory graph (nodes, relationships, tensions, signals)
 * @param documents   All project documents with their full text content
 * @param brief       Optional project brief for calibrating synthesis focus
 */
export async function runGeminiSynthesis(
  graphState: GraphState,
  documents: { id: string; title: string; content: string }[],
  brief?: ProjectBrief
): Promise<SynthesisResult> {
  if (documents.length === 0) {
    throw new Error("[gemini] Cannot synthesise: no documents provided");
  }

  const prompt  = buildSynthesisPrompt(graphState, documents, brief);
  // 32k output tokens — synthesis across 44 docs may produce substantial JSON
  const rawJson = await callGemini(prompt, 32768);

  let parsed: Omit<SynthesisResult, "documentCount" | "generatedAt">;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    console.error("[gemini] Synthesis returned invalid JSON:", rawJson.slice(0, 300));
    parsed = {
      narrativeSummary:
        "Synthesis could not be parsed. Please try again — the model may have returned malformed output.",
      termCollisions:    [],
      connectingThreads: [],
      signalConvergence: [],
      graphGaps:         [],
    };
  }

  return {
    ...parsed,
    documentCount: documents.length,
    generatedAt:   new Date().toISOString(),
  };
}
