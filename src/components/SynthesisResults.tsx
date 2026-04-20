"use client";

/**
 * SynthesisResults — The Winemaker's Reading
 *
 * Three-part structure replacing the flat report layout:
 *
 *   Opening   — soil_note surfaced first, alone. The winemaker's observation
 *               about the organisation's pattern of attention. Rendered in a
 *               distinct register: larger, quieter, set apart. Not a section.
 *
 *   Map        — the four knowledge-map sections as supporting evidence.
 *               Term Collisions / Connecting Threads / Signal Convergence /
 *               Graph Gaps. Visually subordinate — they explain the opening,
 *               they don't replace it.
 *
 *   Invitation — the single most generative graph gap, surfaced as one
 *               question with node chips that light up on the canvas.
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
  /** Highlights the named nodes on the canvas; call with [] to clear */
  onHighlightNodes: (nodeNames: string[]) => void;
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
      <p className="text-[11px] text-stone-600">
        <span className="font-medium text-stone-500">Canonical: </span>
        {item.suggestedCanonical}
      </p>
      <p className="text-[10px] text-stone-400 leading-relaxed">{item.context}</p>
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

// ── Invitation — the traversal close ─────────────────────────────────────────
//
// Renders the single most generative gap as a question + node chips.
// Clicking a chip highlights that node on the canvas; clicking the
// question button pre-fills Chat. The whole block has a distinct
// treatment — it's an invitation to move, not a finding to read.

function InvitationBlock({
  question,
  nodeNames,
  onAskInChat,
  onHighlightNodes,
}: {
  question: string;
  nodeNames: string[];
  onAskInChat: (question: string) => void;
  onHighlightNodes: (names: string[]) => void;
}) {
  return (
    <div className="rounded-xl border border-stone-300 bg-stone-50 p-3.5 space-y-3">
      {/* Label */}
      <p className="text-[9px] font-medium text-stone-400 uppercase tracking-widest">
        Where to go next
      </p>

      {/* The question */}
      <p className="text-[12px] text-stone-700 leading-relaxed font-medium">
        {question}
      </p>

      {/* Node chips — clicking lights up the canvas */}
      {nodeNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {nodeNames.map((name) => (
            <button
              key={name}
              onClick={() => onHighlightNodes([name])}
              className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] text-stone-600 hover:border-stone-500 hover:text-stone-800 transition-colors"
              title={`Highlight "${name}" on canvas`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-stone-400 shrink-0" />
              {name}
            </button>
          ))}
          {/* Highlight all at once */}
          {nodeNames.length > 1 && (
            <button
              onClick={() => onHighlightNodes(nodeNames)}
              className="inline-flex items-center rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-[10px] text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-colors"
            >
              Show all
            </button>
          )}
        </div>
      )}

      {/* Ask in chat */}
      <button
        onClick={() => onAskInChat(question)}
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
  onHighlightNodes,
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

  // ── Pre-run state ────────────────────────────────────────────────────────

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
    soilNote,
    termCollisions,
    connectingThreads,
    signalConvergence,
    graphGaps,
    invitationQuestion,
    invitationNodeNames,
    documentCount: docCount,
    generatedAt,
  } = result;

  const hasMapContent =
    termCollisions.length > 0 ||
    connectingThreads.length > 0 ||
    signalConvergence.length > 0 ||
    graphGaps.length > 0;

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-5">

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

      {/* ── OPENING: The winemaker's soil note ───────────────────────────── */}
      {/* Rendered before everything else. Not a section, not a card — a
          presence. The observation about the organisation's pattern of
          attention sets the interpretive frame for all the map below. */}
      {soilNote && (
        <div className="py-1">
          <p className="text-[13px] text-stone-500 leading-relaxed italic font-light">
            {soilNote}
          </p>
        </div>
      )}

      {/* Divider between opening and map */}
      {soilNote && hasMapContent && (
        <div className="border-t border-stone-100" />
      )}

      {/* ── MAP: The four knowledge-map sections ─────────────────────────── */}
      {/* These are supporting evidence for the soil note — they show what
          the winemaker listened to, not what you should conclude. */}

      {/* Narrative summary (subordinate — smaller, lighter) */}
      {narrativeSummary && (
        <div className="rounded-xl bg-stone-50 border border-stone-100 p-3">
          <p className="text-[10px] text-stone-500 leading-relaxed whitespace-pre-line">
            {narrativeSummary}
          </p>
        </div>
      )}

      {/* Term collisions */}
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

      {/* Connecting threads */}
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

      {/* Signal convergence */}
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

      {/* Graph gaps (full list — invitation is a separate, elevated pick) */}
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

      {/* Empty map edge case */}
      {!hasMapContent && (
        <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 text-center">
          <p className="text-xs text-stone-400">
            No cross-source patterns detected. Try adding more documents or
            using a different abstraction layer.
          </p>
        </div>
      )}

      {/* Divider before invitation */}
      {invitationQuestion && <div className="border-t border-stone-100" />}

      {/* ── INVITATION: One question + canvas highlight ───────────────────── */}
      {/* The close of the reading. Not a list of gaps — one question, the
          most generative one. Node chips let the consultant light up the
          canvas and lead the client through the landscape. */}
      {invitationQuestion && (
        <InvitationBlock
          question={invitationQuestion}
          nodeNames={invitationNodeNames ?? []}
          onAskInChat={onAskInChat}
          onHighlightNodes={onHighlightNodes}
        />
      )}

      {/* Bottom padding so last card isn't cut off */}
      <div className="h-4" />
    </div>
  );
}
