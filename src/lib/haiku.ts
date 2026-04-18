/**
 * Haiku API client for TERROIR
 *
 * Wraps Claude Haiku for one focused capability:
 *
 *   runScopingDialogue — conversational project setup. Asks 4-5 direct
 *   questions and produces a ProjectBrief that feeds Gemini's extraction.
 *
 * DESIGN RULE: Haiku has NO graph tools and does NOT run synthesis.
 * Synthesis moved to Gemini (runGeminiSynthesis in gemini.ts) — Gemini's
 * 1M context window handles large corpora far better than Haiku.
 *
 * Haiku stays for scoping: short, cheap, conversational.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ProjectBrief,
  AbstractionLayer,
} from "@/types";

const HAIKU_MODEL = "claude-haiku-4-5";

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
// Tone: direct and concise — no preambles, no pleasantries.

const SCOPING_SYSTEM = `You are TERROIR's project scoping assistant. Set up a research project in 4-5 exchanges.

You are gathering:
1. Organisation context — size and sector
2. Discovery goal — what the consultant most wants to understand
3. Abstraction preference — things (domain objects), flows (interaction patterns), or themes (concerns)?
4. Any known tensions or sensitive areas to watch for

RULES:
- Ask ONE question per message. Direct and concise — no preambles, no pleasantries.
- Adapt follow-ups based on what you learn.
- Once you have sector, discovery goal, and abstraction layer, generate the brief.

When generating the brief, embed a <brief> JSON block in your response:
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

After the <brief> block, confirm it is ready to save in one short sentence.

ABSTRACTION LAYER GUIDE:
- domain_objects: Map what exists — teams, tools, platforms, documents, roles. "What is our landscape?"
- interaction_patterns: Map how things move — workflows, handoffs, dependencies. "How does work actually happen?"
- concerns_themes: Map what matters — values, tensions, strategic priorities. "What do people care about and fear?"`;

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
  projectContext?: { name?: string; sector?: string },
  locale: "en" | "de" = "en"
): Promise<ScopingDialogueResult> {
  const contextNote =
    projectContext?.name || projectContext?.sector
      ? `\n\nPROJECT CONTEXT: ${projectContext.name ? `Name: "${projectContext.name}". ` : ""}${projectContext.sector ? `Sector hint: ${projectContext.sector}.` : ""}`
      : "";

  const languageInstruction =
    locale === "de"
      ? "\n\nLANGUAGE: Conduct this entire dialogue in German. Ask all questions and give all responses in German."
      : "";

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    system: `${SCOPING_SYSTEM}${contextNote}${languageInstruction}`,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock?.type === "text" ? textBlock.text : "";

  const parsedBrief = parseBriefFromResponse(responseText);
  const brief: ProjectBrief | undefined = parsedBrief
    ? {
        ...parsedBrief,
        generatedAt: new Date().toISOString(),
      }
    : undefined;

  return { response: responseText, brief };
}
