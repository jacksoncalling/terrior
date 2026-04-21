"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import OntologyNode from "./OntologyNode";
import CompactNode from "./CompactNode";
import OntologyEdge from "./OntologyEdge";
import type { GraphState, GraphNode, EntityTypeConfig, AttractorConfig, NodeZone } from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";
import { computeGraphZones } from "@/lib/entity-types";
import { computeIntensityMap } from "@/lib/evaluative";
import { autoLayout } from "@/lib/layout";

/** Always use compact circles — threshold set to 0 */
const COMPACT_MODE_THRESHOLD = 0;

interface CanvasProps {
  graphState: GraphState;
  onNodeSelect: (nodeId: string | null) => void;
  onEdgeSelect: (edgeId: string | null) => void;
  onAddNode: (label: string, type: string, description: string, position: { x: number; y: number }) => void;
  onAddRelationship: (sourceId: string, targetId: string, type: string) => void;
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  onAutoLayout: () => void;
  onExport: () => void;
  onImport: () => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  attractors?: AttractorConfig[];
  graphZones?: Map<string, NodeZone>;
  /** Total node count across the unfiltered graph — used to show "Showing X of Y" */
  totalNodeCount?: number;
  /** Node labels to highlight via the synthesis Invitation block */
  synthesisHighlightedNodeNames?: string[];
  /** Called when the user clicks the empty canvas — clears the synthesis highlight */
  onClearSynthesisHighlight?: () => void;
}

const nodeTypes = { ontology: OntologyNode, compact: CompactNode };
const edgeTypes = { ontology: OntologyEdge };

function graphStateToFlow(
  graphState: GraphState,
  attractors?: AttractorConfig[],
  zones?: Map<string, NodeZone>,
  selectedNodeId?: string | null
): { nodes: Node[]; edges: Edge[] } {
  const tensionNodeIds = new Set(
    graphState.tensions
      .filter((t) => t.status === "unresolved")
      .flatMap((t) => t.relatedNodeIds)
  );

  // Compute zones locally if not provided
  const nodeZones = zones ?? computeGraphZones(graphState.nodes, graphState.relationships);

  // Compute evaluative intensity per node (once per render, O(nodes × signals))
  const intensityMap = computeIntensityMap(
    graphState.nodes.map((n) => n.id),
    graphState.evaluativeSignals
  );

  // Build an index of nodes by ID for O(1) lookups (avoids O(N×M) at scale)
  const nodeById = new Map<string, GraphNode>();
  for (const node of graphState.nodes) {
    nodeById.set(node.id, node);
  }

  // Build a map of node → primary hub color for visual inheritance
  const nodeHubColorMap = new Map<string, string>();
  for (const rel of graphState.relationships) {
    if (rel.type === HUB_RELATIONSHIP_TYPE) {
      const hub = nodeById.get(rel.targetId);
      if (hub?.is_hub && !nodeHubColorMap.has(rel.sourceId)) {
        nodeHubColorMap.set(rel.sourceId, hub.properties?.color ?? "#78716c");
      }
    }
  }

  // --- Click-to-highlight: compute neighbor set for selected node ---
  const neighborIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  if (selectedNodeId) {
    neighborIds.add(selectedNodeId);
    for (const rel of graphState.relationships) {
      if (rel.sourceId === selectedNodeId || rel.targetId === selectedNodeId) {
        neighborIds.add(rel.sourceId);
        neighborIds.add(rel.targetId);
        highlightedEdgeIds.add(rel.id);
      }
    }
  }
  const hasSelection = !!selectedNodeId;

  // --- Compact mode: use small circles above threshold ---
  const useCompact = graphState.nodes.length >= COMPACT_MODE_THRESHOLD;

  const nodes: Node[] = graphState.nodes.map((node) => ({
    id: node.id,
    type: useCompact ? "compact" : "ontology",
    position: node.position,
    draggable: !node.readonly && !node.is_hub,
    data: {
      label: node.label,
      type: node.type,
      attractor: node.attractor ?? "emergent",
      is_hub: node.is_hub,
      description: node.description,
      entityTypes: graphState.entityTypes,
      attractors: attractors ?? [],
      zone: node.is_hub ? "integrated" : (nodeZones.get(node.id) ?? "emergent"),
      hasTension: tensionNodeIds.has(node.id),
      readonly: node.readonly,
      hubColor: node.is_hub
        ? (node.properties?.color ?? "#78716c")
        : nodeHubColorMap.get(node.id),
      intensity: intensityMap.get(node.id) ?? 0,
      // Highlight/dim applied in the overlay memo; defaults here for base pass
      highlighted: hasSelection && neighborIds.has(node.id),
      dimmed: hasSelection && !neighborIds.has(node.id),
      synthesisHighlighted: false,
    },
  }));

  const edges: Edge[] = graphState.relationships.map((rel) => {
    const isHubEdge = rel.type === HUB_RELATIONSHIP_TYPE;
    const isHighlighted = highlightedEdgeIds.has(rel.id);
    const isDimmed = hasSelection && !isHighlighted;

    // In compact mode with no selection, hide all edge labels (highlight pass shows them selectively)
    const showLabel = isHubEdge ? false : (useCompact ? isHighlighted : true);

    return {
      id: rel.id,
      source: rel.sourceId,
      target: rel.targetId,
      type: "ontology",
      data: {
        label: showLabel ? rel.type : "",
        rawLabel: isHubEdge ? "" : rel.type, // Preserved for highlight pass to restore
        description: rel.description,
        isHubEdge,
        highlighted: isHighlighted,
        dimmed: isDimmed,
      },
      style: isHubEdge
        ? { strokeDasharray: "4 4", stroke: "#d6d3d1", strokeWidth: 1, opacity: isDimmed ? 0.1 : 1 }
        : {
            stroke: isHighlighted ? "#1c1917" : "#d6d3d1",
            strokeWidth: isHighlighted ? 2 : 1.5,
            opacity: isDimmed ? 0.1 : 1,
            transition: "opacity 150ms",
          },
      markerEnd: isHubEdge
        ? undefined
        : { type: MarkerType.ArrowClosed, color: isHighlighted ? "#1c1917" : "#d6d3d1" },
    };
  });

  return { nodes, edges };
}

export default function Canvas({
  graphState,
  onNodeSelect,
  onEdgeSelect,
  onAddNode,
  onAddRelationship,
  onNodePositionChange,
  onDeleteNode,
  onDeleteRelationship,
  onAutoLayout,
  onExport,
  onImport,
  selectedNodeId,
  selectedEdgeId,
  attractors,
  graphZones,
  totalNodeCount,
  synthesisHighlightedNodeNames = [],
  onClearSynthesisHighlight,
}: CanvasProps) {
  const [showNewNodeDialog, setShowNewNodeDialog] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showEdgeDialog, setShowEdgeDialog] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [newNodeLabel, setNewNodeLabel] = useState("");
  const [newNodeType, setNewNodeType] = useState("process");
  const [newEdgeType, setNewEdgeType] = useState("related_to");

  // Two-phase computation: base structure (expensive, changes with graphState)
  // then highlight overlay (cheap, changes with selectedNodeId or synthesis highlight)
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => graphStateToFlow(graphState, attractors, graphZones, null),
    [graphState, attractors, graphZones]
  );

  // Lightweight highlight pass — selection neighbour glow + synthesis invitation glow
  const synthesisHighlightSet = useMemo(
    () => new Set(synthesisHighlightedNodeNames),
    [synthesisHighlightedNodeNames]
  );
  const hasSynthesisHighlight = synthesisHighlightSet.size > 0;

  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!selectedNodeId && !hasSynthesisHighlight) return { nodes: baseNodes, edges: baseEdges };

    const neighborIds = new Set<string>(selectedNodeId ? [selectedNodeId] : []);
    const highlightedEdgeIds = new Set<string>();
    for (const rel of graphState.relationships) {
      if (rel.sourceId === selectedNodeId || rel.targetId === selectedNodeId) {
        neighborIds.add(rel.sourceId);
        neighborIds.add(rel.targetId);
        highlightedEdgeIds.add(rel.id);
      }
    }

    const nodes = baseNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        highlighted: selectedNodeId ? neighborIds.has(node.id) : false,
        dimmed: selectedNodeId ? !neighborIds.has(node.id) : false,
        selected: node.id === selectedNodeId,
        // Synthesis highlight: pulsing ring when named by the Invitation block
        synthesisHighlighted: hasSynthesisHighlight && synthesisHighlightSet.has(node.data.label as string),
      },
    }));

    const edges = baseEdges.map((edge) => {
      const isHighlighted = highlightedEdgeIds.has(edge.id);
      // Only dim edges when a node is selected — synthesis highlight alone should not grey the graph
      const isDimmed = selectedNodeId ? !isHighlighted : false;
      const isHubEdge = (edge.data as Record<string, unknown>)?.isHubEdge === true;
      const useCompact = graphState.nodes.length >= COMPACT_MODE_THRESHOLD;
      const rawLabel = ((edge.data as Record<string, unknown>)?.rawLabel as string) ?? "";
      // In compact mode, hide all edge labels — they overlap in dense clusters.
      // Relationship types are visible in the Inspector when an edge is clicked.
      const showLabel = isHubEdge ? false : (useCompact ? false : true);

      return {
        ...edge,
        data: {
          ...edge.data,
          label: showLabel ? rawLabel : "",
          highlighted: isHighlighted,
          dimmed: isDimmed,
        },
        style: isHubEdge
          ? { strokeDasharray: "4 4", stroke: "#d6d3d1", strokeWidth: 1, opacity: isDimmed ? 0.1 : 1 }
          : {
              stroke: isHighlighted ? "#1c1917" : "#d6d3d1",
              strokeWidth: isHighlighted ? 2 : 1.5,
              opacity: isDimmed ? 0.1 : 1,
              transition: "opacity 150ms",
            },
        markerEnd: isHubEdge
          ? undefined
          : { type: MarkerType.ArrowClosed, color: isHighlighted ? "#1c1917" : "#d6d3d1" },
      };
    });

    return { nodes, edges };
  }, [baseNodes, baseEdges, selectedNodeId, graphState.relationships, graphState.nodes.length, synthesisHighlightSet, hasSynthesisHighlight]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const fitViewPending = useRef(false);
  const initialFitDone = useRef(false);

  // Sync React Flow state with graphState when it changes externally
  useMemo(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
    // If a fitView was requested (after auto-layout), schedule it now
    if (fitViewPending.current && rfInstance.current) {
      const timer = setTimeout(() => {
        rfInstance.current?.fitView({ padding: 0.15, duration: 300 });
        fitViewPending.current = false;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  // fitView fires at mount when graph is empty; this one-shot fires after the first real load
  useEffect(() => {
    if (!initialFitDone.current && nodes.length > 0) {
      initialFitDone.current = true;
      setTimeout(() => {
        rfInstance.current?.fitView({ padding: 0.15, duration: 300 });
      }, 300);
    }
  }, [nodes.length]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect(node.id);
      onEdgeSelect(null);
    },
    [onNodeSelect, onEdgeSelect]
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onEdgeSelect(edge.id);
      onNodeSelect(null);
    },
    [onEdgeSelect, onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
    onEdgeSelect(null);
    // Clear any synthesis Invitation highlight when the user clicks empty canvas
    onClearSynthesisHighlight?.();
  }, [onNodeSelect, onEdgeSelect, onClearSynthesisHighlight]);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Get canvas position from the event
      const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      if (!bounds) return;

      setShowNewNodeDialog({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      setNewNodeLabel("");
      setNewNodeType(graphState.entityTypes[0]?.id || "process");
    },
    [graphState.entityTypes]
  );

  const handleCreateNode = useCallback(() => {
    if (!newNodeLabel.trim() || !showNewNodeDialog) return;
    onAddNode(
      newNodeLabel.trim(),
      newNodeType,
      "",
      showNewNodeDialog
    );
    setShowNewNodeDialog(null);
    setNewNodeLabel("");
  }, [newNodeLabel, newNodeType, showNewNodeDialog, onAddNode]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        setShowEdgeDialog({
          source: connection.source,
          target: connection.target,
        });
        setNewEdgeType("related_to");
      }
    },
    []
  );

  const handleCreateEdge = useCallback(() => {
    if (!showEdgeDialog) return;
    onAddRelationship(showEdgeDialog.source, showEdgeDialog.target, newEdgeType);
    setShowEdgeDialog(null);
  }, [showEdgeDialog, newEdgeType, onAddRelationship]);

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          onNodePositionChange(change.id, change.position);
        }
      }
    },
    [onNodesChange, onNodePositionChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeId) {
          onDeleteNode(selectedNodeId);
          onNodeSelect(null);
        } else if (selectedEdgeId) {
          onDeleteRelationship(selectedEdgeId);
          onEdgeSelect(null);
        }
      }
    },
    [selectedNodeId, selectedEdgeId, onDeleteNode, onDeleteRelationship, onNodeSelect, onEdgeSelect]
  );

  const isEmpty = graphState.nodes.length === 0;

  return (
    <div className="h-full w-full relative" onKeyDown={handleKeyDown} tabIndex={0}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onDoubleClick={handleDoubleClick}
        onConnect={handleConnect}
        onInit={(instance) => { rfInstance.current = instance; }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "ontology",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#d6d3d1" },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e7e5e4" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-white !border-stone-200 !shadow-sm"
        />
        <MiniMap
          nodeColor={(node) => {
            const typeConfig = graphState.entityTypes.find(
              (t) => t.id === (node.data as Record<string, unknown>)?.type
            );
            return typeConfig?.color || "#78716c";
          }}
          className="!bg-white/90 !border-stone-200"
        />

        {/* Stats panel */}
        <Panel position="top-left">
          <div className="rounded-lg bg-white/90 px-3 py-2 text-xs text-stone-500 shadow-sm backdrop-blur-sm border border-stone-100">
            {isEmpty ? (
              <span className="text-stone-400">Double-click to add a node</span>
            ) : (
              <>
                <span className="font-medium text-stone-700">
                  {graphState.nodes.filter((n) => !n.is_hub).length}
                </span>{" "}
                {totalNodeCount != null && totalNodeCount > graphState.nodes.filter((n) => !n.is_hub).length ? (
                  <>
                    <span className="text-stone-400">of {totalNodeCount}</span>{" "}
                    entities
                  </>
                ) : (
                  "entities"
                )}
                {(() => {
                  const semanticRels = graphState.relationships.filter((r) => r.type !== HUB_RELATIONSHIP_TYPE);
                  return semanticRels.length > 0 ? (
                    <>
                      {" · "}
                      <span className="font-medium text-stone-700">
                        {semanticRels.length}
                      </span>{" "}
                      relationships
                    </>
                  ) : null;
                })()}
                {graphState.tensions.filter((t) => t.status === "unresolved").length > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-red-600">
                      {graphState.tensions.filter((t) => t.status === "unresolved").length}
                    </span>{" "}
                    tensions
                  </>
                )}
              </>
            )}
          </div>
        </Panel>

        {/* Top-right toolbar: Import / Export / Auto-layout */}
        <Panel position="top-right">
          <div className="flex gap-1.5">
            <button
              onClick={onImport}
              className="rounded-lg bg-white/90 px-3 py-1.5 text-xs text-stone-600 shadow-sm backdrop-blur-sm border border-stone-100 hover:bg-white transition-colors"
            >
              Import
            </button>
            <button
              onClick={onExport}
              disabled={isEmpty}
              className="rounded-lg bg-white/90 px-3 py-1.5 text-xs text-stone-600 shadow-sm backdrop-blur-sm border border-stone-100 hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export
            </button>
            {!isEmpty && (
              <button
                onClick={() => { fitViewPending.current = true; onAutoLayout(); }}
                className="rounded-lg bg-white/90 px-3 py-1.5 text-xs text-stone-600 shadow-sm backdrop-blur-sm border border-stone-100 hover:bg-white transition-colors"
              >
                Auto-layout
              </button>
            )}
          </div>
        </Panel>

        {/* Evaluative signals are displayed in the Reflect tab (Chat panel) — not on the canvas */}
      </ReactFlow>

      {/* New node dialog */}
      {showNewNodeDialog && (
        <div
          className="absolute z-50 rounded-lg bg-white p-3 shadow-lg border border-stone-200"
          style={{
            left: showNewNodeDialog.x,
            top: showNewNodeDialog.y,
          }}
        >
          <input
            autoFocus
            type="text"
            value={newNodeLabel}
            onChange={(e) => setNewNodeLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateNode();
              if (e.key === "Escape") setShowNewNodeDialog(null);
            }}
            placeholder="Entity name..."
            className="w-48 rounded border border-stone-200 px-2 py-1.5 text-sm text-stone-800 focus:border-stone-400 focus:outline-none"
          />
          <select
            value={newNodeType}
            onChange={(e) => setNewNodeType(e.target.value)}
            className="mt-2 w-48 rounded border border-stone-200 px-2 py-1.5 text-xs text-stone-600 focus:outline-none"
          >
            {graphState.entityTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="__custom">+ New type...</option>
          </select>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleCreateNode}
              disabled={!newNodeLabel.trim()}
              className="rounded bg-stone-800 px-3 py-1 text-xs text-white hover:bg-stone-700 disabled:bg-stone-300"
            >
              Add
            </button>
            <button
              onClick={() => setShowNewNodeDialog(null)}
              className="rounded px-3 py-1 text-xs text-stone-500 hover:text-stone-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New edge dialog */}
      {showEdgeDialog && (
        <div className="absolute z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-3 shadow-lg border border-stone-200">
          <p className="text-xs text-stone-500 mb-2">Relationship type:</p>
          <input
            autoFocus
            type="text"
            value={newEdgeType}
            onChange={(e) => setNewEdgeType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateEdge();
              if (e.key === "Escape") setShowEdgeDialog(null);
            }}
            placeholder="e.g., uses, contains, depends_on..."
            className="w-56 rounded border border-stone-200 px-2 py-1.5 text-sm text-stone-800 focus:border-stone-400 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleCreateEdge}
              className="rounded bg-stone-800 px-3 py-1 text-xs text-white hover:bg-stone-700"
            >
              Create
            </button>
            <button
              onClick={() => setShowEdgeDialog(null)}
              className="rounded px-3 py-1 text-xs text-stone-500 hover:text-stone-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
