"use client";

import { useTranslations } from "next-intl";

/**
 * Sources — document upload, classification & extraction panel.
 *
 * 5-phase flow:
 *   1. INGEST   — parallel POST /api/ingest for all files (parse + chunk + embed)
 *                 OR direct paste (skips ingest, goes straight to classify)
 *   2. CLASSIFY — batch POST /api/classify (Gemini evaluates all docs in one call)
 *   3. REVIEW   — user sees EXTRACT/CAUTION/SKIP verdicts, can override
 *   4. EXTRACT  — sequential POST /api/extract-gemini for approved files only
 *   5. INTEGRATE — optional POST /api/integrate — merges cross-doc duplicates,
 *                  adds cross-document relationships, corrects attractor assignments
 *
 * Files are extracted sequentially so each extraction sees the latest graph
 * state for deduplication. Ingest is parallelised (no dedup concern there).
 *
 * Paste-text: for Confluence / wiki / copy-paste workflows. Pasted content
 * skips the /api/ingest step (no file parsing needed) and joins the pipeline
 * at the classify phase with the raw text.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { GraphState, GraphUpdate, ProjectBrief, DocumentClassification, ClassificationVerdict, IntegrationResult } from "@/types";
import { autoLayout } from "@/lib/layout";
import { getProjectDocumentHeaders } from "@/lib/supabase";

interface SourceFile {
  id: string;
  name: string;
  size: number;
  status: "queued" | "uploading" | "classifying" | "classified" | "extracting" | "done" | "skipped" | "error";
  chunkCount?: number;
  entityCount?: number;
  relCount?: number;
  error?: string;
  content?: string;                          // parsed text from ingest (needed for classify + extract)
  classification?: DocumentClassification;   // verdict from Gemini classification
  isPasted?: boolean;                        // true for paste-text entries (no file upload)
  documentId?: string;                       // Supabase document id (set after ingest)
}

interface SourcesProps {
  projectId: string | null;
  graphState: GraphState;
  onGraphUpdate: (updatedGraph: GraphState, updates: GraphUpdate[]) => void;
  /** When set, new uploads use the project's abstraction layer for extraction */
  projectBrief?: ProjectBrief | null;
}

const ACCEPTED_EXTS = ["pdf", "docx", "doc", "txt", "md", "json"];
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB — Vercel serverless body limit

export default function Sources({ projectId, graphState, onGraphUpdate, projectBrief }: SourcesProps) {
  const t = useTranslations();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [hasClassified, setHasClassified] = useState(false);

  // ── Phase 5: Integration state ────────────────────────────────────────────
  const [integrationState, setIntegrationState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [integrationResult, setIntegrationResult] = useState<IntegrationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Paste-text mode ───────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");

  // Keep a ref to the latest graph so sequential processing uses fresh state
  const latestGraphRef = useRef<GraphState>(graphState);
  useEffect(() => {
    latestGraphRef.current = graphState;
  }, [graphState]);

  // ── Restore document history from Supabase on mount / project switch ─────
  // Sources.tsx starts with an empty `files` list every session. This effect
  // fetches lightweight headers (id + title, no content) for documents that
  // were uploaded in previous sessions and hydrates them as "done" entries so
  // the user can always see what has been processed. Only runs when the file
  // list is empty to avoid overwriting an active upload session.
  useEffect(() => {
    if (!projectId || files.length > 0) return;

    getProjectDocumentHeaders(projectId)
      .then((headers) => {
        if (headers.length === 0) return;
        const restored: SourceFile[] = headers.map((h) => ({
          id: uuidv4(),         // local UI id — not the Supabase document id
          documentId: h.id,     // Supabase id — used by removeFile for deletion
          name: h.title,
          size: 0,              // content not fetched; size unknown
          status: "done",
        }));
        setFiles(restored);
      })
      .catch((err) =>
        console.warn("[Sources] Failed to restore document history (non-fatal):", err)
      );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]); // intentionally exclude `files` — only run on project change

  const updateFile = useCallback((id: string, updates: Partial<SourceFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const removeFile = useCallback(async (file: SourceFile) => {
    // Remove from local state immediately (optimistic)
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    // If the file was ingested, delete it from Supabase too
    if (file.documentId) {
      await fetch(`/api/documents/${file.documentId}`, { method: "DELETE" }).catch((err) =>
        console.warn("[Sources] Failed to delete document from Supabase:", err)
      );
    }
  }, []);

  // ── Phase 1: Parallel ingest ──────────────────────────────────────────────

  const ingestFile = useCallback(
    async (meta: SourceFile, raw: File): Promise<{ id: string; content: string; title: string } | null> => {
      if (!projectId) return null;

      updateFile(meta.id, { status: "uploading" });
      try {
        const form = new FormData();
        form.append("file", raw);
        form.append("projectId", projectId);

        const res = await fetch("/api/ingest", { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Ingest failed (${res.status})`);
        }
        const data = await res.json() as { documentId: string; content: string; chunkCount: number; title: string };
        updateFile(meta.id, { chunkCount: data.chunkCount, content: data.content, documentId: data.documentId });
        return { id: meta.id, content: data.content, title: data.title || meta.name };
      } catch (err) {
        updateFile(meta.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        return null;
      }
    },
    [projectId, updateFile]
  );

  // ── Phase 2: Batch classify ───────────────────────────────────────────────

  const classifyFiles = useCallback(
    async (ingested: { id: string; content: string; title: string }[]) => {
      if (!projectId || ingested.length === 0) return;

      setIsClassifying(true);

      // Mark all ingested files as classifying
      for (const doc of ingested) {
        updateFile(doc.id, { status: "classifying" });
      }

      try {
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documents: ingested.map((doc, i) => ({
              index: i,
              title: doc.title,
              content: doc.content,
            })),
            projectId,
            projectBrief: projectBrief ?? undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Classification failed (${res.status})`);
        }

        const data = await res.json() as { classifications: DocumentClassification[] };

        // Map classifications back to files
        for (let i = 0; i < data.classifications.length; i++) {
          const classification = data.classifications[i];
          const doc = ingested[classification.documentIndex ?? i];
          if (doc) {
            updateFile(doc.id, {
              status: "classified",
              classification,
            });
          }
        }

        setHasClassified(true);
      } catch (err) {
        console.error("[classify] Error:", err);
        // Fallback: classify everything as EXTRACT
        for (const doc of ingested) {
          updateFile(doc.id, {
            status: "classified",
            classification: {
              documentIndex: 0,
              title: doc.title,
              verdict: "EXTRACT",
              genre: "unknown",
              confidence: 0,
              reason: "Classification failed — defaulting to extract",
            },
          });
        }
        setHasClassified(true);
      } finally {
        setIsClassifying(false);
      }
    },
    [projectId, projectBrief, updateFile]
  );

  // ── Phase 3: Toggle verdict (user override) ───────────────────────────────

  const toggleVerdict = useCallback((fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== fileId || !f.classification) return f;
        const cycle: ClassificationVerdict[] = ["EXTRACT", "CAUTION", "SKIP"];
        const currentIdx = cycle.indexOf(f.classification.verdict);
        const nextVerdict = cycle[(currentIdx + 1) % cycle.length];
        return {
          ...f,
          classification: { ...f.classification, verdict: nextVerdict },
        };
      })
    );
  }, []);

  // ── Phase 4: Sequential extract (approved files only) ─────────────────────

  const extractApproved = useCallback(async () => {
    if (!projectId) return;

    setIsExtracting(true);

    const toExtract = files.filter(
      (f) => f.classification && f.classification.verdict !== "SKIP" && f.content && f.status === "classified"
    );

    // Mark skipped files
    setFiles((prev) =>
      prev.map((f) =>
        f.classification?.verdict === "SKIP" && f.status === "classified"
          ? { ...f, status: "skipped" }
          : f
      )
    );

    for (const file of toExtract) {
      updateFile(file.id, { status: "extracting" });
      try {
        const res = await fetch("/api/extract-gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: file.content,
            graphState: latestGraphRef.current,
            projectId,
            abstractionLayer: projectBrief?.abstractionLayer,
            projectBrief: projectBrief ?? undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Extraction failed (${res.status})`);
        }

        const data = await res.json() as { updatedGraph: GraphState; graphUpdates: GraphUpdate[] };
        const laidOut = autoLayout(data.updatedGraph);
        latestGraphRef.current = laidOut;
        onGraphUpdate(laidOut, data.graphUpdates);

        const entityCount = data.graphUpdates.filter((u) => u.type === "node_created").length;
        const relCount = data.graphUpdates.filter((u) => u.type === "relationship_created").length;
        updateFile(file.id, { status: "done", entityCount, relCount });
      } catch (err) {
        updateFile(file.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Extraction failed",
        });
      }
    }

    setIsExtracting(false);
  }, [files, projectId, projectBrief, onGraphUpdate, updateFile]);

  // ── Phase 5: Integration pass ─────────────────────────────────────────────
  // Calls /api/integrate which runs a Gemini pass over the full entity set:
  //   - Merges near-duplicate entities across documents
  //   - Adds cross-document relationships
  //   - Corrects attractor assignments

  const runIntegration = useCallback(async () => {
    if (!projectId) return;
    setIntegrationState("running");
    setIntegrationResult(null);
    try {
      const res = await fetch("/api/integrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Integration failed (${res.status})`);
      }

      const data = await res.json() as { updatedGraph: GraphState; result: IntegrationResult };
      const laidOut = autoLayout(data.updatedGraph);
      onGraphUpdate(laidOut, []); // refresh canvas with integrated graph
      setIntegrationResult(data.result);
      setIntegrationState("done");
    } catch (err) {
      console.error("[Sources] Integration error:", err);
      setIntegrationState("error");
    }
  }, [projectId, onGraphUpdate]);

  // ── Enqueue: ingest → classify → wait for user ────────────────────────────

  const enqueueFiles = useCallback(
    (rawFiles: File[]) => {
      const accepted = rawFiles.filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        return ACCEPTED_EXTS.includes(ext);
      });
      if (!accepted.length) return;

      const oversized: File[] = [];
      const ok: File[] = [];
      for (const f of accepted) {
        (f.size > MAX_FILE_BYTES ? oversized : ok).push(f);
      }

      const oversizedMetas: SourceFile[] = oversized.map((f) => ({
        id: uuidv4(),
        name: f.name,
        size: f.size,
        status: "error",
        error: `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB) — max 4 MB. Split the PDF or use Paste Text.`,
      }));

      const metas: SourceFile[] = ok.map((f) => ({
        id: uuidv4(),
        name: f.name,
        size: f.size,
        status: "queued",
      }));

      setFiles((prev) => [...prev, ...oversizedMetas, ...metas]);
      setHasClassified(false);

      if (!ok.length) return;

      // Phase 1+2: Parallel ingest, then batch classify
      (async () => {
        // Parallel ingest with Promise.allSettled
        const results = await Promise.allSettled(
          metas.map((meta, i) => ingestFile(meta, ok[i]))
        );

        // Collect successful ingests
        const ingested = results
          .map((r) => (r.status === "fulfilled" ? r.value : null))
          .filter((r): r is { id: string; content: string; title: string } => r !== null);

        if (ingested.length > 0) {
          await classifyFiles(ingested);
        }
      })();
    },
    [ingestFile, classifyFiles]
  );

  // ── Paste-text: skip ingest, go straight to classify ──────────────────

  const enqueuePastedText = useCallback(() => {
    const trimmed = pasteContent.trim();
    if (!trimmed || !projectId) return;

    const title = pasteTitle.trim() || "Pasted document";
    const meta: SourceFile = {
      id: uuidv4(),
      name: title,
      size: new Blob([trimmed]).size,
      status: "queued",
      content: trimmed,
      isPasted: true,
    };

    setFiles((prev) => [...prev, meta]);
    setHasClassified(false);
    setPasteTitle("");
    setPasteContent("");

    // Skip ingest (no file to parse) — go directly to classify
    (async () => {
      updateFile(meta.id, { status: "uploading" }); // brief visual feedback
      // Small delay so user sees the file appear before classifying
      updateFile(meta.id, { status: "classifying" });

      await classifyFiles([{ id: meta.id, content: trimmed, title }]);
    })();
  }, [pasteContent, pasteTitle, projectId, classifyFiles, updateFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      enqueueFiles(Array.from(e.dataTransfer.files));
    },
    [enqueueFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      enqueueFiles(Array.from(e.target.files ?? []));
      e.target.value = "";
    },
    [enqueueFiles]
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const StatusIcon = ({ status }: { status: SourceFile["status"] }) => {
    if (status === "queued")       return <span className="text-stone-300 text-base leading-none">·</span>;
    if (status === "uploading")    return <span className="text-amber-400 animate-pulse text-sm leading-none">↑</span>;
    if (status === "classifying")  return <span className="text-violet-400 animate-pulse text-sm leading-none">◎</span>;
    if (status === "classified")   return <span className="text-stone-400 text-sm leading-none">◉</span>;
    if (status === "extracting")   return <span className="text-blue-400 animate-spin inline-block text-sm leading-none">⟳</span>;
    if (status === "done")         return <span className="text-emerald-500 text-sm leading-none">✓</span>;
    if (status === "skipped")      return <span className="text-stone-300 text-sm leading-none">–</span>;
    return                                <span className="text-red-400 text-sm leading-none">✕</span>;
  };

  const VerdictBadge = ({ file }: { file: SourceFile }) => {
    if (!file.classification) return null;
    const v = file.classification.verdict;
    const colors = {
      EXTRACT: "bg-emerald-50 text-emerald-600 border-emerald-200",
      CAUTION: "bg-amber-50 text-amber-600 border-amber-200",
      SKIP:    "bg-stone-50 text-stone-400 border-stone-200 line-through",
    };
    return (
      <button
        onClick={(e) => { e.stopPropagation(); toggleVerdict(file.id); }}
        className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${colors[v]} hover:opacity-80 transition-opacity cursor-pointer`}
        title={`${file.classification.reason} — click to change`}
      >
        {v}
      </button>
    );
  };

  const statusLabel = (f: SourceFile): string => {
    if (f.status === "queued")       return t("sources.status.queued");
    if (f.status === "uploading")    return t("sources.status.uploading");
    if (f.status === "classifying")  return t("sources.status.classifying");
    if (f.status === "classified")   return f.classification?.genre ?? "Classified";
    if (f.status === "extracting")   return t("sources.status.extracting");
    if (f.status === "done")         return `${f.entityCount ?? 0} entities · ${f.relCount ?? 0} rels`;
    if (f.status === "skipped")      return f.classification?.reason ?? t("sources.status.skipped");
    return f.error ?? "Error";
  };

  // ── Summary counts ────────────────────────────────────────────────────────

  const classifiedFiles = files.filter((f) => f.classification);
  const extractCount = classifiedFiles.filter((f) => f.classification?.verdict === "EXTRACT").length;
  const cautionCount = classifiedFiles.filter((f) => f.classification?.verdict === "CAUTION").length;
  const skipCount    = classifiedFiles.filter((f) => f.classification?.verdict === "SKIP").length;
  const showSummary  = hasClassified && classifiedFiles.length > 0;

  // ── Guided checklist: visible when no files loaded ────────────────────────
  const [checklistOpen, setChecklistOpen] = useState(true);
  // Auto-collapse checklist once first file is added
  useEffect(() => {
    if (files.length > 0) setChecklistOpen(false);
  }, [files.length]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Input mode toggle: Upload / Paste ─────────────────────────────── */}
      <div className="flex items-center gap-1 mx-4 mt-3 mb-2">
        <button
          onClick={() => setInputMode("upload")}
          className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            inputMode === "upload"
              ? "bg-stone-800 text-white"
              : "bg-stone-100 text-stone-500 hover:bg-stone-200"
          }`}
        >
          {t("sources.modes.upload")}
        </button>
        <button
          onClick={() => setInputMode("paste")}
          className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            inputMode === "paste"
              ? "bg-stone-800 text-white"
              : "bg-stone-100 text-stone-500 hover:bg-stone-200"
          }`}
        >
          {t("sources.modes.paste")}
        </button>
      </div>

      {/* ── Upload mode: file drop zone ───────────────────────────────────── */}
      {inputMode === "upload" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => projectId && fileInputRef.current?.click()}
          className={`mx-4 mb-3 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center py-7 gap-1.5 ${
            !projectId
              ? "border-stone-100 cursor-not-allowed opacity-60"
              : isDragging
              ? "border-stone-400 bg-stone-50 cursor-copy"
              : "border-stone-200 hover:border-stone-300 hover:bg-stone-50 cursor-pointer"
          }`}
        >
          <svg
            className={`w-6 h-6 ${isDragging ? "text-stone-500" : "text-stone-300"}`}
            fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-xs font-medium text-stone-500">
            {isDragging ? t("sources.upload.dropping") : t("sources.upload.dropzone")}
          </p>
          <p className="text-[10px] text-stone-400">{t("sources.upload.fileTypes")}</p>
          {!projectId && (
            <p className="text-[10px] text-red-400 mt-1">{t("common.selectProjectFirst")}</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md,.json"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* ── Paste mode: title + textarea ──────────────────────────────────── */}
      {inputMode === "paste" && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          <input
            type="text"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            placeholder={t("sources.paste.titlePlaceholder")}
            disabled={!projectId}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[11px] text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none disabled:opacity-60"
          />
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder={t("sources.paste.contentPlaceholder")}
            rows={5}
            disabled={!projectId}
            className="w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px] text-stone-700 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={enqueuePastedText}
            disabled={!projectId || !pasteContent.trim()}
            className="w-full rounded-lg bg-stone-800 py-1.5 text-[10px] font-medium text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
          >
            {t("sources.paste.addButton")}
          </button>
          {!projectId && (
            <p className="text-[10px] text-red-400">{t("common.selectProjectFirst")}</p>
          )}
        </div>
      )}

      {/* Classification summary + Extract button */}
      {showSummary && (
        <div className="mx-4 mb-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-stone-500">
              <span className="text-emerald-600 font-medium">{extractCount} {t("sources.summary.extract")}</span>
              {cautionCount > 0 && <> · <span className="text-amber-600 font-medium">{cautionCount} {t("sources.summary.caution")}</span></>}
              {skipCount > 0 && <> · <span className="text-stone-400">{skipCount} {t("sources.summary.skip")}</span></>}
            </p>
            {!isExtracting && (extractCount + cautionCount) > 0 && (
              <button
                onClick={extractApproved}
                className="text-[10px] font-medium text-white bg-stone-800 hover:bg-stone-700 px-3 py-1 rounded-md transition-colors"
              >
                {t("sources.summary.extractButton", { count: extractCount + cautionCount })}
              </button>
            )}
            {isExtracting && (
              <span className="text-[10px] text-blue-500 animate-pulse font-medium">
                {t("sources.summary.extracting")}
              </span>
            )}
          </div>
          <p className="text-[9px] text-stone-400 mt-1">
            {t("sources.summary.hint")}
          </p>
        </div>
      )}

      {/* ── Phase 5: Integration panel ───────────────────────────────────── */}
      {files.some((f) => f.status === "done") && (
        <div className="mx-4 mb-3 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2.5">
          {integrationState === "idle" && (
            <>
              <p className="text-[10px] text-violet-700 font-medium mb-1">
                {t("sources.integration.title")}
              </p>
              <p className="text-[10px] text-violet-500 mb-2">
                {t("sources.integration.description", { count: graphState.nodes.length })}
              </p>
              <button
                onClick={runIntegration}
                className="text-[10px] font-medium text-white bg-violet-600 hover:bg-violet-700 px-3 py-1 rounded-md transition-colors"
              >
                {t("sources.integration.runButton")}
              </button>
            </>
          )}
          {integrationState === "running" && (
            <p className="text-[10px] text-violet-500 animate-pulse font-medium">
              {t("sources.integration.running")}
            </p>
          )}
          {integrationState === "done" && integrationResult && (
            <>
              <p className="text-[10px] text-violet-700 font-medium mb-1">{t("sources.integration.done")}</p>
              <p className="text-[10px] text-violet-500">
                Merged {integrationResult.entitiesMerged} entities into {integrationResult.mergeGroupCount} groups
                {integrationResult.relationshipsAdded > 0 && ` · +${integrationResult.relationshipsAdded} cross-doc relationships`}
                {integrationResult.attractorsReassigned > 0 && ` · ${integrationResult.attractorsReassigned} attractors corrected`}
              </p>
              <button
                onClick={() => { setIntegrationState("idle"); setIntegrationResult(null); }}
                className="mt-1.5 text-[9px] text-violet-400 underline underline-offset-2 hover:text-violet-600"
              >
                {t("sources.integration.runAgain")}
              </button>
            </>
          )}
          {integrationState === "error" && (
            <>
              <p className="text-[10px] text-red-500 font-medium">{t("sources.integration.failed")}</p>
              <button
                onClick={() => setIntegrationState("idle")}
                className="mt-1 text-[9px] text-stone-400 underline underline-offset-2 hover:text-stone-600"
              >
                {t("common.tryAgain")}
              </button>
            </>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {files.length === 0 ? (
          <div className="flex flex-col gap-3 mt-3">
            {/* ── Guided upload checklist (Step 3) ───────────────────────── */}
            <div className="rounded-lg border border-stone-100 bg-stone-50 overflow-hidden">
              <button
                onClick={() => setChecklistOpen(!checklistOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
              >
                <span>{t("sources.checklist.title")}</span>
                <span className={`text-stone-400 transition-transform ${checklistOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
              {checklistOpen && (
                <div className="px-3 pb-3 text-[10px] text-stone-500 leading-relaxed space-y-2.5">
                  {/* Priority list */}
                  <div>
                    <p className="font-medium text-stone-600 mb-1">{t("sources.checklist.highValue")}</p>
                    <ul className="space-y-0.5 ml-2">
                      <li className="flex items-start gap-1.5">
                        <span className="text-emerald-500 mt-px shrink-0">1.</span>
                        <span>{t("sources.checklist.item1")}</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-emerald-500 mt-px shrink-0">2.</span>
                        <span>{t("sources.checklist.item2")}</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-emerald-500 mt-px shrink-0">3.</span>
                        <span>{t("sources.checklist.item3")}</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-emerald-500 mt-px shrink-0">4.</span>
                        <span>{t("sources.checklist.item4")}</span>
                      </li>
                    </ul>
                  </div>
                  {/* Skip list */}
                  <div>
                    <p className="font-medium text-stone-600 mb-1">{t("sources.checklist.skipTitle")}</p>
                    <p className="text-stone-400 ml-2">{t("sources.checklist.skipContent")}</p>
                  </div>
                  {/* Source tips */}
                  <div className="border-t border-stone-100 pt-2">
                    <p className="font-medium text-stone-600 mb-1">{t("sources.checklist.exportTitle")}</p>
                    <ul className="space-y-0.5 ml-2 text-stone-400">
                      <li><strong className="text-stone-500">Confluence</strong> — Space settings → Export → HTML or PDF</li>
                      <li><strong className="text-stone-500">SharePoint</strong> — Select files → Download (or use &quot;Paste text&quot;)</li>
                      <li><strong className="text-stone-500">Google Drive</strong> — Right-click → Download as .docx</li>
                      <li><strong className="text-stone-500">Notion</strong> — ··· menu → Export → Markdown & CSV</li>
                      <li><strong className="text-stone-500">Wiki / other</strong> — Use the &quot;Paste text&quot; tab above</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
            {/* Empty state text */}
            <div className="flex flex-col items-center gap-2 px-4">
              <p className="text-center text-[10px] text-stone-400 leading-relaxed">
                {t("sources.emptyLine1")}
              </p>
              <p className="text-center text-[10px] text-stone-300">
                {t("sources.emptyLine2")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {files.map((f) => (
              <div
                key={f.id}
                className={`rounded-lg border px-3 py-2 transition-colors ${
                  f.status === "error"
                    ? "border-red-100 bg-red-50"
                    : f.status === "done"
                    ? "border-emerald-100 bg-white"
                    : f.status === "skipped"
                    ? "border-stone-100 bg-stone-50 opacity-60"
                    : f.classification?.verdict === "SKIP"
                    ? "border-stone-100 bg-stone-50 opacity-60"
                    : "border-stone-100 bg-white"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 flex justify-center">
                    <StatusIcon status={f.status} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {f.isPasted && (
                        <span className="text-stone-300 text-[9px] shrink-0" title="Pasted text">✎</span>
                      )}
                      <p className="text-[11px] font-medium text-stone-700 truncate flex-1">{f.name}</p>
                      <VerdictBadge file={f} />
                      {!["uploading", "classifying", "extracting"].includes(f.status) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(f); }}
                          className="text-stone-300 hover:text-red-400 transition-colors text-[11px] leading-none shrink-0 ml-0.5"
                          title="Remove from list"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <p
                      className={`text-[10px] mt-0.5 ${
                        f.status === "error" ? "text-red-400" : "text-stone-400"
                      }`}
                    >
                      {statusLabel(f)}
                      {f.status !== "error" && f.status !== "skipped" && f.size > 0 && (
                        <span className="text-stone-300"> · {formatSize(f.size)}</span>
                      )}
                    </p>
                    {f.status === "error" && (f.error?.includes("scanned") || f.error?.includes("usable text") || f.error?.includes("too large")) && (
                      <button
                        onClick={() => setInputMode("paste")}
                        className="text-[9px] text-stone-400 underline underline-offset-2 hover:text-stone-600 mt-0.5"
                      >
                        {t("sources.status.switchToPaste")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
