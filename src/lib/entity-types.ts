import type { EntityTypeConfig, GraphState, GraphNode, AttractorConfig, AttractorPreset, NodeZone, Relationship } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { HUB_RELATIONSHIP_TYPE } from "@/types";

// Color palette for auto-assigning to new types
const TYPE_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#14b8a6", // teal
  "#ef4444", // red
  "#ec4899", // pink
  "#6366f1", // indigo
  "#84cc16", // lime
  "#f97316", // orange
  "#06b6d4", // cyan
  "#a855f7", // violet
  "#78716c", // stone
];

// Minimal seed types — always present
export const SEED_TYPES: EntityTypeConfig[] = [
  { id: "organisation", label: "Organisation", color: "#10b981" },
  { id: "platform", label: "Platform", color: "#f59e0b" },
  { id: "process", label: "Process", color: "#8b5cf6" },
];

export function getDefaultEntityTypes(): EntityTypeConfig[] {
  return [...SEED_TYPES];
}

/**
 * Get the color for an entity type. If the type exists, return its color.
 * If not, assign a new color from the palette.
 */
export function getTypeColor(
  typeId: string,
  existingTypes: EntityTypeConfig[]
): string {
  const existing = existingTypes.find((t) => t.id === typeId);
  if (existing) return existing.color;

  // Auto-assign a color based on how many types we have
  const colorIndex = existingTypes.length % TYPE_COLORS.length;
  return TYPE_COLORS[colorIndex];
}

/**
 * Ensure a type exists in the entity types list. If it doesn't exist,
 * create it with an auto-assigned color and a label derived from the id.
 */
export function ensureTypeExists(
  entityTypes: EntityTypeConfig[],
  typeId: string
): EntityTypeConfig[] {
  if (entityTypes.find((t) => t.id === typeId)) {
    return entityTypes;
  }

  const color = getTypeColor(typeId, entityTypes);
  const label = typeId
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return [...entityTypes, { id: typeId, label, color }];
}

/**
 * Discover all entity types that exist in the graph's nodes.
 * Ensures every type used by a node has an EntityTypeConfig.
 */
export function syncTypesFromGraph(state: GraphState): EntityTypeConfig[] {
  let types = [...state.entityTypes];
  for (const node of state.nodes) {
    types = ensureTypeExists(types, node.type);
  }
  return types;
}

/**
 * Update a type's label or color
 */
export function updateEntityType(
  types: EntityTypeConfig[],
  typeId: string,
  updates: Partial<Pick<EntityTypeConfig, "label" | "color">>
): EntityTypeConfig[] {
  return types.map((t) => (t.id === typeId ? { ...t, ...updates } : t));
}

/**
 * Add a new custom type
 */
export function addEntityType(
  types: EntityTypeConfig[],
  id: string,
  label: string,
  color?: string
): EntityTypeConfig[] {
  if (types.find((t) => t.id === id)) return types;
  const assignedColor = color || getTypeColor(id, types);
  return [...types, { id, label, color: assignedColor }];
}

// ── Attractor Category Presets ─────────────────────────────────────────────
//
// Structural scaffolding for the ontology. Every node gets an attractor
// (structural placement) alongside its freeform descriptive type.
// "emergent" is always present — it's the "new shelf" for unplaced nodes.

const EMERGENT_ATTRACTOR: AttractorConfig = {
  id: "emergent",
  label: "Emergent",
  color: "#78716c", // stone
  description: "Genuinely novel entities that don't fit any existing hub. Signals structural novelty — use only when no other hub applies, not as a default for uncertainty.",
};

export const STARTUP_ATTRACTORS: AttractorConfig[] = [
  { id: "domain", label: "Domain", color: "#3b82f6", description: "Subject matter expertise, disciplines, and knowledge areas. If it's something you'd study, research, or apprentice in, it's Domain." },
  { id: "capability", label: "Capability", color: "#10b981", description: "What the team can do or build — skills, competencies, deliverables. If it describes an ability or output the team produces, it's Capability." },
  { id: "toolchain", label: "Toolchain", color: "#f59e0b", description: "Technical stack, platforms, APIs, and integrations. If it's software, infrastructure, or a service the team uses, it's Toolchain." },
  { id: "customer", label: "Customer", color: "#ec4899", description: "Who is served — segments, personas, partners, stakeholders. If it's a person or group the product/service is built for, it's Customer." },
  { id: "method", label: "Method", color: "#8b5cf6", description: "How work is done — processes, frameworks, rituals, delivery patterns. If it describes a way of working or a repeatable approach, it's Method." },
  { id: "value", label: "Value", color: "#14b8a6", description: "What the team optimizes for — principles, priorities, trade-offs, beliefs. If it's something the team protects or moves toward, it's Value." },
  EMERGENT_ATTRACTOR,
];

export const ENTERPRISE_ATTRACTORS: AttractorConfig[] = [
  { id: "identity", label: "Identity", color: "#3b82f6", description: "Purpose, values, brand, mission — who the org understands itself to be. If it answers 'who are we?', it's Identity." },
  { id: "policy", label: "Policy", color: "#ef4444", description: "Rules, strategies, programmes, mandates, compliance requirements. If it governs what must or must not happen, it's Policy." },
  { id: "structure", label: "Structure", color: "#f59e0b", description: "Formal architecture — departments, reporting lines, org charts, governance bodies. If it defines how the org is shaped, it's Structure." },
  { id: "people", label: "People", color: "#ec4899", description: "Named individuals, teams, leadership, cultural groups. If it's a person or a group of people, it's People." },
  { id: "functions", label: "Functions", color: "#8b5cf6", description: "Specialist capabilities, competency areas, professional disciplines. If it describes what a part of the org is skilled at, it's Functions." },
  { id: "processes", label: "Processes", color: "#10b981", description: "Workflows, procedures, routines, operational rhythms. If it describes how work flows from input to output, it's Processes." },
  { id: "resources", label: "Resources", color: "#14b8a6", description: "Physical, digital, financial, or informational assets. If the org owns, maintains, or depends on it as an asset, it's Resources." },
  EMERGENT_ATTRACTOR,
];

// Individual preset — maps the ontology of a person rather than an organisation.
// Belonging is the broader category (lineage, family, communities, affiliations);
// Lineage is a node type *within* Belonging, not its own hub.
export const INDIVIDUAL_ATTRACTORS: AttractorConfig[] = [
  { id: "identity",  label: "Identity",  color: "#3b82f6", description: "Who the person understands themselves to be — role, self-concept, positioning. If it answers 'who am I?', it's Identity." },
  { id: "belonging", label: "Belonging", color: "#ec4899", description: "Where they come from and where they fit — lineage, family, communities, affiliations. If it's a group or origin the person identifies with, it's Belonging." },
  { id: "projects",  label: "Projects",  color: "#f59e0b", description: "Active work, initiatives, goals, and commitments. If the person is actively building or pursuing it, it's Projects." },
  { id: "skills",    label: "Skills",    color: "#10b981", description: "Capabilities, expertise, and developed practices. If it's something the person has learned to do well, it's Skills." },
  { id: "values",    label: "Values",    color: "#8b5cf6", description: "What the person protects, moves toward, and optimises for. If it's a principle or priority they'd defend, it's Values." },
  EMERGENT_ATTRACTOR,
];

export const ATTRACTOR_PRESETS: Record<string, AttractorConfig[]> = {
  startup: STARTUP_ATTRACTORS,
  enterprise: ENTERPRISE_ATTRACTORS,
  individual: INDIVIDUAL_ATTRACTORS,
};

export function getAttractorsForPreset(preset?: AttractorPreset): AttractorConfig[] {
  if (!preset || preset === "custom") return [EMERGENT_ATTRACTOR];
  return ATTRACTOR_PRESETS[preset] ?? [EMERGENT_ATTRACTOR];
}

export function getAttractorColor(attractorId: string, attractors: AttractorConfig[]): string {
  const found = attractors.find((a) => a.id === attractorId);
  return found?.color ?? EMERGENT_ATTRACTOR.color;
}

// ── Hub Node Seeding ────────────────────────────────────────────────────────
//
// Hub nodes are real entities in the graph. Seeded from preset on project creation.
// Each AttractorConfig becomes a GraphNode with is_hub=true.

/**
 * Create hub nodes from a preset. Called when a project is created.
 * Returns an array of GraphNode objects with is_hub=true, positioned in a row at the top.
 */
export function seedHubNodes(preset: AttractorPreset): GraphNode[] {
  const attractors = getAttractorsForPreset(preset);
  return attractors.map((a, i) => ({
    id: uuidv4(),
    label: a.label,
    type: "hub",
    attractor: a.id, // self-referential for hubs — the hub IS the attractor
    is_hub: true,
    description: a.description,
    position: { x: 150 + i * 220, y: 50 },
    properties: { color: a.color, attractor_id: a.id },
  }));
}

// ── Hub Graph Utilities ─────────────────────────────────────────────────────

/** Get all hub nodes from a graph state */
export function getHubNodes(state: GraphState): GraphNode[] {
  return state.nodes.filter((n) => n.is_hub === true);
}

/** Get the hub nodes a regular node belongs to (via belongs_to_hub relationships) */
export function getNodeHubs(nodeId: string, state: GraphState): GraphNode[] {
  const hubIds = state.relationships
    .filter((r) => r.type === HUB_RELATIONSHIP_TYPE && r.sourceId === nodeId)
    .map((r) => r.targetId);
  return state.nodes.filter((n) => hubIds.includes(n.id));
}

/** Get all member nodes of a hub (nodes with belongs_to_hub → this hub) */
export function getHubMembers(hubId: string, state: GraphState): GraphNode[] {
  const memberIds = state.relationships
    .filter((r) => r.type === HUB_RELATIONSHIP_TYPE && r.targetId === hubId)
    .map((r) => r.sourceId);
  return state.nodes.filter((n) => memberIds.includes(n.id));
}

/** Find a hub node by its attractor_id property */
export function findHubByAttractorId(attractorId: string, state: GraphState): GraphNode | undefined {
  return state.nodes.find((n) => n.is_hub && n.properties?.attractor_id === attractorId);
}

/** Get hub summary for each hub — count of members, tensions, etc. */
export function getHubSummaries(state: GraphState): {
  hub: GraphNode;
  memberCount: number;
  tensionCount: number;
  recentMembers: GraphNode[];
}[] {
  const hubs = getHubNodes(state);
  return hubs.map((hub) => {
    const members = getHubMembers(hub.id, state);
    const memberIds = new Set(members.map((m) => m.id));
    const tensions = state.tensions.filter(
      (t) => t.status === "unresolved" && t.relatedNodeIds.some((id) => memberIds.has(id))
    );
    return {
      hub,
      memberCount: members.length,
      tensionCount: tensions.length,
      recentMembers: members.slice(-3), // last 3 added
    };
  });
}

/**
 * Migrate a GraphState that has no hub nodes yet.
 * Seeds hub nodes from the preset, then creates belongs_to_hub relationships
 * for existing nodes based on their cached `attractor` field.
 *
 * Returns the migrated state, or the original state if hubs already exist.
 */
export function migrateToHubNodes(
  state: GraphState,
  preset: AttractorPreset
): GraphState {
  // Already has hubs — no migration needed
  if (state.nodes.some((n) => n.is_hub)) return state;
  // No nodes at all — no migration needed (new project will seed on creation)
  if (state.nodes.length === 0) return state;

  const hubNodes = seedHubNodes(preset);
  const newRelationships: Relationship[] = [];

  // Build attractor_id → hub node ID map
  const attractorToHubId = new Map<string, string>();
  for (const hub of hubNodes) {
    const attId = hub.properties?.attractor_id;
    if (attId) attractorToHubId.set(attId, hub.id);
  }

  // For each existing node with an attractor, create a belongs_to_hub relationship
  for (const node of state.nodes) {
    const attractor = node.attractor ?? 'emergent';
    const hubId = attractorToHubId.get(attractor);
    if (hubId) {
      newRelationships.push({
        id: uuidv4(),
        sourceId: node.id,
        targetId: hubId,
        type: HUB_RELATIONSHIP_TYPE,
      });
    }
  }

  return {
    ...state,
    nodes: [...hubNodes, ...state.nodes],
    relationships: [...state.relationships, ...newRelationships],
  };
}

// ── Node Zone Computation ──────────────────────────────────────────────────
//
// Zone is computed client-side from relationship count. Not stored in DB.
//   0–1 relationships → emergent
//   2–4 relationships → attracted
//   5+  relationships → integrated

export function computeNodeZone(nodeId: string, relationships: Relationship[]): NodeZone {
  const count = relationships.filter(
    (r) => r.sourceId === nodeId || r.targetId === nodeId
  ).length;
  if (count <= 1) return "emergent";
  if (count <= 4) return "attracted";
  return "integrated";
}

export function computeGraphZones(
  nodes: { id: string }[],
  relationships: Relationship[]
): Map<string, NodeZone> {
  const zones = new Map<string, NodeZone>();
  for (const node of nodes) {
    zones.set(node.id, computeNodeZone(node.id, relationships));
  }
  return zones;
}
