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
  parent_project_id?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Entity type configuration — emergent, not fixed ──────────────────────────
export interface EntityTypeConfig {
  id: string;
  label: string;
  color: string;
}

// ── Attractor presets ────────────────────────────────────────────────────────
// Structural categories that form the ontological scaffolding.
// Nodes carry TWO tags: `attractor` (structural) + `type` (freeform descriptive).

export type AttractorPreset = 'startup' | 'enterprise' | 'custom';

export type NodeZone = 'emergent' | 'attracted' | 'integrated';

export interface AttractorConfig {
  id: string;
  label: string;
  color: string;
  description: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string; // freeform descriptive tag — matches EntityTypeConfig.id
  attractor?: string; // structural category from preset (e.g. 'domain', 'capability'). Defaults to 'emergent'.
  description: string;
  position: { x: number; y: number };
  properties?: Record<string, string>;
  readonly?: boolean; // true for nodes inherited from parent project
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
  /** Extraction-time confidence/salience score (1–5), set by AI */
  strength: number;
  sourceDescription: string;
  // ── Reflect tab scores — set by the user, nullable until rated ────────────
  /** How relevant is this signal to the current work? (1–5, null = unrated) */
  relevanceScore?: number | null;
  /** How urgent / high-stakes does this signal feel right now? (1–5, null = unrated) */
  intensityScore?: number | null;
  /** ISO timestamp of the last reflection rating */
  reflectedAt?: string | null;
  /** Optional freetext note from the consultant */
  userNote?: string | null;
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

// ── Phase 2: Abstraction Layer ────────────────────────────────────────────────
//
// Project-level setting that tells Gemini which "lens" to use when extracting
// entities from documents. Three presets map to the three abstraction levels
// surfaced in Terroir's design:
//
//   domain_objects       — nouns: systems, teams, tools, documents, roles
//   interaction_patterns — verbs: workflows, handoffs, communication paths
//   concerns_themes      — adjectives: values, tensions, strategic priorities

export type AbstractionLayer =
  | "domain_objects"
  | "interaction_patterns"
  | "concerns_themes";

// ── Phase 2.5: Document Classification ──────────────────────────────────────
//
// Pre-classification step that filters documents before extraction.
// Gemini classifies each document as EXTRACT, CAUTION, or SKIP based on
// genre (legal, marketing, operational) to prevent noise from polluting
// the knowledge graph.

export type ClassificationVerdict = "EXTRACT" | "CAUTION" | "SKIP";

export interface DocumentClassification {
  documentIndex: number;           // index in the batch
  title: string;
  verdict: ClassificationVerdict;
  genre: string;                   // e.g. "legal", "marketing", "operational", "interview"
  confidence: number;              // 0-1
  reason: string;                  // one-line explanation
  isDuplicate?: boolean;           // true if this duplicates another doc
  duplicateOf?: string;            // title of the doc it duplicates
}

// ── Phase 2: Project Brief ────────────────────────────────────────────────────
//
// Produced by the Haiku scoping dialogue. Stored in projects.metadata.brief
// (jsonb column — no migration needed). Feeds into Gemini extraction and
// Haiku synthesis as the "stable context" layer.

export interface ProjectBrief {
  orgSize?: string;                    // e.g. "startup", "50-200 people", "enterprise"
  sector?: string;                     // e.g. "aviation", "healthcare", "fintech"
  discoveryGoal?: string;              // what the consultant most wants to understand
  abstractionLayer: AbstractionLayer;  // extraction lens — required once set
  keyThemes?: string[];                // top themes surfaced during scoping
  summary?: string;                    // Haiku-generated prose summary of the brief
  rawAnswers?: Record<string, string>; // raw Q&A pairs from the scoping dialogue
  generatedAt?: string;                // ISO timestamp of last generation
}

// ── Phase 2: Synthesis Result ─────────────────────────────────────────────────
//
// Produced by the Haiku synthesis reader after reading across all ingested
// documents. Not persisted to DB — cached in localStorage per project.

/** The same concept called different names across different sources */
export interface TermCollision {
  variants: string[];             // e.g. ["updates", "sync", "alignment", "comms"]
  sources: string[];              // document titles where each variant appears
  suggestedCanonical: string;     // Haiku's recommended unified term
  context: string;                // why these terms refer to the same concept
}

/** A recurring theme or structural pattern that spans multiple sources */
export interface ConnectingThread {
  theme: string;
  description: string;
  relatedSources: string[];
  relatedNodeIds?: string[];      // optional: maps to existing graph nodes
}

/** Agreement or disagreement on an evaluative dimension across sources */
export interface SignalConvergence {
  signal: string;                 // what multiple sources converge on
  convergenceType: "agreement" | "disagreement" | "partial";
  sources: string[];
  description: string;
}

/** A concept present in transcripts but absent/underrepresented in the graph */
export interface GraphGap {
  description: string;
  suggestedQuestion: string;      // pre-filled prompt for the consultant to follow up
  relatedNodeIds?: string[];
}

/** Full output from the Haiku cross-source synthesis pass */
export interface SynthesisResult {
  narrativeSummary: string;       // 2-3 paragraph prose overview of findings
  termCollisions: TermCollision[];
  connectingThreads: ConnectingThread[];
  signalConvergence: SignalConvergence[];
  graphGaps: GraphGap[];
  documentCount: number;          // number of documents read
  generatedAt: string;            // ISO timestamp
}
