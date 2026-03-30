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
  AttractorPreset,
  ProjectBrief,
  SynthesisResult,
  DocumentClassification,
  CompactEntity,
  MergeGroup,
  CrossDocRelationship,
  AttractorReassignment,
} from "@/types";
import { v4 as uuidv4 } from "uuid";
import { HUB_RELATIONSHIP_TYPE } from "@/types";
import { ensureTypeExists, getAttractorsForPreset, getHubNodes, findHubByAttractorId } from "./entity-types";

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

  // Build hub instruction block — tell Gemini about available hubs
  const hubNodes = getHubNodes(graphState);
  let hubInstructions: string;

  if (hubNodes.length > 0) {
    // Use actual hub nodes from the graph
    const hubList = hubNodes
      .map((h) => `  - "${h.properties?.attractor_id ?? h.label.toLowerCase()}" (hub: "${h.label}") — ${h.description}`)
      .join("\n");
    hubInstructions = `
HUB CATEGORIES (structural scaffolding — these are real nodes in the graph):
Each entity MUST be assigned a "hub" from this list. The hub indicates which structural category the entity belongs to. If unsure, use "emergent".
${hubList}

The "type" field is a separate freeform descriptive tag (e.g. "concept", "role", "workflow"). Both fields are required.`;
  } else {
    // Fallback: use preset config (for projects without seeded hubs yet)
    const preset = (projectBrief as unknown as Record<string, unknown>)?.attractorPreset as AttractorPreset | undefined;
    const attractors = getAttractorsForPreset(preset ?? 'startup');
    const attractorList = attractors
      .map((a) => `  - "${a.id}" — ${a.description}`)
      .join("\n");
    hubInstructions = `
HUB CATEGORIES (structural scaffolding):
Each entity MUST be assigned a "hub" from this list. The hub indicates where the entity fits in the ontological structure. If unsure, use "emergent".
${attractorList}

The "type" field is a separate freeform descriptive tag (e.g. "concept", "role", "workflow"). Both fields are required.`;
  }

  return `You are TERROIR's extraction engine. Extract a structured knowledge graph from the document below.

${focusInstructions}
${hubInstructions}

CRITICAL: Do NOT create duplicate entities. Check the existing graph context below.
${existingContext}${projectContext}

Respond with valid JSON ONLY — no markdown, no code blocks:
{
  "entities": [
    { "label": "string", "type": "string", "hub": "string", "description": "string" }
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

async function callGemini(prompt: string, maxOutputTokens = 32768, useJsonMode = true, disableThinking = false): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const generationConfig: Record<string, unknown> = {
    temperature: 0.1,
    maxOutputTokens,
  };
  if (useJsonMode) generationConfig.responseMimeType = "application/json";
  if (disableThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

// Strip markdown code fences if Gemini wraps JSON in ```json ... ```
function stripJsonFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : raw.trim();
}

// ── Graph assembly (mirrors extract.ts logic) ────────────────────────────────

function assembleGraph(
  extracted: {
    entities?: { label: string; type: string; hub?: string; attractor?: string; description: string }[];
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

  // Create entities with hub relationships
  let col = 0, row = 0;
  for (const entity of extracted.entities ?? []) {
    if (!entity.label) continue;
    const existingId = labelToId[entity.label.toLowerCase()];
    if (existingId) continue; // dedup

    const id = uuidv4();
    const position = { x: 150 + col * 250, y: 250 + row * 200 }; // y=250 to leave room for hub row
    col++;
    if (col >= 4) { col = 0; row++; }

    // Resolve hub: Gemini returns "hub" field (or legacy "attractor")
    const hubSlug = entity.hub || entity.attractor || "emergent";
    const hubNode = findHubByAttractorId(hubSlug, currentGraph);

    const node: GraphNode = {
      id,
      label: entity.label,
      type: entity.type || "concept",
      attractor: hubSlug, // cached for backwards compat
      description: entity.description || "",
      position,
    };

    // Add node
    currentGraph = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, node],
      entityTypes: ensureTypeExists(currentGraph.entityTypes, node.type),
    };

    // Create belongs_to_hub relationship if hub exists
    if (hubNode) {
      const hubRel: Relationship = {
        id: uuidv4(),
        sourceId: id,
        targetId: hubNode.id,
        type: HUB_RELATIONSHIP_TYPE,
      };
      currentGraph = {
        ...currentGraph,
        relationships: [...currentGraph.relationships, hubRel],
      };
    }

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
  const prompt = buildExtractionPrompt(text, graphState, abstractionLayer, projectBrief);
  // Disable thinking for extraction: Gemini 2.5 Flash thinking mode is slow and
  // unreliable for structured JSON output on long documents. Thinking disabled =
  // faster responses (3-8s vs 30-90s) and consistent JSON output.
  const raw = await callGemini(prompt, 32768, false, true);
  const rawJson = stripJsonFences(raw);

  let extracted;
  try {
    extracted = JSON.parse(rawJson);
  } catch {
    console.error("[extract] Gemini returned unparseable response. First 500 chars:", rawJson.slice(0, 500));
    return { updatedGraph: graphState, graphUpdates: [] };
  }

  // Guard against empty response (e.g. {} or {"entities":[]})
  const entityCount = (extracted.entities ?? []).length;
  if (entityCount === 0) {
    console.warn("[extract] Gemini returned 0 entities. Raw response (first 500 chars):", rawJson.slice(0, 500));
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

// ── Cross-document integration ────────────────────────────────────────────────
//
// After all documents in a batch are extracted, this pass looks across the full
// entity set to:
//   1. Merge near-duplicate entities from different documents
//   2. Generate relationships between entities that span documents
//   3. Correct attractor assignments that were wrong in per-document isolation
//
// Thinking is disabled — same rationale as extraction. Faster, consistent JSON.

function buildIntegrationPrompt(
  entities: CompactEntity[],
  compactRels: { sourceLabel: string; targetLabel: string; type: string }[],
  projectBrief?: ProjectBrief
): string {
  const preset = (projectBrief as unknown as Record<string, unknown>)?.attractorPreset as AttractorPreset | undefined;
  const attractors = getAttractorsForPreset(preset ?? "startup");
  const attractorList = attractors.map((a) => `  - "${a.id}" — ${a.description}`).join("\n");

  const briefSection = projectBrief
    ? `PROJECT CONTEXT:
- Sector: ${projectBrief.sector ?? "not specified"}
- Org size: ${projectBrief.orgSize ?? "not specified"}
- Discovery goal: ${projectBrief.discoveryGoal ?? "not specified"}
- Key themes: ${(projectBrief.keyThemes ?? []).join(", ") || "none"}`
    : "";

  // Compact entity list — id is essential so Gemini can reference it in outputs
  const entityJson = JSON.stringify(entities, null, 0);

  // Compact relationship list — labels only, for readability
  const relLines = compactRels
    .slice(0, 2000) // cap at 2000 rels to stay within context
    .map((r) => `${r.sourceLabel} —[${r.type}]→ ${r.targetLabel}`)
    .join("\n");

  return `You are TERROIR's cross-document integration engine. You have been given the complete entity set extracted from multiple source documents. Your job is to integrate these entities into a coherent, well-connected knowledge graph.

${briefSection}

ATTRACTOR CATEGORIES:
${attractorList}

CURRENT ENTITIES (${entities.length} total):
${entityJson}

EXISTING RELATIONSHIPS (${compactRels.length} total):
${relLines}

YOUR THREE TASKS:

### Phase 1: Entity Merges
Identify entities that refer to the same concept but were extracted from different documents with slightly different wording or framing. Only merge if you are confident — do not merge entities that are genuinely distinct.

For each merge group output:
- canonicalLabel: the best unified label
- canonicalDescription: a combined description (2-3 sentences max)
- entityIdsToMerge: array of entity IDs from the list above (minimum 2, must be valid IDs from the list)

### Phase 2: Cross-Document Relationships
Identify the most important relationships between entities that are NOT already connected. Focus on:
- Entities from different attractor categories that are clearly related
- Entities that share themes but have no path between them
- Do NOT recreate existing relationships
- Generate at most ${Math.min(Math.ceil(compactRels.length * 3), 200)} new relationships (quality over quantity)

For each new relationship output:
- sourceEntityId: valid entity ID from the list above
- targetEntityId: valid entity ID from the list above
- type: short verb phrase (e.g. "enables", "depends_on", "challenges", "informs")
- description: optional one sentence

### Phase 3: Attractor Reassignment
Now that you can see all entities together, identify any entities whose attractor was assigned incorrectly in per-document isolation. Only reassign where you are confident.

For each reassignment output:
- entityId: valid entity ID from the list above
- oldAttractor: current value
- newAttractor: corrected value from the attractor categories above
- reason: one sentence

Respond with a single JSON object — no markdown, no code blocks:
{
  "mergeGroups": [
    { "canonicalLabel": "string", "canonicalDescription": "string", "entityIdsToMerge": ["id1", "id2"] }
  ],
  "newRelationships": [
    { "sourceEntityId": "string", "targetEntityId": "string", "type": "string", "description": "string" }
  ],
  "reassignments": [
    { "entityId": "string", "oldAttractor": "string", "newAttractor": "string", "reason": "string" }
  ]
}`;
}

export interface IntegrationOutput {
  mergeGroups:      MergeGroup[];
  newRelationships: CrossDocRelationship[];
  reassignments:    AttractorReassignment[];
}

// ── Signal deduplication ──────────────────────────────────────────────────────
//
// Reviews all evaluative signals and groups near-duplicates into merge groups.
// Gemini picks a canonical label + richer description for each cluster.
// Thinking disabled — same rationale as extraction (faster, consistent JSON).

export interface SignalMergeGroup {
  canonicalLabel:       string;
  canonicalDescription: string;
  canonicalDirection:   "toward" | "away_from" | "protecting";
  signalIdsToMerge:     string[];
}

function buildSignalDeduplicationPrompt(
  signals: import("@/types").EvaluativeSignal[],
  projectBrief?: ProjectBrief
): string {
  const briefSection = projectBrief
    ? `PROJECT CONTEXT:
- Sector: ${projectBrief.sector ?? "not specified"}
- Org size: ${projectBrief.orgSize ?? "not specified"}
- Discovery goal: ${projectBrief.discoveryGoal ?? "not specified"}`
    : "";

  const signalList = JSON.stringify(
    signals.map((s) => ({
      id:     s.id,
      label:  s.label,
      dir:    s.direction,
      str:    s.strength,
      source: s.sourceDescription?.slice(0, 80) ?? "",
    })),
    null, 0
  );

  return `You are TERROIR's signal deduplication engine. Review the evaluative signals below and identify groups of signals that refer to the same underlying concept — the same value, fear, or orientation — possibly phrased differently across multiple source documents.

Only merge signals that are GENUINELY near-duplicate (same underlying meaning). Do NOT merge signals that are merely related or thematically similar.

${briefSection}

SIGNALS (${signals.length} total):
${signalList}

For each merge group, output:
- canonicalLabel: the best unified short label
- canonicalDescription: 1-2 sentences with enough context to be readable standalone (richer than any individual label)
- canonicalDirection: "toward" | "away_from" | "protecting" (dominant direction across the group)
- signalIdsToMerge: array of signal IDs — minimum 2, ALL must be valid IDs from the list above

Signals not in any group should be left unchanged. Return only groups with 2+ IDs.

Respond with valid JSON only — no markdown, no code blocks:
{
  "mergeGroups": [
    {
      "canonicalLabel": "string",
      "canonicalDescription": "string",
      "canonicalDirection": "toward|away_from|protecting",
      "signalIdsToMerge": ["id1", "id2"]
    }
  ]
}`;
}

/**
 * Groups near-duplicate evaluative signals into merge clusters via Gemini 2.5 Flash.
 * Thinking disabled — same rationale as extraction (faster, consistent JSON).
 *
 * @param signals      All evaluative signals for the project
 * @param projectBrief Optional brief for context
 * @returns            Array of merge groups (each with 2+ signal IDs)
 */
export async function deduplicateSignals(
  signals: import("@/types").EvaluativeSignal[],
  projectBrief?: ProjectBrief
): Promise<SignalMergeGroup[]> {
  if (signals.length < 2) return [];

  const validIds = new Set(signals.map((s) => s.id));
  const prompt   = buildSignalDeduplicationPrompt(signals, projectBrief);
  const raw      = await callGemini(prompt, 16384, false, true);
  const rawJson  = stripJsonFences(raw);

  let parsed: { mergeGroups: SignalMergeGroup[] } | null = null;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    console.error("[dedup] Gemini returned unparseable JSON:", rawJson.slice(0, 300));
    return [];
  }

  // Validate: drop groups with hallucinated IDs or fewer than 2 members
  const all = parsed?.mergeGroups ?? [];
  const valid = all.filter(
    (g) =>
      g.signalIdsToMerge?.length >= 2 &&
      g.signalIdsToMerge.every((id) => validIds.has(id)) &&
      g.canonicalLabel?.trim() &&
      g.canonicalDescription?.trim() &&
      ["toward", "away_from", "protecting"].includes(g.canonicalDirection)
  );
  if (valid.length < all.length) {
    console.warn(`[dedup] Dropped ${all.length - valid.length} invalid merge group(s) from Gemini response`);
  }
  return valid;
}

/**
 * Runs the cross-document integration pass via Gemini 2.5 Flash.
 *
 * Sends the full entity + relationship set as a compact payload.
 * Thinking is disabled for speed and reliable JSON output (same as extraction).
 *
 * @param entities      Compact entity list (id + label + attractor + truncated desc)
 * @param compactRels   Existing relationships as label pairs (for Gemini context)
 * @param projectBrief  Optional brief for calibrating integration focus
 */
export async function integrateEntities(
  entities:    CompactEntity[],
  compactRels: { sourceLabel: string; targetLabel: string; type: string }[],
  projectBrief?: ProjectBrief
): Promise<IntegrationOutput> {
  const validIds = new Set(entities.map((e) => e.id));

  const prompt = buildIntegrationPrompt(entities, compactRels, projectBrief);
  const raw    = await callGemini(prompt, 32768, false, true); // no JSON mode, thinking off
  let rawJson  = stripJsonFences(raw);

  let parsed: IntegrationOutput | null = null;
  try {
    parsed = JSON.parse(rawJson) as IntegrationOutput;
  } catch {
    console.error("[integrate] Gemini returned unparseable JSON. First 500 chars:", rawJson.slice(0, 500));
    // Retry once with explicit JSON reinforcement
    const retryRaw  = await callGemini(
      prompt + "\n\nCRITICAL: Respond with valid JSON only. No text before or after the JSON object.",
      32768, false, true
    );
    rawJson = stripJsonFences(retryRaw);
    try {
      parsed = JSON.parse(rawJson) as IntegrationOutput;
    } catch {
      console.error("[integrate] Retry also failed. Returning empty result.");
      return { mergeGroups: [], newRelationships: [], reassignments: [] };
    }
  }

  // Validate all entity IDs referenced in the response — drop anything hallucinated
  const mergeGroups = (parsed.mergeGroups ?? []).filter(
    (g) => g.entityIdsToMerge?.length >= 2 &&
           g.entityIdsToMerge.every((id) => validIds.has(id))
  );

  const newRelationships = (parsed.newRelationships ?? []).filter(
    (r) => validIds.has(r.sourceEntityId) && validIds.has(r.targetEntityId)
  );

  const reassignments = (parsed.reassignments ?? []).filter(
    (r) => validIds.has(r.entityId)
  );

  return { mergeGroups, newRelationships, reassignments };
}
