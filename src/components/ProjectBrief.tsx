"use client";

/**
 * ProjectBrief — inline-editable project brief panel.
 *
 * Renders in the Inspector area when no node/edge is selected.
 * Uses the same edit-on-blur pattern as the Inspector node editor.
 *
 * Fields:
 *   - Org size + sector (text inputs, two columns)
 *   - Discovery goal (textarea)
 *   - Extraction lens (three radio cards — the abstraction layer)
 *   - Key themes (comma-separated input + tag display)
 *   - Haiku summary (read-only prose)
 *   - Re-process sources button (with native confirm dialog)
 */

import { useState, useEffect } from "react";
import type { ProjectBrief, AbstractionLayer } from "@/types";

// ── Abstraction layer descriptors ─────────────────────────────────────────────

const LAYER_OPTIONS: {
  value: AbstractionLayer;
  label: string;
  description: string;
}[] = [
  {
    value: "domain_objects",
    label: "Domain Objects",
    description: "What exists — teams, tools, systems, roles",
  },
  {
    value: "interaction_patterns",
    label: "Interaction Patterns",
    description: "How work moves — workflows, handoffs, dependencies",
  },
  {
    value: "concerns_themes",
    label: "Concerns & Themes",
    description: "What matters — values, tensions, priorities",
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface ProjectBriefProps {
  brief: ProjectBrief;
  documentCount: number;
  isReprocessing: boolean;
  onBriefUpdate: (updates: Partial<ProjectBrief>) => void;
  onStartScoping: () => void;
  onReprocess: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProjectBriefPanel({
  brief,
  documentCount,
  isReprocessing,
  onBriefUpdate,
  onStartScoping,
  onReprocess,
}: ProjectBriefProps) {
  // Local state mirrors brief fields for controlled inputs
  const [orgSize, setOrgSize] = useState(brief.orgSize ?? "");
  const [sector, setSector] = useState(brief.sector ?? "");
  const [discoveryGoal, setDiscoveryGoal] = useState(brief.discoveryGoal ?? "");
  const [themesInput, setThemesInput] = useState(
    (brief.keyThemes ?? []).join(", ")
  );

  // Sync when brief is externally updated (e.g. after a fresh scoping run)
  useEffect(() => {
    setOrgSize(brief.orgSize ?? "");
    setSector(brief.sector ?? "");
    setDiscoveryGoal(brief.discoveryGoal ?? "");
    setThemesInput((brief.keyThemes ?? []).join(", "));
  }, [brief]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleReprocessClick = () => {
    if (documentCount === 0 || isReprocessing) return;
    const layerLabel = LAYER_OPTIONS.find(
      (o) => o.value === brief.abstractionLayer
    )?.label ?? brief.abstractionLayer;

    const confirmed = window.confirm(
      `Re-process ${documentCount} document${documentCount === 1 ? "" : "s"} using the "${layerLabel}" lens?\n\nA snapshot of the current graph will be downloaded first. The graph will then be rebuilt from scratch — this cannot be undone.`
    );
    if (confirmed) onReprocess();
  };

  const handleThemesBlur = () => {
    const themes = themesInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const current = (brief.keyThemes ?? []).join(",");
    if (themes.join(",") !== current) {
      onBriefUpdate({ keyThemes: themes.length > 0 ? themes : undefined });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3.5">
      {/* Section header + re-scope link */}
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">
          Project Brief
        </h4>
        <button
          onClick={onStartScoping}
          className="text-[10px] text-stone-400 hover:text-stone-700 underline underline-offset-2 transition-colors"
        >
          Re-scope
        </button>
      </div>

      {/* Haiku-generated summary — read only */}
      {brief.summary && (
        <p className="text-xs text-stone-500 leading-relaxed">{brief.summary}</p>
      )}

      {/* Org size + sector — two-column grid */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
            Org size
          </label>
          <input
            value={orgSize}
            onChange={(e) => setOrgSize(e.target.value)}
            onBlur={() => {
              if (orgSize !== (brief.orgSize ?? ""))
                onBriefUpdate({ orgSize: orgSize || undefined });
            }}
            placeholder="e.g. 50–200"
            className="mt-0.5 w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-700 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
            Sector
          </label>
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            onBlur={() => {
              if (sector !== (brief.sector ?? ""))
                onBriefUpdate({ sector: sector || undefined });
            }}
            placeholder="e.g. aviation"
            className="mt-0.5 w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-700 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Discovery goal */}
      <div>
        <label className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
          Discovery goal
        </label>
        <textarea
          value={discoveryGoal}
          onChange={(e) => setDiscoveryGoal(e.target.value)}
          onBlur={() => {
            if (discoveryGoal !== (brief.discoveryGoal ?? ""))
              onBriefUpdate({ discoveryGoal: discoveryGoal || undefined });
          }}
          placeholder="What are you trying to understand?"
          rows={2}
          className="mt-0.5 w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-600 placeholder:text-stone-300 resize-none focus:border-stone-400 focus:outline-none"
        />
      </div>

      {/* Extraction lens — three radio cards */}
      <div>
        <label className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
          Extraction lens
        </label>
        <div className="mt-1 space-y-1">
          {LAYER_OPTIONS.map((opt) => {
            const active = brief.abstractionLayer === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  if (!active) onBriefUpdate({ abstractionLayer: opt.value });
                }}
                className={`w-full text-left rounded px-2.5 py-2 transition-colors ${
                  active
                    ? "bg-stone-800 text-white"
                    : "bg-stone-50 text-stone-600 hover:bg-stone-100"
                }`}
              >
                <div className="text-[11px] font-medium">{opt.label}</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    active ? "text-stone-300" : "text-stone-400"
                  }`}
                >
                  {opt.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Key themes — comma-separated with tag display */}
      <div>
        <label className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
          Key themes
        </label>
        <input
          value={themesInput}
          onChange={(e) => setThemesInput(e.target.value)}
          onBlur={handleThemesBlur}
          placeholder="Comma-separated themes"
          className="mt-0.5 w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-700 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
        />
        {(brief.keyThemes ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(brief.keyThemes ?? []).map((theme) => (
              <span
                key={theme}
                className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500"
              >
                {theme}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Re-process sources button */}
      <div className="pt-2 border-t border-stone-100">
        <button
          onClick={handleReprocessClick}
          disabled={documentCount === 0 || isReprocessing}
          className="w-full rounded px-2 py-1.5 text-[10px] font-medium transition-colors bg-stone-100 text-stone-600 hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isReprocessing
            ? "Rebuilding graph…"
            : documentCount === 0
            ? "Re-process sources (no documents yet)"
            : `Re-process ${documentCount} source${documentCount === 1 ? "" : "s"}`}
        </button>
        {brief.generatedAt && (
          <p className="mt-1 text-[9px] text-stone-300 text-center">
            Brief generated {new Date(brief.generatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
