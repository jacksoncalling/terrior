"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AttractorConfig, NodeZone } from "@/types";

/**
 * CompactNode — lightweight circle rendering for graphs with 40+ nodes.
 *
 * Renders a small colored circle (hub color as fill) with label on hover.
 * No label/description in the DOM — dramatically reduces paint cost at scale.
 *
 * Visual states:
 * - Hub nodes: larger circle (24px) with ring border
 * - Tension nodes: red ring indicator
 * - Emergent zone: dashed border + reduced opacity
 * - Readonly (parent project): reduced opacity
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
  } = data as unknown as CompactNodeData;

  // Resolve color from hub inheritance or attractor config
  const attractorConfig = (attractors || []).find(
    (a: AttractorConfig) => a.id === attractor
  );
  const color = hubColor || attractorConfig?.color || "#78716c";

  const isEmergent = zone === "emergent";
  const isHub = is_hub === true;
  const isReadonly = readonly === true;
  const size = isHub ? 24 : 16;

  // Opacity: dimmed > readonly/emergent > highlighted > normal
  let opacity = 1;
  if (dimmed) opacity = 0.15;
  else if (isReadonly) opacity = 0.5;
  else if (isEmergent) opacity = 0.6;

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
        className="rounded-full transition-shadow duration-150"
        style={{
          width: size,
          height: size,
          backgroundColor: isHub ? `${color}20` : color,
          border: hasTension
            ? "2px solid #f87171"
            : isHub
              ? `2px solid ${color}`
              : isEmergent
                ? "1.5px dashed #d6d3d1"
                : "1.5px solid transparent",
          boxShadow: highlighted
            ? `0 0 8px 2px ${color}60`
            : undefined,
        }}
      />

      {/* Show label below circle only for the selected (clicked) node */}
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
