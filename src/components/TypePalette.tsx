"use client";

import type { EntityTypeConfig, AttractorConfig, NodeZone } from "@/types";

interface TypePaletteProps {
  entityTypes: EntityTypeConfig[];
  attractors: AttractorConfig[];
  nodeZoneCounts?: { emergent: number; attracted: number; integrated: number };
  onTypeUpdate: (typeId: string, updates: Partial<Pick<EntityTypeConfig, "label" | "color">>) => void;
  onTypeAdd: (id: string, label: string) => void;
  activeFilter: string | null;
  onFilterChange: (typeId: string | null) => void;
  zoneFilter: NodeZone | null;
  onZoneFilterChange: (zone: NodeZone | null) => void;
}

export default function TypePalette({
  attractors,
  nodeZoneCounts,
  onFilterChange,
  activeFilter,
  zoneFilter,
  onZoneFilterChange,
}: TypePaletteProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-stone-200 bg-white overflow-x-auto">
      <span className="text-[10px] text-stone-400 uppercase tracking-wide shrink-0 mr-1">
        Attractors
      </span>

      <button
        onClick={() => { onFilterChange(null); onZoneFilterChange(null); }}
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 ${
          activeFilter === null && zoneFilter === null
            ? "bg-stone-800 text-white"
            : "bg-stone-100 text-stone-500 hover:bg-stone-200"
        }`}
      >
        All
      </button>

      {attractors.filter((a) => a.id !== "emergent").map((attractor) => (
        <button
          key={attractor.id}
          onClick={() => {
            onZoneFilterChange(null);
            onFilterChange(activeFilter === attractor.id ? null : attractor.id);
          }}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
            activeFilter === attractor.id
              ? "ring-2 ring-stone-800 ring-offset-1"
              : ""
          }`}
          style={{
            backgroundColor: activeFilter === attractor.id ? attractor.color : `${attractor.color}20`,
            color: activeFilter === attractor.id ? "white" : attractor.color,
          }}
          title={attractor.description}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: attractor.color }}
          />
          {attractor.label}
        </button>
      ))}

      {/* Emergent zone filter — always last, with count badge */}
      {nodeZoneCounts && nodeZoneCounts.emergent > 0 && (
        <>
          <span className="text-stone-200 mx-0.5">|</span>
          <button
            onClick={() => {
              onFilterChange(null);
              onZoneFilterChange(zoneFilter === "emergent" ? null : "emergent");
            }}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
              zoneFilter === "emergent"
                ? "bg-stone-600 text-white ring-2 ring-stone-800 ring-offset-1"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-stone-400" style={{ borderStyle: 'dashed' }} />
            Emergent
            <span className={`ml-0.5 text-[9px] px-1 rounded-full ${
              zoneFilter === "emergent" ? "bg-white/20" : "bg-stone-200"
            }`}>
              {nodeZoneCounts.emergent}
            </span>
          </button>
        </>
      )}
    </div>
  );
}
