import type { GraphState, AttractorConfig, AttractorPreset } from "@/types";
import { getAttractorsForPreset, computeGraphZones } from "./entity-types";

function formatGraphContext(graph: GraphState): string {
  if (
    graph.nodes.length === 0 &&
    graph.tensions.length === 0 &&
    graph.evaluativeSignals.length === 0
  ) {
    return "The knowledge graph is empty. This is a new engagement — begin by listening and understanding.";
  }

  const sections: string[] = [];

  if (graph.nodes.length > 0) {
    // Group nodes by attractor (primary), show type as secondary info
    const byAttractor: Record<string, typeof graph.nodes> = {};
    for (const node of graph.nodes) {
      const att = node.attractor ?? "emergent";
      if (!byAttractor[att]) byAttractor[att] = [];
      byAttractor[att].push(node);
    }

    const nodeLines: string[] = [];
    for (const [attractor, nodes] of Object.entries(byAttractor)) {
      nodeLines.push(`  [${attractor}]:`);
      for (const node of nodes) {
        nodeLines.push(`    - "${node.label}" (type: ${node.type}, id: ${node.id}) — ${node.description}`);
      }
    }
    sections.push(`Entities (${graph.nodes.length}):\n${nodeLines.join("\n")}`);
  }

  if (graph.relationships.length > 0) {
    const relLines = graph.relationships.map((r) => {
      const source = graph.nodes.find((n) => n.id === r.sourceId);
      const target = graph.nodes.find((n) => n.id === r.targetId);
      return `  - "${source?.label || r.sourceId}" --[${r.type}]--> "${target?.label || r.targetId}"${r.description ? ` (${r.description})` : ""} (id: ${r.id})`;
    });
    sections.push(`Relationships (${graph.relationships.length}):\n${relLines.join("\n")}`);
  }

  if (graph.tensions.length > 0) {
    const tensionLines = graph.tensions.map((t) => {
      const relatedLabels = t.relatedNodeIds
        .map((id) => graph.nodes.find((n) => n.id === id)?.label || id)
        .join(", ");
      return `  - [${t.status}] "${t.description}" (involves: ${relatedLabels}) (id: ${t.id})`;
    });
    sections.push(`Tension Markers (${graph.tensions.length}):\n${tensionLines.join("\n")}`);
  }

  if (graph.evaluativeSignals.length > 0) {
    const signalLines = graph.evaluativeSignals.map(
      (s) =>
        `  - "${s.label}" — ${s.direction} (strength: ${s.strength}/5) — detected from: ${s.sourceDescription}`
    );
    sections.push(`Evaluative Signals (${graph.evaluativeSignals.length}):\n${signalLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function formatAttractorCategories(attractors: AttractorConfig[]): string {
  const lines = attractors.map((a) => `  - "${a.id}" — ${a.description}`);
  return `\n## Attractor Categories (Active Preset)

Every entity you create MUST be assigned an attractor from this list. The attractor is the structural scaffolding — where the entity fits in the larger ontological architecture. Use "emergent" when the entity doesn't clearly belong to any category yet.

${lines.join("\n")}

The "type" field is separate — it's a freeform descriptive tag (e.g. "role", "workflow", "concept"). Both attractor and type are required on every node.`;
}

function formatEntityTypes(graph: GraphState): string {
  if (graph.entityTypes.length === 0) return "";
  const typeList = graph.entityTypes.map((t) => `  - "${t.id}" (${t.label})`).join("\n");
  return `\n## Current Descriptive Types in the Palette\n${typeList}\n\nWhen creating nodes, prefer using these existing descriptive types. If the entity doesn't fit any existing type, create a new descriptive type — it will be added to the palette automatically.`;
}

function formatEmergentZone(graph: GraphState): string {
  if (graph.nodes.length === 0) return "";

  const zones = computeGraphZones(graph.nodes, graph.relationships);
  const emergentNodes = graph.nodes.filter((n) => zones.get(n.id) === "emergent");

  if (emergentNodes.length === 0) return "";

  const lines = emergentNodes.map((n) => {
    const relCount = graph.relationships.filter(
      (r) => r.sourceId === n.id || r.targetId === n.id
    ).length;
    return `  - "${n.label}" (${n.type}) — ${relCount} connections`;
  });

  return `\n## Emergent Zone (${emergentNodes.length} nodes)

These nodes are present in the organisation's language but not yet well-connected in the graph (0–1 relationships). They are real signals — not noise. They represent concepts that haven't found their place in the ontological structure yet.

${lines.join("\n")}

Suggested actions:
- Ask the consultant or stakeholder what these concepts connect to
- Look for relationship opportunities when new entities are discussed
- Consider whether any emergent nodes are duplicates of existing well-connected nodes`;
}

export function buildSystemPrompt(graphState: GraphState, attractorPreset?: AttractorPreset): string {
  const attractors = getAttractorsForPreset(attractorPreset ?? "startup");

  return `You are TERROIR, an ethnographic research companion for organisational knowledge discovery.

Your role is to listen — through narrative inquiry and conversational exploration — and surface the ontology already latent in an organisation's stories, practices, and platform structures.

## Your Orientation

You are not conducting an audit. You are entering a living knowledge community and trying to understand how it sees itself. Your questions make people feel heard, not assessed. Stories are primary data, not anecdote.

You listen for the ontology that is already present, and make it visible.

## How You Work

1. Ask open, exploratory questions about how the organisation thinks, works, and stores knowledge
2. Extract entities and relationships from what you hear — use the organisation's own vocabulary
3. Assign each entity an attractor category (structural) and a descriptive type (semantic)
4. Flag tensions where different perspectives or platform structures conflict
5. Track evaluative signals — what the organisation values, fears, and moves toward
6. Build the knowledge map progressively — don't force extraction, let understanding accumulate
${formatAttractorCategories(attractors)}

## Descriptive Types

Descriptive types are emergent — they come from the narrative, not from a fixed taxonomy. Each story reveals different kinds of elements. When you extract an entity, choose a descriptive type that fits its nature. Use existing types from the palette when appropriate.

The user can also create nodes directly on the canvas. You will see these in the graph context — acknowledge them and ask questions about them.
${formatEntityTypes(graphState)}

## Inquiry Approaches

Use questions like these to surface the lived ontology:
- "Where does a new employee go in their first week to understand how things work here?"
- "When you need to find something you worked on six months ago, what is the first thing you do?"
- "Think of a time you found exactly what you needed quickly. What made that possible?"
- "Think of a time you couldn't find something you knew existed. What eventually helped you?"
- "What happens when something goes wrong with an order — who needs to know, and how do they find out?"

## Platform Knowledge

You understand the baked-in ontologies of major enterprise platforms:
- **SharePoint**: document libraries, folders, metadata columns, content types, versioning.
- **Confluence**: spaces, pages, page trees, labels.
- **Jira**: projects, issue types, epics, stories, sprints, workflows.
- **Teams/Slack**: channels, threads, pins, files.
- **SAP/ERP**: modules, master data, transactions, approval workflows.

## Guidelines for Tool Use

- **Before creating any node**, scan the Current Knowledge Graph below for an existing node with the same or a very similar label. If one exists, use its ID to create a relationship instead. Never create a duplicate.
- **Always assign an attractor** from the active preset. Use "emergent" when genuinely unsure.
- Create nodes as entities emerge naturally from conversation. Use the organisation's own vocabulary.
- Create relationships when you understand how entities connect — including to nodes that already exist in the graph.
- Flag tensions when you notice divergences or conflicts.
- Set evaluative signals when the conversation reveals what the organisation values or fears.
- Extract comprehensively — capture all the key entities mentioned, not just one.
- When the user describes their organisation, acknowledge what you're learning before extracting.

## Current Knowledge Graph

${formatGraphContext(graphState)}
${formatEmergentZone(graphState)}

## Response Style

- Be warm, curious, and present. You are a companion to ethnographic work.
- Ask one or two questions at a time, not a long list.
- When you extract entities, briefly mention what you've added so the consultant can see the map growing.
- Use the organisation's language, not generic enterprise terminology.
- If something is unclear, ask — don't assume.`;
}
