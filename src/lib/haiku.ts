/**
 * Haiku API client for TERROIR
 *
 * Wraps Claude Haiku for two distinct, read-only capabilities:
 *
 *   1. runScopingDialogue — conversational project setup. Asks 4-5 focused
 *      questions and produces a ProjectBrief that feeds Gemini's extraction.
 *
 *   2. runSynthesis — cross-transcript reading. Surfaces term collisions,
 *      connecting threads, evaluative convergence, and graph gaps.
 *
 * DESIGN RULE: Haiku has NO graph tools. It reads and recommends.
 * The consultant acts on its suggestions via Sonnet or direct edits.
 * This keeps the human in control and prevents fast/cheap model mutations.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  GraphState,
  ProjectBrief,
  AbstractionLayer,
  SynthesisResult,
} from "@/types";

const HAIKU_MODEL = "claude-haiku-4-5";

// Rough upper limit for total document character content (~150k tokens).
// If exceeded, each document is pre-summarised before synthesis.
const CONTEXT_WINDOW_GUARD_CHARS = 600_000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Shared internal types ─────────────────────────────────────────────────────

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ScopingDialogueResult {
  response: string;          // Haiku's response text (may contain the brief)
  brief?: ProjectBrief;      // present only when Haiku signals the brief is complete
}

// ── Scoping system prompt ─────────────────────────────────────────────────────
// Drives a focused 4-5 exchange dialogue. Haiku asks one question at a time
// and signals completion by embedding a <brief> JSON block in its response.

const SCOPING_SYSTEM = `You are TERROIR's project scoping assistant. Your job is to help a consultant set up their research project in 4-5 focused exchanges.

You are gathering:
1. Organisation context — size and sector
2. Discovery goal — what the consultant most wants to understand
3. Abstraction preference — things (domain objects), flows (interaction patterns), or themes (concerns)?
4. Any known tensions, contradictions, or sensitive areas to watch for

RULES:
- Ask ONE question at a time. Be conversational, not form-like.
- Adapt your follow-up questions based on what you learn.
- Once you have enough context (minimum: sector, discovery goal, abstraction layer), generate the project brief.

When generating the brief, include a <brief> JSON block in your response exactly like this:
<brief>
{
  "orgSize": "...",
  "sector": "...",
  "discoveryGoal": "...",
  "abstractionLayer": "domain_objects|interaction_patterns|concerns_themes",
  "keyThemes": ["...", "..."],
  "summary": "One paragraph summary of what this project is looking for and why."
}
</brief>

After the <brief> block, confirm the brief is ready to save and invite the consultant to proceed.

ABSTRACTION LAYER GUIDE — use this to help the consultant choose:
- domain_objects: Map what exists — teams, tools, platforms, documents, roles. Good for "what is our landscape?"
- interaction_patterns: Map how things move — workflows, handoffs, dependencies, communication paths. Good for "how does work actually happen?"
- concerns_themes: Map what matters — values, tensions, strategic priorities, cultural patterns. Good for "what do people care about and fear?"`;

// ── Synthesis system prompt ───────────────────────────────────────────────────
// Single-turn analytical prompt. Haiku reads across all sources + the graph
// and returns structured JSON — no conversation, no tool use.

const SYNTHESIS_SYSTEM = `You are TERROIR's synthesis reader. You read across multiple research documents and an existing knowledge graph to surface cross-source patterns that no single source reveals on its own.

YOUR FOUR TASKS:

1. TERM COLLISIONS — the same concept called different names across sources. These reveal where the shared organisational language is inconsistent. Suggest a canonical term.

2. CONNECTING THREADS — recurring themes, structural patterns, or concerns that appear across multiple sources. These are the latent ontology the organisation shares but hasn't named.

3. SIGNAL CONVERGENCE — places where multiple sources agree or disagree on something evaluative (what people value, fear, or are working toward). Disagreement is as important as agreement.

4. GRAPH GAPS — meaningful concepts that appear in the transcripts but are absent or underrepresented in the existing knowledge graph. For each gap, suggest the exact follow-up question a consultant should ask.

RESPOND WITH VALID JSON ONLY. No markdown, no code blocks, no commentary outside the JSON.

{
  "narrativeSummary": "string — 2-3 paragraphs describing the key cross-source findings",
  "termCollisions": [
    {
      "variants": ["string"],
      "sources": ["document title"],
      "suggestedCanonical": "string",
      "context": "string — why these terms refer to the same concept"
    }
  ],
  "connectingThreads": [
    {
      "theme": "string",
      "description": "string",
      "relatedSources": ["document title"],
      "relatedNodeIds": ["string — only if thread maps to existing graph nodes, else omit"]
    }
  ],
  "signalConvergence": [
    {
      "signal": "string — what they agree or disagree about",
      "convergenceType": "agreement|disagreement|partial",
      "sources": ["document title"],
      "description": "string"
    }
  ],
  "graphGaps": [
    {
      "description": "string — what is missing or underrepresented",
      "suggestedQuestion": "string — the exact question a consultant should ask next",
      "relatedNodeIds": ["string — optional"]
    }
  ]
}`;

// ── Brief parser ──────────────────────────────────────────────────────────────

/**
 * Extracts and parses the <brief>...</brief> JSON block from Haiku's response.
 * Returns null if no brief block is found or if the JSON is malformed.
 */
function parseBriefFromResponse(
  text: string
): Omit<ProjectBrief, "rawAnswers" | "generatedAt"> | null {
  const match = text.match(/<brief>([\s\S]*?)<\/brief>/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    // abstractionLayer is the only required field
    const validLayers: AbstractionLayer[] = [
      "domain_objects",
      "interaction_patterns",
      "concerns_themes",
    ];
    if (!validLayers.includes(parsed.abstractionLayer)) return null;
    return parsed;
  } catch {
    console.warn("[haiku] Failed to parse <brief> JSON from scoping response");
    return null;
  }
}

// ── Context window guard ──────────────────────────────────────────────────────

/**
 * Summarises a single document using Haiku when the full corpus exceeds the
 * synthesis context window. Preserves entities, workflows, tensions, signals.
 */
async function summarizeDocument(
  title: string,
  content: string
): Promise<string> {
  // Hard cap per-document to prevent runaway in edge cases
  const truncated = content.slice(0, 50_000);

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Summarise the following document in 300-400 words. Preserve the key themes, entities, workflows, tensions, and evaluative signals — the summary will be used for cross-source analysis. Do not lose structural information.

Document: "${title}"

${truncated}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  return block?.type === "text"
    ? block.text
    : `[Summary unavailable for "${title}"]`;
}

// ── Synthesis context builder ─────────────────────────────────────────────────

/**
 * Builds the user message content for the synthesis API call.
 * Applies the context window guard: if total document content exceeds
 * CONTEXT_WINDOW_GUARD_CHARS, each document is pre-summarised with Haiku.
 */
async function buildSynthesisContext(
  graphState: GraphState,
  documents: { id: string; title: string; content: string }[],
  brief?: ProjectBrief
): Promise<string> {
  const totalChars = documents.reduce((sum, d) => sum + d.content.length, 0);
  const needsSummarisation = totalChars > CONTEXT_WINDOW_GUARD_CHARS;

  if (needsSummarisation) {
    console.log(
      `[haiku] Total document content (${totalChars} chars) exceeds limit. Pre-summarising ${documents.length} documents.`
    );
  }

  // Optionally summarise each document in parallel
  const processedDocs = needsSummarisation
    ? await Promise.all(
        documents.map(async (doc) => ({
          ...doc,
          content: await summarizeDocument(doc.title, doc.content),
          isSummary: true,
        }))
      )
    : documents.map((d) => ({ ...d, isSummary: false }));

  // Graph summary — nodes, relationships, tensions, signals
  const graphLines: string[] = [
    `Nodes (${graphState.nodes.length}):`,
    ...graphState.nodes.map(
      (n) => `  - "${n.label}" [${n.type}]: ${n.description}`
    ),
    "",
    `Relationships (${graphState.relationships.length}):`,
    ...graphState.relationships.map((r) => {
      const src =
        graphState.nodes.find((n) => n.id === r.sourceId)?.label ?? r.sourceId;
      const tgt =
        graphState.nodes.find((n) => n.id === r.targetId)?.label ?? r.targetId;
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
  ];

  // Project brief section
  const briefLines = brief
    ? [
        "PROJECT BRIEF:",
        `  Sector: ${brief.sector ?? "not specified"}`,
        `  Org size: ${brief.orgSize ?? "not specified"}`,
        `  Discovery goal: ${brief.discoveryGoal ?? "not specified"}`,
        `  Abstraction layer: ${brief.abstractionLayer}`,
        `  Key themes: ${(brief.keyThemes ?? []).join(", ") || "none"}`,
        `  Summary: ${brief.summary ?? "none"}`,
      ]
    : ["PROJECT BRIEF: not set (general extraction mode)"];

  // Document sections
  const docSections = processedDocs
    .map(
      (doc, i) =>
        `--- DOCUMENT ${i + 1}: "${doc.title}"${doc.isSummary ? " [SUMMARISED — full content too large]" : ""} ---\n${doc.content}`
    )
    .join("\n\n");

  return [
    briefLines.join("\n"),
    "",
    "EXISTING KNOWLEDGE GRAPH:",
    graphLines.join("\n"),
    "",
    `DOCUMENTS TO SYNTHESISE (${processedDocs.length} sources):`,
    docSections,
    "",
    "Please analyse these sources and return a synthesis report.",
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs one exchange in the scoping dialogue.
 *
 * Pass the full conversation history on every call — Haiku uses it to
 * maintain context across the 4-5 question sequence.
 *
 * When Haiku includes a <brief> block, the parsed ProjectBrief is returned
 * alongside the response text so the caller can save it to the project.
 */
export async function runScopingDialogue(
  messages: ConversationMessage[],
  projectContext?: { name?: string; sector?: string }
): Promise<ScopingDialogueResult> {
  // Optionally augment the system prompt with known project context
  const contextNote =
    projectContext?.name || projectContext?.sector
      ? `\n\nPROJECT CONTEXT: ${projectContext.name ? `Name: "${projectContext.name}". ` : ""}${projectContext.sector ? `Sector hint: ${projectContext.sector}.` : ""}`
      : "";

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: `${SCOPING_SYSTEM}${contextNote}`,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock?.type === "text" ? textBlock.text : "";

  // Parse brief if Haiku signals completion
  const parsedBrief = parseBriefFromResponse(responseText);
  const brief: ProjectBrief | undefined = parsedBrief
    ? {
        ...parsedBrief,
        generatedAt: new Date().toISOString(),
      }
    : undefined;

  return { response: responseText, brief };
}

/**
 * Runs cross-source synthesis across all documents for a project.
 *
 * Reads the full graph state + all document content, then returns a structured
 * SynthesisResult. Single-turn — no tool use loop. Haiku reads and recommends;
 * the consultant decides what to act on.
 *
 * Applies a context window guard: if total document content exceeds ~150k
 * tokens, each document is pre-summarised before the synthesis call.
 */
export async function runSynthesis(
  graphState: GraphState,
  documents: { id: string; title: string; content: string }[],
  brief?: ProjectBrief
): Promise<SynthesisResult> {
  if (documents.length === 0) {
    throw new Error("[haiku] Cannot synthesise: no documents provided");
  }

  const userContent = await buildSynthesisContext(graphState, documents, brief);

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: SYNTHESIS_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock?.type === "text" ? textBlock.text : "";

  let parsed: Omit<SynthesisResult, "documentCount" | "generatedAt">;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.error(
      "[haiku] Synthesis returned invalid JSON:",
      rawText.slice(0, 300)
    );
    // Return a valid-but-empty result rather than crashing the UI
    parsed = {
      narrativeSummary:
        "Synthesis could not be parsed. Please try again — the model may have returned malformed output.",
      termCollisions: [],
      connectingThreads: [],
      signalConvergence: [],
      graphGaps: [],
    };
  }

  return {
    ...parsed,
    documentCount: documents.length,
    generatedAt: new Date().toISOString(),
  };
}
