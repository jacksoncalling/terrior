import Anthropic from "@anthropic-ai/sdk";
import type { GraphState, GraphNode, Relationship, TensionMarker, EntityTypeConfig } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { ensureTypeExists } from "./entity-types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ExtractionResult {
  updatedGraph: GraphState;
  graphUpdates: { type: string; label: string }[];
}

const extractionPrompt = `You are TERROIR's extraction engine. Given a narrative text about an organisation, extract ALL entities and relationships.

Follow the Cutler workflow:
1. FIND all entities mentioned in the text (concepts, people roles, systems, processes, documents, goals, values, etc.)
2. CLASSIFY each entity with an appropriate type. Types are emergent — use what fits the domain.
3. RELATE entities to each other with descriptive relationship types.
4. FLAG any tensions or conflicts between entities.

IMPORTANT: Extract COMPREHENSIVELY. Capture every meaningful entity and relationship, not just the main topic.

Respond with valid JSON in this exact format:
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
    { "label": "string", "direction": "toward|away_from|protecting", "strength": 1-5, "source": "string" }
  ]
}`;

export async function extractFromNarrative(
  text: string,
  graphState: GraphState
): Promise<ExtractionResult> {
  const existingContext = graphState.nodes.length > 0
    ? `\n\nExisting entities in the graph (avoid duplicates):\n${graphState.nodes.map((n) => `- "${n.label}" (${n.type})`).join("\n")}\n\nExisting entity types: ${graphState.entityTypes.map((t) => t.id).join(", ")}`
    : "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: extractionPrompt + existingContext,
    messages: [{ role: "user", content: `Extract entities and relationships from this narrative:\n\n${text}` }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );

  if (!textBlock) {
    return { updatedGraph: graphState, graphUpdates: [] };
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = textBlock.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  let extracted;
  try {
    extracted = JSON.parse(jsonStr.trim());
  } catch {
    return { updatedGraph: graphState, graphUpdates: [] };
  }

  let currentGraph = structuredClone(graphState);
  const updates: { type: string; label: string }[] = [];

  // Create a label→id map for relationship resolution
  const labelToId: Record<string, string> = {};

  // Map existing nodes
  for (const node of currentGraph.nodes) {
    labelToId[node.label.toLowerCase()] = node.id;
  }

  // Create entities
  const entities = extracted.entities || [];
  let col = 0;
  let row = 0;
  for (const entity of entities) {
    const existingId = labelToId[entity.label?.toLowerCase()];
    if (existingId) continue; // Skip duplicates

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
  const relationships = extracted.relationships || [];
  for (const rel of relationships) {
    const sourceId = labelToId[rel.source_label?.toLowerCase()];
    const targetId = labelToId[rel.target_label?.toLowerCase()];
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
  const tensions = extracted.tensions || [];
  for (const t of tensions) {
    const relatedIds = (t.related_labels || [])
      .map((label: string) => labelToId[label?.toLowerCase()])
      .filter(Boolean);

    if (relatedIds.length > 0) {
      const tension: TensionMarker = {
        id: uuidv4(),
        description: t.description,
        relatedNodeIds: relatedIds,
        status: "unresolved",
      };
      currentGraph = {
        ...currentGraph,
        tensions: [...currentGraph.tensions, tension],
      };
      updates.push({ type: "tension_flagged", label: t.description });
    }
  }

  // Create evaluative signals
  const signals = extracted.evaluative_signals || [];
  for (const s of signals) {
    const existing = currentGraph.evaluativeSignals.find(
      (e) => e.label.toLowerCase() === s.label?.toLowerCase()
    );
    if (!existing) {
      currentGraph = {
        ...currentGraph,
        evaluativeSignals: [
          ...currentGraph.evaluativeSignals,
          {
            id: uuidv4(),
            label: s.label,
            direction: s.direction || "toward",
            strength: s.strength || 3,
            sourceDescription: s.source || "Extracted from narrative",
          },
        ],
      };
      updates.push({ type: "evaluative_signal_set", label: s.label });
    }
  }

  return { updatedGraph: currentGraph, graphUpdates: updates };
}
