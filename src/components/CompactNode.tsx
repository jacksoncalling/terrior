"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AttractorConfig, NodeZone } from "@/types";
import { normalizeIntensity, JAGGED_INTENSITY_THRESHOLD } from "@/lib/evaluative";

/**
 * CompactNode — lightweight circle rendering for graphs with 40+ nodes.
 *
 * Visual states (in priority order):
 * - Hub nodes: larger circle (24px) with ring border — unaffected by intensity
 * - Tension nodes: red ring — wins over jagged/emergent states
 * - Emergent + high intensity (≥ threshold): jagged star clip-path shape
 * - Emergent + low intensity: dotted ring, reduced opacity
 * - Regular: solid fill, no border
 * - Highlighted (selected or neighbor): full opacity + glow
 * - Dimmed (not connected to selection): near-invisible
 */

interface CompactNodeData {
  label: string;
  type: string;
  attractor?: string;
  is_hub?: boolean;
  description: string;
  entityTypes: unknown[];
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

// CSS clip-path for a jagged 8-spike star (used when emergent + high intensity).
// Generated from alternating outer (50%) and inner (30%) radius points around a circle.
const JAGGED_CLIP_PATH = (() => {
  const spikes = 8;
  const outerR = 50;
  const innerR = 30;
  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = 50 + r * Math.cos(angle);
    const y = 50 + r * Math.sin(angle);
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }
  return `polygon(${points.join(", ")})`;
})();

// Map normalized intensity (0–1) to circle diameter in px (non-hub nodes only).
const SIZE_MIN = 12;
const SIZE_MAX = 26;
function mapIntensityToSize(normalized: number): number {
  return SIZE_MIN + normalized * (SIZE_MAX - SIZE_MIN);
}

function CompactNodeComponent({ data }: NodeProps) {
  const {
    label,
    attractor,
    is_hub,
    attractors,
    zone,
    hasTension,
    selected,
    readonly,
    hubColor,
    highlighted,
    dimmed,
    intensity = 0,
  } = data as unknown as CompactNodeData;

  const attractorConfig = (attractors || []).find(
    (a: AttractorConfig) => a.id === attractor
  );
  const color = hubColor || attractorConfig?.color || "#78716c";

  const isEmergent = zone === "emergent";
  const isHub = is_hub === true;
  const isReadonly = readonly === true;
  const isJagged = isEmergent && intensity >= JAGGED_INTENSITY_THRESHOLD && !hasTension;

  // Size: hub fixed at 24px; non-hub scaled by intensity
  const normalized = normalizeIntensity(intensity);
  const size = isHub ? 24 : mapIntensityToSize(normalized);

  // Opacity: dimmed > readonly > emergent+low > normal
  let opacity = 1;
  if (dimmed) opacity = 0.15;
  else if (isReadonly) opacity = 0.5;
  else if (isEmergent && !isJagged) opacity = 0.6;

  // Border state (tension wins over all; jagged uses clip-path so no border needed)
  let border: string;
  if (hasTension) {
    border = "2px solid #f87171";
  } else if (isHub) {
    border = `2px solid ${color}`;
  } else if (isJagged) {
    border = "none";
  } else if (isEmergent) {
    border = "1.5px dashed #d6d3d1";
  } else {
    border = "1.5px solid transparent";
  }

  return (
    <div
      className="transition-opacity duration-150 flex flex-col items-center"
      style={{ opacity }}
      title={label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-transparent !border-0 !w-1 !h-1"
      />

      <div
        className="transition-shadow duration-150"
        style={{
          width: size,
          height: size,
          backgroundColor: isHub ? `${color}20` : color,
          border,
          borderRadius: isJagged ? undefined : "50%",
          clipPath: isJagged ? JAGGED_CLIP_PATH : undefined,
          boxShadow: highlighted
            ? `0 0 8px 2px ${color}60`
            : undefined,
        }}
      />

      {selected && (
        <div
          className="absolute whitespace-nowrap text-center pointer-events-none select-none"
          style={{
            top: size + 4,
            fontSize: isHub ? 11 : 10,
            fontWeight: 600,
            color: "#1c1917",
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-transparent !border-0 !w-1 !h-1"
      />
    </div>
  );
}

export default memo(CompactNodeComponent);
