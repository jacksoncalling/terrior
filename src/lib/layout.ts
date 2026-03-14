import dagre from "dagre";
import type { GraphState } from "@/types";

/**
 * Auto-layout the graph using dagre (directed acyclic graph layout).
 * Returns a new GraphState with updated node positions.
 */
export function autoLayout(
  state: GraphState,
  direction: "TB" | "LR" = "LR",
  nodeWidth = 200,
  nodeHeight = 80
): GraphState {
  if (state.nodes.length === 0) return state;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120 });

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
