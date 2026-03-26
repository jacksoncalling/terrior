"use client";

import { useCallback, useMemo, useState } from "react";
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
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import OntologyNode from "./OntologyNode";
import OntologyEdge from "./OntologyEdge";
import type { GraphState, GraphNode, EntityTypeConfig, AttractorConfig, NodeZone } from "@/types";
import { computeGraphZones } from "@/lib/entity-types";
import { autoLayout } from "@/lib/layout";

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
}

const nodeTypes = { ontology: OntologyNode };
const edgeTypes = { ontology: OntologyEdge };

function graphStateToFlow(
  graphState: GraphState,
  attractors?: AttractorConfig[],
  zones?: Map<string, NodeZone>
): { nodes: Node[]; edges: Edge[] } {
  const tensionNodeIds = new Set(
    graphState.tensions
      .filter((t) => t.status === "unresolved")
      .flatMap((t) => t.relatedNodeIds)
  );

  // Compute zones locally if not provided
  const nodeZones = zones ?? computeGraphZones(graphState.nodes, graphState.relationships);

  const nodes: Node[] = graphState.nodes.map((node) => ({
    id: node.id,
    type: "ontology",
    position: node.position,
    draggable: !node.readonly,
    data: {
      label: node.label,
      type: node.type,
      attractor: node.attractor ?? "emergent",
      description: node.description,
      entityTypes: graphState.entityTypes,
      attractors: attractors ?? [],
      zone: nodeZones.get(node.id) ?? "emergent",
      hasTension: tensionNodeIds.has(node.id),
      readonly: node.readonly,
    },
  }));

  const edges: Edge[] = graphState.relationships.map((rel) => ({
    id: rel.id,
    source: rel.sourceId,
    target: rel.targetId,
    type: "ontology",
    data: { label: rel.type, description: rel.description },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#d6d3d1" },
  }));

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

  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => graphStateToFlow(graphState, attractors, graphZones),
    [graphState, attractors, graphZones]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync React Flow state with graphState when it changes externally
  useMemo(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

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
  }, [onNodeSelect, onEdgeSelect]);

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
                  {graphState.nodes.length}
                </span>{" "}
                entities
                {graphState.relationships.length > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-stone-700">
                      {graphState.relationships.length}
                    </span>{" "}
                    relationships
                  </>
                )}
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
                onClick={onAutoLayout}
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
