/**
 * export.ts — Project bundle export for PoC handover.
 *
 * Assembles a single JSON file containing everything Terroir knows about a
 * project: graph state, synthesis result, project brief, document classifications,
 * and entity type definitions.
 *
 * The bundle is machine-readable — designed to be consumed by RAG pipelines,
 * agent context layers, or imported into other tools. The schema_version field
 * ensures forward compatibility as the format evolves.
 *
 * v1.1: Added `meta` block — an agent-oriented header that lets consumers
 * orient themselves before traversing the graph. Inspired by the handoff brief:
 * "The agent never sees 145 raw nodes. It sees the brief, the key themes,
 * and the 5-10 nodes most relevant to what it's being asked."
 *
 * Usage:
 *   const bundle = buildProjectBundle({ projectName, graphState, ... });
 *   downloadProjectBundle(bundle);
 */

import type {
  GraphState,
  ProjectBrief,
  SynthesisResult,
  DocumentClassification,
} from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";
import { computeGraphZones, getHubNodes, getHubMembers } from "./entity-types";

// ── Meta block — agent-oriented project header ──────────────────────────────
// Provides everything an agent needs to understand the graph before reading it.
// Designed for system prompt injection: the builder reads `meta` first, then
// selectively pulls nodes and signals relevant to the current query.

export interface ExportMeta {
  project_name: string;
  project_brief: string | null;          // prose summary from scoping
  org_size: string | null;
  sector: string | null;
  discovery_goal: string | null;
  extraction_lens: string | null;        // abstractionLayer
  key_themes: string[];
  attractor_preset: string | null;
  graph_summary: {
    entities: number;                     // non-hub nodes
    hubs: number;
    relationships: number;               // non-hub relationships
    unresolved_tensions: number;
    evaluative_signals: number;
    attractor_distribution: Record<string, number>;  // hub_label → member count
  };
  exported_at: string;
}

// ── Bundle schema ────────────────────────────────────────────────────────────

export interface ProjectBundle {
  schema_version: "1.1";
  meta: ExportMeta;
  project: {
    name: string;
    brief: ProjectBrief | null;
  };
  ontology: {
    nodes: GraphState["nodes"];
    relationships: GraphState["relationships"];
    tensions: GraphState["tensions"];
    evaluativeSignals: GraphState["evaluativeSignals"];
    entityTypes: GraphState["entityTypes"];
  };
  synthesis: SynthesisResult | null;
  classifications: DocumentClassification[];
  // Kept for backward compat — meta.graph_summary is the preferred source
  stats: {
    nodeCount: number;
    hubCount: number;
    relationshipCount: number;
    tensionCount: number;
    entityTypeCount: number;
    documentCount: number;
  };
}

// ── Build the bundle from in-memory state ────────────────────────────────────

export interface BuildBundleInput {
  projectName: string;
  graphState: GraphState;
  projectBrief: ProjectBrief | null;
  synthesisResult: SynthesisResult | null;
  classifications?: DocumentClassification[];
  documentCount?: number;
  attractorPreset?: string | null;
}

/**
 * Compute hub membership distribution — how many non-hub nodes belong to each hub.
 * Traverses `belongs_to_hub` relationships to count members per hub label.
 */
function computeAttractorDistribution(graphState: GraphState): Record<string, number> {
  const hubs = getHubNodes(graphState);
  const distribution: Record<string, number> = {};

  for (const hub of hubs) {
    const members = getHubMembers(hub.id, graphState);
    distribution[hub.label] = members.length;
  }

  // Count nodes not connected to any hub
  const allMemberIds = new Set<string>();
  for (const hub of hubs) {
    for (const m of getHubMembers(hub.id, graphState)) {
      allMemberIds.add(m.id);
    }
  }
  const orphanCount = graphState.nodes.filter(
    (n) => !n.is_hub && !allMemberIds.has(n.id)
  ).length;
  if (orphanCount > 0) {
    distribution["(unlinked)"] = orphanCount;
  }

  return distribution;
}

export function buildProjectBundle(input: BuildBundleInput): ProjectBundle {
  const {
    projectName,
    graphState,
    projectBrief,
    synthesisResult,
    classifications = [],
    documentCount = 0,
    attractorPreset = null,
  } = input;

  const semanticRels = graphState.relationships.filter(
    (r) => r.type !== HUB_RELATIONSHIP_TYPE
  );
  const unresolvedTensions = graphState.tensions.filter(
    (t) => t.status === "unresolved"
  );
  const hubCount = getHubNodes(graphState).length;
  const entityCount = graphState.nodes.filter((n) => !n.is_hub).length;

  // ── Build agent-oriented meta header ────────────────────────────────────
  const meta: ExportMeta = {
    project_name: projectName,
    project_brief: projectBrief?.summary ?? null,
    org_size: projectBrief?.orgSize ?? null,
    sector: projectBrief?.sector ?? null,
    discovery_goal: projectBrief?.discoveryGoal ?? null,
    extraction_lens: projectBrief?.abstractionLayer ?? null,
    key_themes: projectBrief?.keyThemes ?? [],
    attractor_preset: attractorPreset ?? null,
    graph_summary: {
      entities: entityCount,
      hubs: hubCount,
      relationships: semanticRels.length,
      unresolved_tensions: unresolvedTensions.length,
      evaluative_signals: graphState.evaluativeSignals.length,
      attractor_distribution: computeAttractorDistribution(graphState),
    },
    exported_at: new Date().toISOString(),
  };

  return {
    schema_version: "1.1",
    meta,
    project: {
      name: projectName,
      brief: projectBrief,
    },
    ontology: {
      nodes: (() => {
        const zones = computeGraphZones(graphState.nodes, graphState.relationships);
        return graphState.nodes.map((n) => ({
          ...n,
          zone: zones.get(n.id) ?? "emergent",
        }));
      })(),
      relationships: graphState.relationships,
      tensions: graphState.tensions,
      evaluativeSignals: graphState.evaluativeSignals,
      entityTypes: graphState.entityTypes,
    },
    synthesis: synthesisResult,
    classifications,
    stats: {
      nodeCount: entityCount,
      hubCount,
      relationshipCount: semanticRels.length,
      tensionCount: graphState.tensions.length,
      entityTypeCount: graphState.entityTypes.length,
      documentCount,
    },
  };
}

// ── Download as JSON file ────────────────────────────────────────────────────

export function downloadProjectBundle(bundle: ProjectBundle): void {
  const date = new Date().toISOString().split("T")[0];
  // Sanitise project name for filename (lowercase, hyphens, no special chars)
  const safeName = bundle.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const filename = `terroir-${safeName}-${date}.json`;
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
