/**
 * topology.ts
 *
 * Builds a compact topology payload from a GraphState for the
 * topology-aware signal enrichment pass (POST /api/topology-signals).
 *
 * The payload summarises hub health, cross-hub connectivity, tension
 * clustering, and emergent (isolated) entity density — giving Gemini
 * the structural context it needs to reason about organisational
 * reachability corridors rather than just document-stated values.
 */

import type { GraphState, ProjectBrief } from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface HubStat {
  id: string;                  // attractor_id slug, e.g. "domain"
  label: string;               // display label, e.g. "Domain"
  memberCount: number;         // entities with belongs_to_hub → this hub
  internalConnections: number; // semantic rels between members (excl. hub edges)
  tensionCount: number;        // unresolved tensions involving ≥1 member
}

export interface CrossHubLink {
  from: string;  // attractor_id slug
  to: string;    // attractor_id slug
  count: number; // semantic relationships crossing this hub boundary
}

export interface TopologyPayload {
  brief: {
    orgSize?: string;
    sector?: string;
    discoveryGoal?: string;
  };
  hubs: HubStat[];
  crossHubConnections: CrossHubLink[];  // sorted descending by count
  emergentCount: number;                // entities with 0–1 semantic rels
  totalEntities: number;                // non-hub nodes
  totalRelationships: number;           // non-hub edges
  topTensions: string[];                // up to 5 unresolved tension descriptions
  signals: {
    id: string;
    label: string;
    direction: string;
    source: string;                     // truncated sourceDescription for context
  }[];
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds a compact topology payload from the current graph state.
 *
 * All computation is pure (no Supabase calls) — the full graph must be
 * loaded before calling this. Designed to be called once per enrichment
 * pass and passed directly to enrichSignalsWithTopology().
 */
export function buildTopologyPayload(
  graph: GraphState,
  brief?: ProjectBrief | null
): TopologyPayload {
  const hubNodes    = graph.nodes.filter((n) => n.is_hub === true);
  const entityNodes = graph.nodes.filter((n) => n.is_hub !== true);

  // ── nodeId → hubSlug map (from belongs_to_hub edges) ────────────────────
  const nodeToHub: Record<string, string> = {};
  for (const rel of graph.relationships) {
    if (rel.type !== HUB_RELATIONSHIP_TYPE) continue;
    const hub = hubNodes.find((h) => h.id === rel.targetId);
    if (hub) {
      nodeToHub[rel.sourceId] = hub.properties?.attractor_id ?? hub.label.toLowerCase();
    }
  }

  // ── Per-hub stats ────────────────────────────────────────────────────────
  const hubs: HubStat[] = hubNodes.map((hub) => {
    const hubSlug = hub.properties?.attractor_id ?? hub.label.toLowerCase();

    const memberIds = new Set(
      graph.relationships
        .filter((r) => r.type === HUB_RELATIONSHIP_TYPE && r.targetId === hub.id)
        .map((r) => r.sourceId)
    );

    // Semantic rels where both endpoints belong to this hub
    const internalConnections = graph.relationships.filter(
      (r) =>
        r.type !== HUB_RELATIONSHIP_TYPE &&
        memberIds.has(r.sourceId) &&
        memberIds.has(r.targetId)
    ).length;

    // Unresolved tensions touching at least one member
    const tensionCount = graph.tensions.filter(
      (t) =>
        t.status === "unresolved" &&
        t.relatedNodeIds.some((id) => memberIds.has(id))
    ).length;

    return { id: hubSlug, label: hub.label, memberCount: memberIds.size, internalConnections, tensionCount };
  });

  // ── Cross-hub connection matrix ──────────────────────────────────────────
  // Count semantic rels that cross a hub boundary. Sorted heaviest first.
  const crossHubMap: Record<string, number> = {};
  for (const rel of graph.relationships) {
    if (rel.type === HUB_RELATIONSHIP_TYPE) continue;
    const fromHub = nodeToHub[rel.sourceId];
    const toHub   = nodeToHub[rel.targetId];
    if (fromHub && toHub && fromHub !== toHub) {
      // Sort the pair so A→B and B→A collapse into one key
      const key = [fromHub, toHub].sort().join("→");
      crossHubMap[key] = (crossHubMap[key] ?? 0) + 1;
    }
  }
  const crossHubConnections: CrossHubLink[] = Object.entries(crossHubMap)
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count);

  // ── Emergent count: entities with 0–1 semantic relationships ────────────
  const connectionCounts: Record<string, number> = {};
  for (const n of entityNodes) connectionCounts[n.id] = 0;
  for (const rel of graph.relationships) {
    if (rel.type === HUB_RELATIONSHIP_TYPE) continue;
    if (rel.sourceId in connectionCounts) connectionCounts[rel.sourceId]++;
    if (rel.targetId in connectionCounts) connectionCounts[rel.targetId]++;
  }
  const emergentCount = Object.values(connectionCounts).filter((c) => c <= 1).length;

  // ── Top 5 unresolved tensions ────────────────────────────────────────────
  const topTensions = graph.tensions
    .filter((t) => t.status === "unresolved")
    .slice(0, 5)
    .map((t) => t.description);

  // ── Signal list (id + label + direction + truncated source) ─────────────
  const signals = graph.evaluativeSignals.map((s) => ({
    id:        s.id,
    label:     s.label,
    direction: s.direction,
    source:    (s.sourceDescription ?? "").slice(0, 120),
  }));

  return {
    brief: {
      orgSize:       brief?.orgSize,
      sector:        brief?.sector,
      discoveryGoal: brief?.discoveryGoal,
    },
    hubs,
    crossHubConnections,
    emergentCount,
    totalEntities:      entityNodes.length,
    totalRelationships: graph.relationships.filter((r) => r.type !== HUB_RELATIONSHIP_TYPE).length,
    topTensions,
    signals,
  };
}
