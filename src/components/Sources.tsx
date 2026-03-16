"use client";

/**
 * Sources — document upload & extraction panel.
 *
 * Per-file flow:
 *   1. POST /api/ingest  (parse + chunk + embed + persist)  → { content, chunkCount, title }
 *   2. POST /api/extract-gemini (text + currentGraph)       → { updatedGraph, graphUpdates }
 *
 * Files are processed sequentially so each extraction sees the latest graph
 * state for deduplication.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { GraphState, GraphUpdate, ProjectBrief } from "@/types";
import { autoLayout } from "@/lib/layout";

interface SourceFile {
  id: string;
  name: string;
  size: number;
  status: "queued" | "uploading" | "extracting" | "done" | "error";
  chunkCount?: number;
  entityCount?: number;
  relCount?: number;
  error?: string;
}

interface SourcesProps {
  projectId: string | null;
  graphState: GraphState;
  onGraphUpdate: (updatedGraph: GraphState, updates: GraphUpdate[]) => void;
  /** When set, new uploads use the project's abstraction layer for extraction */
  projectBrief?: ProjectBrief | null;
}

const ACCEPTED_EXTS = ["pdf", "docx", "doc", "txt", "md", "json"];

export default function Sources({ projectId, graphState, onGraphUpdate, projectBrief }: SourcesProps) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep a ref to the latest graph so sequential processing uses fresh state
  const latestGraphRef = useRef<GraphState>(graphState);
  useEffect(() => {
    latestGraphRef.current = graphState;
  }, [graphState]);

  const updateFile = useCallback((id: string, updates: Partial<SourceFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const processFile = useCallback(
    async (meta: SourceFile, raw: File) => {
      if (!projectId) return;

      // ── Step 1: Ingest ────────────────────────────────────────────────────
      updateFile(meta.id, { status: "uploading" });
      let content: string;
      try {
        const form = new FormData();
        form.append("file", raw);
        form.append("projectId", projectId);

        const res = await fetch("/api/ingest", { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Ingest failed (${res.status})`);
        }
        const data = await res.json() as { content: string; chunkCount: number; title: string };
        content = data.content;
        updateFile(meta.id, { chunkCount: data.chunkCount });
      } catch (err) {
        updateFile(meta.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        return;
      }

      // ── Step 2: Extract with Gemini ───────────────────────────────────────
      updateFile(meta.id, { status: "extracting" });
      try {
        const res = await fetch("/api/extract-gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: content,
            graphState: latestGraphRef.current,
            projectId,
            // Phase 2: pass extraction lens so Gemini uses the project's
            // abstraction layer instead of the default "extract everything" mode
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
        latestGraphRef.current = laidOut; // feed into the next file

        onGraphUpdate(laidOut, data.graphUpdates);

        const entityCount = data.graphUpdates.filter((u) => u.type === "node_created").length;
        const relCount    = data.graphUpdates.filter((u) => u.type === "relationship_created").length;
        updateFile(meta.id, { status: "done", entityCount, relCount });
      } catch (err) {
        updateFile(meta.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Extraction failed",
        });
      }
    },
    [projectId, onGraphUpdate, updateFile]
  );

  const enqueueFiles = useCallback(
    (rawFiles: File[]) => {
      const accepted = rawFiles.filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        return ACCEPTED_EXTS.includes(ext);
      });
      if (!accepted.length) return;

      const metas: SourceFile[] = accepted.map((f) => ({
        id: uuidv4(),
        name: f.name,
        size: f.size,
        status: "queued",
      }));

      setFiles((prev) => [...prev, ...metas]);

      // Process sequentially (each file sees the graph after the previous one)
      (async () => {
        for (let i = 0; i < metas.length; i++) {
          await processFile(metas[i], accepted[i]);
        }
      })();
    },
    [processFile]
  );

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
    if (status === "queued")     return <span className="text-stone-300 text-base leading-none">·</span>;
    if (status === "uploading")  return <span className="text-amber-400 animate-pulse text-sm leading-none">↑</span>;
    if (status === "extracting") return <span className="text-blue-400 animate-spin inline-block text-sm leading-none">⟳</span>;
    if (status === "done")       return <span className="text-emerald-500 text-sm leading-none">✓</span>;
    return                              <span className="text-red-400 text-sm leading-none">✕</span>;
  };

  const statusLabel = (f: SourceFile): string => {
    if (f.status === "queued")     return "Queued";
    if (f.status === "uploading")  return "Uploading…";
    if (f.status === "extracting") return "Extracting…";
    if (f.status === "done")       return `${f.entityCount ?? 0} entities · ${f.relCount ?? 0} rels`;
    return f.error ?? "Error";
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => projectId && fileInputRef.current?.click()}
        className={`mx-4 mt-4 mb-3 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center py-7 gap-1.5 ${
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
          {isDragging ? "Drop to upload" : "Drop files or click to upload"}
        </p>
        <p className="text-[10px] text-stone-400">PDF · DOCX · TXT · MD · JSON</p>
        {!projectId && (
          <p className="text-[10px] text-red-400 mt-1">Select a project first</p>
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

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 mt-6 px-4">
            <p className="text-center text-[10px] text-stone-400 leading-relaxed">
              Upload documents to extract entities and relationships directly onto the canvas.
            </p>
            <p className="text-center text-[10px] text-stone-300">
              Each file is chunked, embedded, and passed to Gemini for extraction.
            </p>
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
                    : "border-stone-100 bg-white"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 flex justify-center">
                    <StatusIcon status={f.status} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-stone-700 truncate">{f.name}</p>
                    <p
                      className={`text-[10px] mt-0.5 ${
                        f.status === "error" ? "text-red-400" : "text-stone-400"
                      }`}
                    >
                      {statusLabel(f)}
                      {f.status !== "error" && (
                        <span className="text-stone-300"> · {formatSize(f.size)}</span>
                      )}
                    </p>
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
