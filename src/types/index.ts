// ── Project ─────────────────────────────────────────────────────────────────
// The core isolation primitive for Phase 2. Every ontology, corpus, and session
// belongs to exactly one Project.

export type ProjectPhase = 'preparation' | 'workshop' | 'synthesis' | 'validation' | 'live';

export interface Project {
  id: string;
  name: string;
  sector?: string;
  description?: string;
  embedding_model: string;
  phase: ProjectPhase;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Entity type configuration — emergent, not fixed ──────────────────────────
export interface EntityTypeConfig {
  id: string;
  label: string;
  color: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string; // freeform — matches EntityTypeConfig.id
  description: string;
  position: { x: number; y: number };
  properties?: Record<string, string>;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
}

export interface TensionMarker {
  id: string;
  description: string;
  relatedNodeIds: string[];
  status: "unresolved" | "resolved";
}

export interface EvaluativeSignal {
  id: string;
  label: string;
  direction: "toward" | "away_from" | "protecting";
  strength: number;
  sourceDescription: string;
}

export interface GraphState {
  nodes: GraphNode[];
  relationships: Relationship[];
  tensions: TensionMarker[];
  evaluativeSignals: EvaluativeSignal[];
  entityTypes: EntityTypeConfig[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type GraphUpdateType =
  | "node_created"
  | "node_updated"
  | "node_deleted"
  | "relationship_created"
  | "relationship_deleted"
  | "tension_flagged"
  | "tension_resolved"
  | "evaluative_signal_set";

export interface GraphUpdate {
  type: GraphUpdateType;
  label: string;
}
