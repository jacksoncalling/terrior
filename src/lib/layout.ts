import dagre from "dagre";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { GraphState } from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";

/** Above this node count, use force-directed layout (organic globe) — mirrors Canvas.tsx */
const COMPACT_THRESHOLD = 40;

/**
 * Auto-layout: force-directed for compact mode (organic globe/cluster),
 * dagre for card mode (hierarchical tree).
 */
export function autoLayout(
  state: GraphState,
  direction: "TB" | "LR" = "LR",
  nodeWidth?: number,
  nodeHeight?: number
): GraphState {
  if (state.nodes.length === 0) return state;

  const isCompact = state.nodes.length >= COMPACT_THRESHOLD;

  if (isCompact) {
    return forceLayout(state);
  }

  return dagreLayout(state, direction, nodeWidth ?? 200, nodeHeight ?? 80);
}

// ── Force-directed layout (Obsidian-style) ────────────────────────────────────

interface ForceNode extends SimulationNodeDatum {
  id: string;
  isHub: boolean;
}

function forceLayout(state: GraphState): GraphState {
  const nodeCount = state.nodes.length;

  // Seed positions in a compact random circle — avoids inheriting any
  // previous vertical/hierarchical layout that would bias the simulation
  const radius = Math.sqrt(nodeCount) * 6;
  const simNodes: ForceNode[] = state.nodes.map((n, i) => {
    const angle = (i / nodeCount) * 2 * Math.PI + (Math.random() - 0.5) * 0.5;
    const r = radius * (0.3 + Math.random() * 0.7);
    return {
      id: n.id,
      isHub: n.is_hub === true,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    };
  });

  const nodeIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  // Build links — semantic relationships only (exclude hub membership edges
  // which create star patterns that distort the organic layout)
  const simLinks: SimulationLinkDatum<ForceNode>[] = [];
  for (const rel of state.relationships) {
    if (rel.type === HUB_RELATIONSHIP_TYPE) continue;
    const si = nodeIndex.get(rel.sourceId);
    const ti = nodeIndex.get(rel.targetId);
    if (si !== undefined && ti !== undefined) {
      simLinks.push({ source: si, target: ti });
    }
  }

  // Tune forces for a compact organic globe:
  // - Mild repulsion keeps nodes apart without exploding
  // - Strong link force pulls connected nodes together (clustering)
  // - Center force keeps the whole graph from drifting
  // - Collision prevents overlap at the circle radius
  const sim = forceSimulation<ForceNode>(simNodes)
    .force(
      "link",
      forceLink<ForceNode, SimulationLinkDatum<ForceNode>>(simLinks)
        .distance(18)
        .strength(1.0)
    )
    .force("charge", forceManyBody<ForceNode>().strength(-5))
    .force("center", forceCenter(0, 0).strength(0.3))
    .force("collide", forceCollide<ForceNode>(8))
    .stop();

  // Run simulation to convergence (no animation — instant layout)
  const ticks = Math.max(200, Math.min(400, nodeCount * 2));
  sim.tick(ticks);

  // Map positions back
  const posMap = new Map(simNodes.map((n) => [n.id, { x: n.x!, y: n.y! }]));

  const updatedNodes = state.nodes.map((node) => {
    const pos = posMap.get(node.id);
    return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
  });

  return { ...state, nodes: updatedNodes };
}

// ── Dagre hierarchical layout (card mode) ─────────────────────────────────────

function dagreLayout(
  state: GraphState,
  direction: "TB" | "LR",
  nodeWidth: number,
  nodeHeight: number,
  sep: { nodesep: number; ranksep: number } = { nodesep: 80, ranksep: 120 }
): GraphState {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: sep.nodesep, ranksep: sep.ranksep });

  for (const node of state.nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  for (const rel of state.relationships) {
    g.setEdge(rel.sourceId, rel.targetId);
  }

  dagre.layout(g);

  const updatedNodes = state.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (dagreNode) {
      return {
        ...node,
        position: {
          x: dagreNode.x - nodeWidth / 2,
          y: dagreNode.y - nodeHeight / 2,
        },
      };
    }
    return node;
  });

  return { ...state, nodes: updatedNodes };
}
