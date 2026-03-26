import type { EntityTypeConfig, GraphState, AttractorConfig, AttractorPreset, NodeZone, Relationship } from "@/types";

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
  description: "Present but not yet placed — the new shelf",
};

export const STARTUP_ATTRACTORS: AttractorConfig[] = [
  { id: "domain", label: "Domain", color: "#3b82f6", description: "Subject matter expertise and knowledge areas" },
  { id: "capability", label: "Capability", color: "#10b981", description: "What the team can do or build" },
  { id: "toolchain", label: "Toolchain", color: "#f59e0b", description: "Technical stack, platforms, and integrations" },
  { id: "customer", label: "Customer", color: "#ec4899", description: "Who is served and how" },
  { id: "method", label: "Method", color: "#8b5cf6", description: "How work is done and delivered" },
  { id: "value", label: "Value", color: "#14b8a6", description: "What the team optimizes for" },
  EMERGENT_ATTRACTOR,
];

export const ENTERPRISE_ATTRACTORS: AttractorConfig[] = [
  { id: "identity", label: "Identity", color: "#3b82f6", description: "Purpose, values, brand — who the org understands itself to be" },
  { id: "policy", label: "Policy", color: "#ef4444", description: "Rules, strategies, programmes, commitments" },
  { id: "structure", label: "Structure", color: "#f59e0b", description: "Formal architecture — roles, reporting, organs" },
  { id: "people", label: "People", color: "#ec4899", description: "Individuals, groups, teams, culture, leadership" },
  { id: "functions", label: "Functions", color: "#8b5cf6", description: "Specialist roles, competencies, capabilities" },
  { id: "processes", label: "Processes", color: "#10b981", description: "Workflows, procedures, routines, rhythms" },
  { id: "resources", label: "Resources", color: "#14b8a6", description: "Physical, digital, financial, informational assets" },
  EMERGENT_ATTRACTOR,
];

export const ATTRACTOR_PRESETS: Record<string, AttractorConfig[]> = {
  startup: STARTUP_ATTRACTORS,
  enterprise: ENTERPRISE_ATTRACTORS,
};

export function getAttractorsForPreset(preset?: AttractorPreset): AttractorConfig[] {
  if (!preset || preset === "custom") return [EMERGENT_ATTRACTOR];
  return ATTRACTOR_PRESETS[preset] ?? [EMERGENT_ATTRACTOR];
}

export function getAttractorColor(attractorId: string, attractors: AttractorConfig[]): string {
  const found = attractors.find((a) => a.id === attractorId);
  return found?.color ?? EMERGENT_ATTRACTOR.color;
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
