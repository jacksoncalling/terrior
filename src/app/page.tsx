"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import Link from "next/link";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import Inspector from "@/components/Inspector";
import TypePalette from "@/components/TypePalette";
import type { ChatMessage, GraphState, GraphUpdate, GraphNode, Relationship } from "@/types";
import {
  emptyGraphState,
  saveToLocalStorage,
  loadFromLocalStorage,
  saveMessagesToLocalStorage,
  loadMessagesFromLocalStorage,
  loadLegacyGraphFromLocalStorage,
  clearLocalStorage,
  addNode,
  addRelationship,
  deleteNode,
  deleteRelationship,
  updateNode,
  updateNodePosition,
} from "@/lib/graph-state";
import { autoLayout } from "@/lib/layout";
import { addEntityType, updateEntityType } from "@/lib/entity-types";
import { loadOntology, saveOntology } from "@/lib/supabase";
import { useProject } from "@/lib/project-context";

// Debounce delay for Supabase saves (ms)
const SAVE_DEBOUNCE_MS = 800;

export default function Home() {
  const { projectId, project } = useProject();

  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [graphUpdatesMap, setGraphUpdatesMap] = useState<Record<string, GraphUpdate[]>>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Debounce ref for Supabase saves
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last project we loaded for (to reset on project switch)
  const loadedProjectRef = useRef<string | null>(null);

  // ── Load ontology on mount / project switch ──────────────────────────────

  useEffect(() => {
    if (!projectId) return;
    // Skip if already loaded for this project
    if (loadedProjectRef.current === projectId) return;

    setHydrated(false);
    loadedProjectRef.current = projectId;

    // Reset graph immediately so the old project's canvas doesn't flash while loading
    setGraphState(emptyGraphState());

    loadOntology(projectId)
      .then((supabaseGraph) => {
        if (supabaseGraph.nodes.length > 0 || supabaseGraph.relationships.length > 0) {
          // Supabase has data — use it as source of truth
          setGraphState(supabaseGraph);
        } else {
          // Supabase empty (e.g. debounced save didn't fire before navigation) —
          // fall back to project-scoped localStorage (safe: key includes projectId)
          const local = loadFromLocalStorage(projectId);
          if (local && (local.nodes.length > 0 || local.relationships.length > 0)) {
            setGraphState(local);
          }
        }
      })
      .catch((err) => {
        console.warn('Supabase load failed, falling back to localStorage:', err);
        const local = loadFromLocalStorage(projectId);
        if (local) setGraphState(local);
      })
      .finally(() => {
        setHydrated(true);
      });

    // Load messages from localStorage (project-scoped)
    const savedMessages = loadMessagesFromLocalStorage(projectId);
    if (savedMessages) setMessages(savedMessages);
    else setMessages([]); // clear messages from previous project
  }, [projectId]);

  // ── Save to localStorage (immediate, for resilience — project-scoped) ───────

  useEffect(() => {
    if (hydrated && projectId) saveToLocalStorage(graphState, projectId);
  }, [graphState, hydrated, projectId]);

  useEffect(() => {
    if (hydrated && projectId) saveMessagesToLocalStorage(messages, projectId);
  }, [messages, hydrated, projectId]);

  // ── Save to Supabase (debounced) ─────────────────────────────────────────

  useEffect(() => {
    if (!hydrated || !projectId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveOntology(projectId, graphState).catch((err) =>
        console.warn('Supabase save failed (non-fatal):', err)
      );
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [graphState, hydrated, projectId]);

  // ── Chat handler ─────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content,
        timestamp: Date.now(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setIsLoading(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
            graphState,
            projectId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to get response");
        }

        const result = await response.json();
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: result.response,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setGraphState(result.updatedGraph);

        if (result.graphUpdates?.length > 0) {
          setGraphUpdatesMap((prev) => ({
            ...prev,
            [assistantMessage.id]: result.graphUpdates,
          }));
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Something went wrong"}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, graphState, projectId]
  );

  // ── Extract handler ──────────────────────────────────────────────────────

  const handleExtract = useCallback(
    async (text: string) => {
      setIsLoading(true);

      const userMessage: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: `[Narrative extraction]\n${text.substring(0, 200)}${text.length > 200 ? "..." : ""}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const response = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, graphState, projectId }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Extraction failed");
        }

        const result = await response.json();
        const laidOut = autoLayout(result.updatedGraph);
        setGraphState(laidOut);

        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `Extracted ${result.graphUpdates.filter((u: GraphUpdate) => u.type === "node_created").length} entities and ${result.graphUpdates.filter((u: GraphUpdate) => u.type === "relationship_created").length} relationships from the narrative. Review the canvas and edit as needed.`,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (result.graphUpdates?.length > 0) {
          setGraphUpdatesMap((prev) => ({
            ...prev,
            [assistantMessage.id]: result.graphUpdates,
          }));
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `Extraction error: ${error instanceof Error ? error.message : "Something went wrong"}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [graphState, projectId]
  );

  // ── Canvas handlers ──────────────────────────────────────────────────────

  const handleAddNode = useCallback(
    (label: string, type: string, description: string, position: { x: number; y: number }) => {
      const { state } = addNode(graphState, label, type, description, position);
      setGraphState(state);
    },
    [graphState]
  );

  const handleAddRelationship = useCallback(
    (sourceId: string, targetId: string, type: string) => {
      const { state } = addRelationship(graphState, sourceId, targetId, type);
      setGraphState(state);
    },
    [graphState]
  );

  const handleNodePositionChange = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      setGraphState((prev) => updateNodePosition(prev, nodeId, position));
    },
    []
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setGraphState((prev) => deleteNode(prev, nodeId));
    },
    []
  );

  const handleDeleteRelationship = useCallback(
    (relId: string) => {
      setGraphState((prev) => deleteRelationship(prev, relId));
    },
    []
  );

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<Pick<GraphNode, "label" | "description" | "type">>) => {
      setGraphState((prev) => updateNode(prev, id, updates));
    },
    []
  );

  const handleUpdateRelationship = useCallback(
    (id: string, updates: Partial<Pick<Relationship, "type" | "description">>) => {
      setGraphState((prev) => ({
        ...prev,
        relationships: prev.relationships.map((r) =>
          r.id === id ? { ...r, ...updates } : r
        ),
      }));
    },
    []
  );

  const handleAutoLayout = useCallback(() => {
    setGraphState((prev) => autoLayout(prev));
  }, []);

  // ── Type palette handlers ────────────────────────────────────────────────

  const handleTypeUpdate = useCallback(
    (typeId: string, updates: Partial<{ label: string; color: string }>) => {
      setGraphState((prev) => ({
        ...prev,
        entityTypes: updateEntityType(prev.entityTypes, typeId, updates),
      }));
    },
    []
  );

  const handleTypeAdd = useCallback(
    (id: string, label: string) => {
      setGraphState((prev) => ({
        ...prev,
        entityTypes: addEntityType(prev.entityTypes, id, label),
      }));
    },
    []
  );

  // ── Export / Import ──────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const date = new Date().toISOString().split('T')[0];
    const filename = `ontology-${date}.json`;
    const json = JSON.stringify(graphState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [graphState]);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string) as GraphState;
        if (!imported.nodes || !imported.relationships) throw new Error('Invalid graph file');
        const laidOut = autoLayout(imported);
        setGraphState(laidOut);
        setMessages([]);
        setGraphUpdatesMap({});
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      } catch {
        alert('Failed to import: not a valid Terroir graph file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, []);

  const handleImport = useCallback(() => {
    importFileRef.current?.click();
  }, []);

  const handleReset = useCallback(() => {
    clearLocalStorage(projectId ?? undefined);
    setGraphState(emptyGraphState());
    setMessages([]);
    setGraphUpdatesMap({});
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [projectId]);

  // Phase 1 migration: import the legacy unscoped localStorage graph into this project
  const handleMigrateLegacy = useCallback(() => {
    const legacy = loadLegacyGraphFromLocalStorage();
    if (!legacy || legacy.nodes.length === 0) {
      alert('No Phase 1 graph found in localStorage to migrate.');
      return;
    }
    if (!confirm(`Import ${legacy.nodes.length} nodes and ${legacy.relationships.length} relationships from the Phase 1 graph into this project?`)) return;
    const laidOut = autoLayout(legacy);
    setGraphState(laidOut);
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-400">
          {project ? `Loading ${project.name}…` : 'Loading…'}
        </p>
      </div>
    );
  }

  // Apply type filter
  const filteredGraphState = typeFilter
    ? {
        ...graphState,
        nodes: graphState.nodes.filter((n) => n.type === typeFilter),
        relationships: graphState.relationships.filter((r) => {
          const filteredNodeIds = new Set(
            graphState.nodes.filter((n) => n.type === typeFilter).map((n) => n.id)
          );
          return filteredNodeIds.has(r.sourceId) && filteredNodeIds.has(r.targetId);
        }),
      }
    : graphState;

  return (
    <div className="flex h-screen bg-stone-50">
      {/* Chat panel */}
      <div className="w-[360px] shrink-0 border-r border-stone-200 bg-white flex flex-col">
        <Chat
          messages={messages}
          onSend={handleSend}
          onExtract={handleExtract}
          isLoading={isLoading}
          graphUpdatesMap={graphUpdatesMap}
        />
        {/* Bottom actions */}
        <div className="border-t border-stone-100 px-4 py-2 flex items-center gap-3">
          <button
            onClick={handleReset}
            className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Reset all
          </button>
          <span className="text-stone-200 select-none">|</span>
          <button
            onClick={handleImport}
            className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Import
          </button>
          <button
            onClick={handleExport}
            className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Export
          </button>
          <button
            onClick={handleMigrateLegacy}
            className="text-[10px] text-amber-500 hover:text-amber-700 transition-colors"
            title="Import Phase 1 graph from localStorage into this project"
          >
            ↑ Migrate v1
          </button>
          <span className="text-stone-200 select-none">|</span>
          <Link
            href="/projects"
            className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            ← Projects
          </Link>
          <span className="text-stone-200 select-none">|</span>
          <Link
            href="/compare"
            className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Compare →
          </Link>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Canvas panel */}
      <div className="flex-1 flex flex-col">
        {/* Project name bar */}
        {project && (
          <div className="px-4 py-1.5 bg-white border-b border-stone-100 flex items-center gap-2">
            <span className="text-[11px] font-medium text-stone-600">{project.name}</span>
            <span className="text-stone-300 text-[10px]">·</span>
            <span className="text-[10px] text-stone-400">{project.phase}</span>
          </div>
        )}
        <TypePalette
          entityTypes={graphState.entityTypes}
          onTypeUpdate={handleTypeUpdate}
          onTypeAdd={handleTypeAdd}
          activeFilter={typeFilter}
          onFilterChange={setTypeFilter}
        />
        <div className="flex-1 relative">
          <Canvas
            graphState={filteredGraphState}
            onNodeSelect={setSelectedNodeId}
            onEdgeSelect={setSelectedEdgeId}
            onAddNode={handleAddNode}
            onAddRelationship={handleAddRelationship}
            onNodePositionChange={handleNodePositionChange}
            onDeleteNode={handleDeleteNode}
            onDeleteRelationship={handleDeleteRelationship}
            onAutoLayout={handleAutoLayout}
            onExport={handleExport}
            onImport={handleImport}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
          />
        </div>
      </div>

      {/* Inspector panel */}
      {inspectorOpen && (
        <div className="w-[280px] shrink-0">
          <Inspector
            graphState={graphState}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onUpdateNode={handleUpdateNode}
            onUpdateRelationship={handleUpdateRelationship}
            onClose={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
