import Anthropic from "@anthropic-ai/sdk";
import type { GraphState, GraphNode, Relationship, TensionMarker, EntityTypeConfig } from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { ensureTypeExists, getHubNodes, getHubMembers } from "./entity-types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ExtractionResult {
  updatedGraph: GraphState;
  graphUpdates: { type: string; label: string }[];
  hubAssignments?: number;
  crossGraphRels?: number;
}

interface BridgeAssignment {
  entity_label: string;
  hub_slug: string;
  relationships_to_existing: {
    target_label: string;
    type: string;
    rationale: string;
  }[];
}

/**
 * Second-pass Sonnet call: assigns newly extracted entities to hubs and
 * finds relationships to existing graph nodes.
 *
 * Skipped if the graph has no hub nodes (legacy projects without hub scaffolding).
 * New entities with no existing connections are still valid — they just get a hub assignment.
 */
async function bridgeToGraph(
  graph: GraphState,
  newNodeIds: Set<string>
): Promise<{ updatedGraph: GraphState; hubAssignments: number; crossGraphRels: number }> {
  const hubNodes = getHubNodes(graph);
  if (hubNodes.length === 0) {
    return { updatedGraph: graph, hubAssignments: 0, crossGraphRels: 0 };
  }

  const newNodes = graph.nodes.filter((n) => newNodeIds.has(n.id));
  if (newNodes.length === 0) {
    return { updatedGraph: graph, hubAssignments: 0, crossGraphRels: 0 };
  }

  // Build label→id map for the whole graph (used to resolve Sonnet's label references)
  const labelToId: Record<string, string> = {};
  for (const n of graph.nodes) labelToId[n.label.toLowerCase()] = n.id;

  // Build hub listing with their current members (condensed: label + type only).
  // Mark the broadest/catch-all hub as the recommended fallback so the prompt
  // reference is a real ID, not the literal string "emergent".
  const fallbackHub = hubNodes.find((h) =>
    /emergent|other|misc|general/i.test(h.label)
  ) ?? hubNodes[hubNodes.length - 1];

  const hubListing = hubNodes.map((hub) => {
    const members = getHubMembers(hub.id, graph);
    const memberLines = members
      .slice(0, 20)
      .map((m) => `    - "${m.label}" (${m.type})`)
      .join("\n");
    const overflow = members.length > 20 ? `\n    ... and ${members.length - 20} more` : "";
    const fallbackNote = hub.id === fallbackHub.id ? " ← use this when uncertain" : "";
    return `  Hub: "${hub.label}" (slug: ${hub.id})${fallbackNote}\n  Description: ${hub.description || "—"}\n  Current members:\n${memberLines || "    (none yet)"}${overflow}`;
  }).join("\n\n");

  // Condense existing (non-hub, non-new) nodes for cross-graph connection scanning
  const existingNodes = graph.nodes.filter((n) => !n.is_hub && !newNodeIds.has(n.id));
  const existingListing = existingNodes
    .map((n) => `  - "${n.label}" (${n.type})${n.description ? `: ${n.description.slice(0, 80)}` : ""}`)
    .join("\n");

  const newEntityListing = newNodes
    .map((n) => `  - "${n.label}" (${n.type})${n.description ? `: ${n.description.slice(0, 80)}` : ""}`)
    .join("\n");

  const bridgePrompt = `You are TERROIR's graph integration engine.

You have just extracted new entities from a narrative. Your task is to:
1. Assign each new entity to the most appropriate hub (structural category)
2. Identify any meaningful relationships between new entities and existing graph nodes

## Available Hubs

${hubListing}

## Existing Graph Nodes (for cross-graph connections)

${existingNodes.length > 0 ? existingListing : "  (no existing entities yet)"}

## Newly Extracted Entities

${newEntityListing}

## Instructions

For each new entity:
- Choose the hub whose description best matches the entity's structural role
- Use the hub's exact slug (shown in parentheses) as hub_slug
- If uncertain, use the hub marked "← use this when uncertain"
- Scan existing nodes for genuine semantic connections: cause/effect, dependency,
  parent/child, contrast, instrument, context. Only create connections that reflect
  real organisational meaning from the source text.
- A new entity with NO connections to existing nodes is perfectly valid — assign to hub and leave relationships_to_existing empty.
- Bias toward fewer, stronger connections over many weak ones.

LANGUAGE CONSISTENCY: Use the same language as the entity labels.

Respond with valid JSON only — no markdown, no explanation:
{
  "assignments": [
    {
      "entity_label": "string",
      "hub_slug": "string",
      "relationships_to_existing": [
        { "target_label": "string", "type": "string", "rationale": "string" }
      ]
    }
  ]
}`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: bridgePrompt }],
    });
  } catch (err) {
    // Bridge pass is best-effort — a network error or rate limit should not
    // discard the already-completed extraction result.
    console.warn("[bridge] Sonnet API call failed — returning unbridged graph:", err);
    return { updatedGraph: graph, hubAssignments: 0, crossGraphRels: 0 };
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!textBlock) return { updatedGraph: graph, hubAssignments: 0, crossGraphRels: 0 };

  let jsonStr = textBlock.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  let parsed: { assignments: BridgeAssignment[] };
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    console.warn("[bridge] Failed to parse bridge response — skipping hub assignment");
    return { updatedGraph: graph, hubAssignments: 0, crossGraphRels: 0 };
  }

  let currentGraph = structuredClone(graph);
  let hubAssignments = 0;
  let crossGraphRels = 0;

  for (const assignment of parsed.assignments ?? []) {
    const nodeId = labelToId[assignment.entity_label?.toLowerCase()];
    if (!nodeId) continue;

    // Resolve hub_slug to a hub node ID — the model uses the hub node's ID as slug
    const hubNode = hubNodes.find(
      (h) => h.id === assignment.hub_slug || h.label.toLowerCase() === assignment.hub_slug?.toLowerCase()
    );
    if (!hubNode) {
      console.warn(`[bridge] Unknown hub slug "${assignment.hub_slug}" for entity "${assignment.entity_label}" — skipping`);
      continue;
    }

    // Check if belongs_to_hub already exists (extraction pass may have created it)
    const alreadyConnected = currentGraph.relationships.some(
      (r) => r.sourceId === nodeId && r.targetId === hubNode.id && r.type === HUB_RELATIONSHIP_TYPE
    );

    if (!alreadyConnected) {
      const hubRel: Relationship = {
        id: uuidv4(),
        sourceId: nodeId,
        targetId: hubNode.id,
        type: HUB_RELATIONSHIP_TYPE,
        description: `Assigned to ${hubNode.label} hub during bridge pass`,
      };
      currentGraph = { ...currentGraph, relationships: [...currentGraph.relationships, hubRel] };
      hubAssignments++;
    }

    // Create cross-graph relationships to existing nodes
    for (const rel of assignment.relationships_to_existing ?? []) {
      const targetId = labelToId[rel.target_label?.toLowerCase()];
      if (!targetId || targetId === nodeId) continue;

      // Skip if this relationship already exists in either direction
      const duplicate = currentGraph.relationships.some(
        (r) =>
          r.type === rel.type &&
          ((r.sourceId === nodeId && r.targetId === targetId) ||
            (r.sourceId === targetId && r.targetId === nodeId))
      );
      if (duplicate) continue;

      const crossRel: Relationship = {
        id: uuidv4(),
        sourceId: nodeId,
        targetId,
        type: rel.type,
        description: rel.rationale,
      };
      currentGraph = { ...currentGraph, relationships: [...currentGraph.relationships, crossRel] };
      crossGraphRels++;
    }
  }

  return { updatedGraph: currentGraph, hubAssignments, crossGraphRels };
}

const extractionPrompt = `You are TERROIR's extraction engine. Given a narrative text about an organisation, extract ALL entities and relationships.

Follow the Cutler workflow:
1. FIND all entities mentioned in the text (concepts, people roles, systems, processes, documents, goals, values, etc.)
2. CLASSIFY each entity with an appropriate type. Types are emergent — use what fits the domain.
3. RELATE entities to each other with descriptive relationship types.
4. FLAG any tensions or conflicts between entities.

IMPORTANT: Extract COMPREHENSIVELY. Capture every meaningful entity and relationship, not just the main topic.

LANGUAGE CONSISTENCY (critical — do not mix languages):
- Detect the primary language of the source text.
- ALL entity labels, types, and descriptions MUST be in that same language. If the text is in German, output German. If in English, output English. Do NOT mix languages.
- Relationship types and descriptions should match the source language.

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
    { "label": "string", "direction": "toward|away_from|protecting", "strength": 1-5, "temporal_horizon": "operational|tactical|strategic|foundational", "related_entity_labels": ["string"], "source": "string" }
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

  // Track IDs of nodes created in this pass — passed directly to bridgeToGraph
  // to avoid the roundabout label→id re-lookup (which breaks on label collisions).
  const newNodeIds = new Set<string>();

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
      type: (entity.type || "concept").toLowerCase(), // normalize casing to prevent duplicates like Aspiration/aspiration
      description: entity.description || "",
      position,
    };

    currentGraph = {
      ...currentGraph,
      nodes: [...currentGraph.nodes, node],
      entityTypes: ensureTypeExists(currentGraph.entityTypes, node.type),
    };

    labelToId[entity.label.toLowerCase()] = id;
    newNodeIds.add(id);
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
      // Resolve related entity labels to node IDs (if provided)
      const relatedNodeIds = (s.related_entity_labels ?? [])
        .map((label: string) => labelToId[label?.toLowerCase()])
        .filter(Boolean) as string[];

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
            temporalHorizon: s.temporal_horizon as "operational" | "tactical" | "strategic" | "foundational" | undefined,
            ...(relatedNodeIds.length > 0 ? { relatedNodeIds } : {}),
          },
        ],
      };
      updates.push({ type: "evaluative_signal_set", label: s.label });
    }
  }

  // ── Bridge pass ───────────────────────────────────────────────────────────
  // Assign each new entity to a hub and find relationships to existing nodes.
  // Skipped automatically if no hub nodes exist (legacy projects).
  const { updatedGraph: bridgedGraph, hubAssignments, crossGraphRels } = await bridgeToGraph(
    currentGraph,
    newNodeIds
  );

  // Append bridge updates to the activity log
  if (hubAssignments > 0) {
    updates.push({ type: "hub_assignments", label: `${hubAssignments} entities assigned to hubs` });
  }
  if (crossGraphRels > 0) {
    updates.push({ type: "cross_graph_relationships", label: `${crossGraphRels} connections to existing nodes` });
  }

  return { updatedGraph: bridgedGraph, graphUpdates: updates, hubAssignments, crossGraphRels };
}
