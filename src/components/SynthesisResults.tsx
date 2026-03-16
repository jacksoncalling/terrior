"use client";

/**
 * SynthesisResults — displays the structured output from a Haiku cross-source
 * synthesis pass.
 *
 * Four sections (only rendered when they contain results):
 *   1. Narrative Summary    — 2-3 paragraph prose overview
 *   2. Term Collisions      — same concept, different names across sources
 *   3. Connecting Threads   — recurring themes that span multiple documents
 *   4. Signal Convergence   — agreement / disagreement on evaluative dimensions
 *   5. Graph Gaps           — concepts missing from the graph + follow-up questions
 *
 * Pre-run and loading states are handled internally so Chat.tsx stays clean.
 */

import type {
  SynthesisResult,
  TermCollision,
  ConnectingThread,
  SignalConvergence,
  GraphGap,
} from "@/types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface SynthesisResultsProps {
  result: SynthesisResult | null;
  documentCount: number;
  isLoading: boolean;
  onRunSynthesis: () => void;
  /** Switches to the Chat tab and pre-fills the input with a suggested question */
  onAskInChat: (question: string) => void;
}

// ── Convergence badge config ──────────────────────────────────────────────────

const CONVERGENCE_CONFIG = {
  agreement: {
    label: "Agreement",
    className: "bg-emerald-50 text-emerald-600 border border-emerald-100",
  },
  disagreement: {
    label: "Conflict",
    className: "bg-red-50 text-red-600 border border-red-100",
  },
  partial: {
    label: "Partial",
    className: "bg-amber-50 text-amber-600 border border-amber-100",
  },
} as const;

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">
        {title}
      </h4>
      <span className="text-[10px] text-stone-300">{count}</span>
    </div>
  );
}

// ── Source chips ──────────────────────────────────────────────────────────────

function SourceChips({ sources }: { sources: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {sources.map((s) => (
        <span
          key={s}
          className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[9px] text-stone-500 truncate max-w-[140px]"
          title={s}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

// ── Individual card components ────────────────────────────────────────────────

function TermCollisionCard({ item }: { item: TermCollision }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
      {/* Variants as chips */}
      <div className="flex flex-wrap gap-1">
        {item.variants.map((v) => (
          <span
            key={v}
            className="inline-block rounded-full bg-stone-800 px-2 py-0.5 text-[10px] font-medium text-white"
          >
            {v}
          </span>
        ))}
      </div>
      {/* Suggested canonical */}
      <p className="text-[11px] text-stone-600">
        <span className="font-medium text-stone-500">Canonical: </span>
        {item.suggestedCanonical}
      </p>
      {/* Context note */}
      <p className="text-[10px] text-stone-400 leading-relaxed">{item.context}</p>
      {/* Sources */}
      <SourceChips sources={item.sources} />
    </div>
  );
}

function ConnectingThreadCard({ item }: { item: ConnectingThread }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-1.5">
      <p className="text-[11px] font-medium text-stone-700">{item.theme}</p>
      <p className="text-[10px] text-stone-500 leading-relaxed">{item.description}</p>
      <SourceChips sources={item.relatedSources} />
    </div>
  );
}

function SignalConvergenceCard({ item }: { item: SignalConvergence }) {
  const config = CONVERGENCE_CONFIG[item.convergenceType];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-stone-700 flex-1">{item.signal}</p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${config.className}`}
        >
          {config.label}
        </span>
      </div>
      <p className="text-[10px] text-stone-500 leading-relaxed">{item.description}</p>
      <SourceChips sources={item.sources} />
    </div>
  );
}

function GraphGapCard({
  item,
  onAskInChat,
}: {
  item: GraphGap;
  onAskInChat: (question: string) => void;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
      <p className="text-[10px] text-stone-500 leading-relaxed">{item.description}</p>
      {/* Suggested question — acts as a pre-filled prompt */}
      <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-2">
        <p className="text-[10px] text-stone-600 leading-relaxed italic">
          "{item.suggestedQuestion}"
        </p>
      </div>
      <button
        onClick={() => onAskInChat(item.suggestedQuestion)}
        className="text-[10px] font-medium text-stone-600 hover:text-stone-800 underline underline-offset-2 transition-colors"
      >
        Ask in Chat →
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SynthesisResults({
  result,
  documentCount,
  isLoading,
  onRunSynthesis,
  onAskInChat,
}: SynthesisResultsProps) {
  // ── Loading state ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:300ms]" />
        </div>
        <p className="text-xs text-stone-500">
          Reading across {documentCount} document{documentCount === 1 ? "" : "s"}…
        </p>
        <p className="text-[10px] text-stone-400">This may take 30–60 seconds</p>
      </div>
    );
  }

  // ── Pre-run state (no results yet) ──────────────────────────────────────

  if (!result) {
    const hasEnoughDocs = documentCount >= 2;
    const hasAnyDocs = documentCount >= 1;

    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-stone-700">Cross-source synthesis</p>
          <p className="text-xs text-stone-400 max-w-[260px] leading-relaxed">
            Reads across all transcripts to surface term collisions, connecting
            threads, evaluative patterns, and gaps in the graph.
          </p>
        </div>

        {/* Warning for single document */}
        {hasAnyDocs && !hasEnoughDocs && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 max-w-[260px]">
            <p className="text-[10px] text-amber-700 leading-relaxed">
              Cross-source synthesis works best with 2 or more documents. You
              can still run it, but results will be limited.
            </p>
          </div>
        )}

        <button
          onClick={onRunSynthesis}
          disabled={!hasAnyDocs}
          className="rounded-xl bg-stone-800 px-5 py-2 text-xs font-medium text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
        >
          {documentCount === 0
            ? "No documents yet"
            : `Run synthesis across ${documentCount} document${documentCount === 1 ? "" : "s"}`}
        </button>
      </div>
    );
  }

  // ── Results state ────────────────────────────────────────────────────────

  const {
    narrativeSummary,
    termCollisions,
    connectingThreads,
    signalConvergence,
    graphGaps,
    documentCount: docCount,
    generatedAt,
  } = result;

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-4">

      {/* ── Meta + re-run ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-stone-400">
          {docCount} source{docCount === 1 ? "" : "s"} ·{" "}
          {new Date(generatedAt).toLocaleDateString()}
        </p>
        <button
          onClick={onRunSynthesis}
          className="text-[10px] text-stone-400 hover:text-stone-700 underline underline-offset-2 transition-colors"
        >
          Re-run
        </button>
      </div>

      {/* ── Narrative summary ────────────────────────────────────────────── */}
      {narrativeSummary && (
        <div className="rounded-xl bg-stone-50 border border-stone-100 p-3">
          <p className="text-[11px] text-stone-600 leading-relaxed whitespace-pre-line">
            {narrativeSummary}
          </p>
        </div>
      )}

      {/* ── Term collisions ──────────────────────────────────────────────── */}
      {termCollisions.length > 0 && (
        <div>
          <SectionHeader title="Term Collisions" count={termCollisions.length} />
          <div className="space-y-2">
            {termCollisions.map((item, i) => (
              <TermCollisionCard key={i} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── Connecting threads ───────────────────────────────────────────── */}
      {connectingThreads.length > 0 && (
        <div>
          <SectionHeader title="Connecting Threads" count={connectingThreads.length} />
          <div className="space-y-2">
            {connectingThreads.map((item, i) => (
              <ConnectingThreadCard key={i} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── Signal convergence ───────────────────────────────────────────── */}
      {signalConvergence.length > 0 && (
        <div>
          <SectionHeader title="Signal Convergence" count={signalConvergence.length} />
          <div className="space-y-2">
            {signalConvergence.map((item, i) => (
              <SignalConvergenceCard key={i} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── Graph gaps ───────────────────────────────────────────────────── */}
      {graphGaps.length > 0 && (
        <div>
          <SectionHeader title="Graph Gaps" count={graphGaps.length} />
          <div className="space-y-2">
            {graphGaps.map((item, i) => (
              <GraphGapCard key={i} item={item} onAskInChat={onAskInChat} />
            ))}
          </div>
        </div>
      )}

      {/* All sections empty edge case */}
      {termCollisions.length === 0 &&
        connectingThreads.length === 0 &&
        signalConvergence.length === 0 &&
        graphGaps.length === 0 && (
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 text-center">
            <p className="text-xs text-stone-400">
              No cross-source patterns detected. Try adding more documents or
              using a different abstraction layer.
            </p>
          </div>
        )}

      {/* Bottom padding so last card isn't cut off */}
      <div className="h-4" />
    </div>
  );
}
