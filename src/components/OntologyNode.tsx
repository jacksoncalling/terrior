"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EntityTypeConfig, AttractorConfig, NodeZone } from "@/types";
import { normalizeIntensity, JAGGED_INTENSITY_THRESHOLD } from "@/lib/evaluative";

interface OntologyNodeData {
  label: string;
  type: string;
  attractor?: string;
  is_hub?: boolean;
  description: string;
  entityTypes: EntityTypeConfig[];
  attractors?: AttractorConfig[];
  zone?: NodeZone;
  hasTension: boolean;
  selected?: boolean;
  readonly?: boolean;
  hubColor?: string;
  highlighted?: boolean;
  dimmed?: boolean;
  intensity?: number;
}

// Map normalized intensity (0–1) to min-width px (non-hub nodes only).
const CARD_WIDTH_MIN = 140;
const CARD_WIDTH_MAX = 210;
function mapIntensityToWidth(normalized: number): number {
  return CARD_WIDTH_MIN + normalized * (CARD_WIDTH_MAX - CARD_WIDTH_MIN);
}

// CSS clip-path for a jagged border on a card: zigzag top and bottom edges.
// Uses percentage so it scales with any card size.
// Top edge: alternating peaks at y=0% and y=6%; Bottom: alternating troughs at y=94% and y=100%.
const JAGGED_CARD_CLIP = (() => {
  const steps = 10;
  const topPoints: string[] = [];
  const bottomPoints: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    const yTop = i % 2 === 0 ? 0 : 5;
    topPoints.push(`${x.toFixed(1)}% ${yTop}%`);
  }
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * 100;
    const yBot = i % 2 === 0 ? 100 : 95;
    bottomPoints.push(`${x.toFixed(1)}% ${yBot}%`);
  }
  return `polygon(${topPoints.join(", ")}, ${bottomPoints.join(", ")})`;
})();

function OntologyNodeComponent({ data }: NodeProps) {
  const {
    label,
    type,
    attractor,
    is_hub,
    entityTypes,
    attractors,
    zone,
    hasTension,
    readonly,
    hubColor,
    highlighted,
    dimmed,
    intensity = 0,
  } = data as unknown as OntologyNodeData;

  const attractorConfig = (attractors || []).find((a: AttractorConfig) => a.id === attractor);
  const attractorColor = hubColor || attractorConfig?.color || "#78716c";
  const attractorLabel = attractorConfig?.label || attractor || "Emergent";

  const typeConfig = (entityTypes || []).find((t: EntityTypeConfig) => t.id === type);
  const typeLabel = typeConfig?.label || type;

  const isEmergent = zone === "emergent";
  const isReadonly = readonly === true;
  const isHub = is_hub === true;
  const isJagged = isEmergent && intensity >= JAGGED_INTENSITY_THRESHOLD && !hasTension;

  const normalized = normalizeIntensity(intensity);
  const minWidth = mapIntensityToWidth(normalized);

  // Hub nodes: fixed, unaffected by intensity
  if (isHub) {
    return (
      <div
        className="rounded-xl border-2 shadow-md min-w-[180px] max-w-[220px] transition-all duration-150"
        style={{
          borderColor: attractorColor,
          backgroundColor: `${attractorColor}10`,
          opacity: dimmed ? 0.15 : 1,
          boxShadow: highlighted ? `0 0 12px 3px ${attractorColor}40` : undefined,
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-stone-400 !w-2.5 !h-2.5 !border-white !border-2"
        />
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: attractorColor }}
            />
            <span className="text-xs font-bold text-stone-800 leading-tight truncate">
              {label}
            </span>
          </div>
          <div className="text-[10px] text-stone-500 leading-snug line-clamp-2">
            {data.description as string}
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-stone-400 !w-2.5 !h-2.5 !border-white !border-2"
        />
      </div>
    );
  }

  // Regular node — three border states:
  // tension (red) > jagged (amber outline + clip-path) > emergent+low (dashed grey) > normal
  const borderClass = hasTension
    ? "border-red-400"
    : isEmergent
      ? "border-dashed border-stone-300"
      : "border-stone-200";

  const opacityStyle =
    dimmed ? 0.15
    : isReadonly ? 0.5
    : isEmergent && !isJagged ? 0.6
    : undefined;

  return (
    <div
      className={`rounded-lg border-2 bg-white shadow-sm transition-all duration-150 ${borderClass}`}
      style={{
        minWidth: `${minWidth}px`,
        maxWidth: "210px",
        borderTopColor: hasTension ? undefined : attractorColor,
        borderTopWidth: "3px",
        opacity: opacityStyle,
        // Jagged: amber SVG outline overlay; clip-path for the card shape itself
        clipPath: isJagged ? JAGGED_CARD_CLIP : undefined,
        boxShadow: highlighted
          ? `0 0 10px 2px ${attractorColor}40`
          : isJagged
            ? "0 0 0 2px #f59e0b"
            : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-stone-400 !w-2 !h-2 !border-white !border-2"
      />
      <div className="px-3 py-2">
        <div className="text-xs font-semibold text-stone-800 leading-tight truncate">
          {label}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <span
            className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white leading-none"
            style={{ backgroundColor: attractorColor }}
          >
            {attractorLabel}
          </span>
          <span className="text-[9px] text-stone-400">
            {typeLabel}
          </span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-stone-400 !w-2 !h-2 !border-white !border-2"
      />
    </div>
  );
}

export default memo(OntologyNodeComponent);
