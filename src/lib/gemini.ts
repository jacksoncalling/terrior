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

import type { GraphState, GraphNode, Relationship, TensionMarker } from "@/types";
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
// Generic version of the Babor script prompt — no hardcoded domain types.
// Entity types emerge from the document content, same as Claude extraction.

function buildExtractionPrompt(text: string, graphState: GraphState): string {
  const existingContext = graphState.nodes.length > 0
    ? `\n\nExisting entities already in the graph (avoid duplicates, connect to these where relevant):\n${graphState.nodes.map((n) => `- "${n.label}" (${n.type}) [id: ${n.id}]`).join("\n")}\n\nExisting entity types: ${graphState.entityTypes.map((t) => t.id).join(", ")}`
    : "";

  return `You are TERROIR's extraction engine. Extract a structured knowledge graph from the document below.

Your task:
1. FIND all meaningful entities (concepts, organisations, platforms, processes, roles, documents, goals, values, products, etc.)
2. CLASSIFY each with an appropriate type. Types are emergent — use what fits the domain. Reuse existing types where appropriate.
3. RELATE entities to each other with descriptive relationship types.
4. FLAG tensions or conflicts between entities.
5. NOTE evaluative signals — what the organisation values, fears, or is moving toward.

CRITICAL: Do NOT create duplicate entities. Check the existing graph context below.
Extract COMPREHENSIVELY — capture every meaningful entity and relationship.
${existingContext}

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

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
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

export async function extractOntologyWithGemini(
  text: string,
  graphState: GraphState
): Promise<GeminiExtractionResult> {
  const prompt  = buildExtractionPrompt(text, graphState);
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
