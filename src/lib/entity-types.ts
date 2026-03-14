import type { EntityTypeConfig, GraphState } from "@/types";

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
