"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EntityTypeConfig, AttractorConfig, NodeZone } from "@/types";

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
  hubColor?: string; // color inherited from the hub this node belongs to
}

function OntologyNodeComponent({ data }: NodeProps) {
  const { label, type, attractor, is_hub, entityTypes, attractors, zone, hasTension, readonly, hubColor } =
    data as unknown as OntologyNodeData;

  // Attractor color is the primary visual indicator
  const attractorConfig = (attractors || []).find((a: AttractorConfig) => a.id === attractor);
  const attractorColor = hubColor || attractorConfig?.color || "#78716c";
  const attractorLabel = attractorConfig?.label || attractor || "Emergent";

  const typeConfig = (entityTypes || []).find((t: EntityTypeConfig) => t.id === type);
  const typeLabel = typeConfig?.label || type;

  // Zone-based visual treatment
  const isEmergent = zone === "emergent";
  const isReadonly = readonly === true;
  const isHub = is_hub === true;

  // Hub nodes get a distinct, larger treatment
  if (isHub) {
    return (
      <div
        className="rounded-xl border-2 shadow-md min-w-[180px] max-w-[220px] transition-all"
        style={{
          borderColor: attractorColor,
          backgroundColor: `${attractorColor}10`,
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

  // Regular node treatment
  return (
    <div
      className={`rounded-lg border-2 bg-white shadow-sm min-w-[140px] max-w-[200px] transition-opacity ${
        hasTension ? "border-red-400" : isEmergent ? "border-dashed border-stone-300" : "border-stone-200"
      } ${isEmergent ? "opacity-60" : ""} ${isReadonly ? "opacity-50" : ""}`}
      style={{ borderTopColor: attractorColor, borderTopWidth: "3px" }}
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
