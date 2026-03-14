"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EntityTypeConfig } from "@/types";

interface OntologyNodeData {
  label: string;
  type: string;
  description: string;
  entityTypes: EntityTypeConfig[];
  hasTension: boolean;
  selected?: boolean;
}

function OntologyNodeComponent({ data }: NodeProps) {
  const { label, type, entityTypes, hasTension } = data as unknown as OntologyNodeData;

  const typeConfig = (entityTypes || []).find(
    (t: EntityTypeConfig) => t.id === type
  );
  const color = typeConfig?.color || "#78716c";
  const typeLabel = typeConfig?.label || type;

  return (
    <div
      className={`rounded-lg border-2 bg-white shadow-sm min-w-[140px] max-w-[200px] ${
        hasTension ? "border-red-400" : "border-stone-200"
      }`}
      style={{ borderTopColor: color, borderTopWidth: "3px" }}
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
        <div
          className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white leading-none"
          style={{ backgroundColor: color }}
        >
          {typeLabel}
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
