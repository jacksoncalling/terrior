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

// ── Bundle schema ────────────────────────────────────────────────────────────

export interface ProjectBundle {
  schema_version: "1.0";
  exported_at: string;              // ISO timestamp
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
}

export function buildProjectBundle(input: BuildBundleInput): ProjectBundle {
  const {
    projectName,
    graphState,
    projectBrief,
    synthesisResult,
    classifications = [],
    documentCount = 0,
  } = input;

  return {
    schema_version: "1.0",
    exported_at: new Date().toISOString(),
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
      nodeCount: graphState.nodes.filter((n) => !n.is_hub).length,
      hubCount: getHubNodes(graphState).length,
      relationshipCount: graphState.relationships.filter((r) => r.type !== HUB_RELATIONSHIP_TYPE).length,
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
