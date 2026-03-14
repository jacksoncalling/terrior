import { v4 as uuidv4 } from "uuid";
import type {
  GraphState,
  GraphNode,
  Relationship,
  TensionMarker,
  EvaluativeSignal,
  EntityTypeConfig,
} from "@/types";
import { getDefaultEntityTypes, ensureTypeExists } from "./entity-types";

export function emptyGraphState(): GraphState {
  return {
    nodes: [],
    relationships: [],
    tensions: [],
    evaluativeSignals: [],
    entityTypes: getDefaultEntityTypes(),
  };
}

export function addNode(
  state: GraphState,
  label: string,
  type: string,
  description: string,
  position: { x: number; y: number },
  properties?: Record<string, string>
): { state: GraphState; node: GraphNode } {
  const node: GraphNode = {
    id: uuidv4(),
    label,
    type,
    description,
    position,
    properties,
  };
  const updatedTypes = ensureTypeExists(state.entityTypes, type);
  return {
    state: {
      ...state,
      nodes: [...state.nodes, node],
      entityTypes: updatedTypes,
    },
    node,
  };
}

export function updateNode(
  state: GraphState,
  id: string,
  updates: Partial<Pick<GraphNode, "label" | "description" | "type" | "properties" | "position">>
): GraphState {
  let updatedTypes = state.entityTypes;
  if (updates.type) {
    updatedTypes = ensureTypeExists(updatedTypes, updates.type);
  }
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    entityTypes: updatedTypes,
  };
}

export function updateNodePosition(
  state: GraphState,
  id: string,
  position: { x: number; y: number }
): GraphState {
  return {
    ...state,
    nodes: state.nodes.map((n) =>
      n.id === id ? { ...n, position } : n
    ),
  };
}

export function deleteNode(state: GraphState, id: string): GraphState {
  return {
    ...state,
    nodes: state.nodes.filter((n) => n.id !== id),
    relationships: state.relationships.filter(
      (r) => r.sourceId !== id && r.targetId !== id
    ),
    tensions: state.tensions.map((t) => ({
      ...t,
      relatedNodeIds: t.relatedNodeIds.filter((nid) => nid !== id),
    })),
  };
}

export function addRelationship(
  state: GraphState,
  sourceId: string,
  targetId: string,
  type: string,
  description?: string
): { state: GraphState; relationship: Relationship } {
  const relationship: Relationship = {
    id: uuidv4(),
    sourceId,
    targetId,
    type,
    description,
  };
  return {
    state: { ...state, relationships: [...state.relationships, relationship] },
    relationship,
  };
}

export function deleteRelationship(state: GraphState, id: string): GraphState {
  return {
    ...state,
    relationships: state.relationships.filter((r) => r.id !== id),
  };
}

export function flagTension(
  state: GraphState,
  description: string,
  relatedNodeIds: string[]
): { state: GraphState; tension: TensionMarker } {
  const tension: TensionMarker = {
    id: uuidv4(),
    description,
    relatedNodeIds,
    status: "unresolved",
  };
  return {
    state: { ...state, tensions: [...state.tensions, tension] },
    tension,
  };
}

export function resolveTension(state: GraphState, id: string): GraphState {
  return {
    ...state,
    tensions: state.tensions.map((t) =>
      t.id === id ? { ...t, status: "resolved" as const } : t
    ),
  };
}

export function setEvaluativeSignal(
  state: GraphState,
  label: string,
  direction: EvaluativeSignal["direction"],
  strength: number,
  sourceDescription: string
): { state: GraphState; signal: EvaluativeSignal } {
  const existing = state.evaluativeSignals.find((s) => s.label === label);
  if (existing) {
    const updated = { ...existing, direction, strength, sourceDescription };
    return {
      state: {
        ...state,
        evaluativeSignals: state.evaluativeSignals.map((s) =>
          s.id === existing.id ? updated : s
        ),
      },
      signal: updated,
    };
  }
  const signal: EvaluativeSignal = {
    id: uuidv4(),
    label,
    direction,
    strength,
    sourceDescription,
  };
  return {
    state: {
      ...state,
      evaluativeSignals: [...state.evaluativeSignals, signal],
    },
    signal,
  };
}

export function updateEntityTypes(
  state: GraphState,
  entityTypes: EntityTypeConfig[]
): GraphState {
  return { ...state, entityTypes };
}

// Keys — graph is now project-scoped; legacy unscoped key kept for Phase 1 migration only
const LEGACY_STORAGE_KEY = "terroir-graph-state-v2";
const LEGACY_MESSAGES_KEY = "terroir-messages-v2";

const graphKey = (projectId: string) => `terroir-graph-v2:${projectId}`;
const messagesKey = (projectId: string) => `terroir-messages-v2:${projectId}`;

export function saveToLocalStorage(state: GraphState, projectId?: string): void {
  if (typeof window !== "undefined") {
    const key = projectId ? graphKey(projectId) : LEGACY_STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(state));
  }
}

export function loadFromLocalStorage(projectId?: string): GraphState | null {
  if (typeof window !== "undefined") {
    const key = projectId ? graphKey(projectId) : LEGACY_STORAGE_KEY;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (!parsed.entityTypes) {
          parsed.entityTypes = getDefaultEntityTypes();
        }
        if (parsed.nodes) {
          parsed.nodes = parsed.nodes.map((n: GraphNode, i: number) => ({
            ...n,
            position: n.position || { x: 200 + (i % 5) * 200, y: 200 + Math.floor(i / 5) * 150 },
          }));
        }
        return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function saveMessagesToLocalStorage(
  messages: { id: string; role: "user" | "assistant"; content: string; timestamp: number }[],
  projectId?: string
): void {
  if (typeof window !== "undefined") {
    const key = projectId ? messagesKey(projectId) : LEGACY_MESSAGES_KEY;
    localStorage.setItem(key, JSON.stringify(messages));
  }
}

export function loadMessagesFromLocalStorage(projectId?: string): {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}[] | null {
  if (typeof window !== "undefined") {
    const key = projectId ? messagesKey(projectId) : LEGACY_MESSAGES_KEY;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearLocalStorage(projectId?: string): void {
  if (typeof window !== "undefined") {
    if (projectId) {
      localStorage.removeItem(graphKey(projectId));
      localStorage.removeItem(messagesKey(projectId));
    } else {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_MESSAGES_KEY);
    }
  }
}

// Phase 1 migration: read the unscoped legacy graph (once, for import)
export function loadLegacyGraphFromLocalStorage(): GraphState | null {
  return loadFromLocalStorage(undefined); // reads LEGACY_STORAGE_KEY
}
