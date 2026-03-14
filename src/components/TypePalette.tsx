"use client";

import type { EntityTypeConfig } from "@/types";

interface TypePaletteProps {
  entityTypes: EntityTypeConfig[];
  onTypeUpdate: (typeId: string, updates: Partial<Pick<EntityTypeConfig, "label" | "color">>) => void;
  onTypeAdd: (id: string, label: string) => void;
  activeFilter: string | null;
  onFilterChange: (typeId: string | null) => void;
}

export default function TypePalette({
  entityTypes,
  onFilterChange,
  activeFilter,
}: TypePaletteProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-stone-200 bg-white overflow-x-auto">
      <span className="text-[10px] text-stone-400 uppercase tracking-wide shrink-0 mr-1">
        Types
      </span>

      <button
        onClick={() => onFilterChange(null)}
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 ${
          activeFilter === null
            ? "bg-stone-800 text-white"
            : "bg-stone-100 text-stone-500 hover:bg-stone-200"
        }`}
      >
        All
      </button>

      {entityTypes.map((type) => (
        <button
          key={type.id}
          onClick={() =>
            onFilterChange(activeFilter === type.id ? null : type.id)
          }
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
            activeFilter === type.id
              ? "ring-2 ring-stone-800 ring-offset-1"
              : ""
          }`}
          style={{
            backgroundColor: activeFilter === type.id ? type.color : `${type.color}20`,
            color: activeFilter === type.id ? "white" : type.color,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: type.color }}
          />
          {type.label}
        </button>
      ))}
    </div>
  );
}
