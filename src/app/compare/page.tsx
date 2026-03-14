"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { GraphState } from "@/types";
import { loadOntology } from "@/lib/supabase";
import { useProject } from "@/lib/project-context";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  doc_url?: string;
  doc_title?: string;
  doc_section?: string;
  // Phase 1 compat
  url?: string;
  title?: string;
  section?: string;
}

interface VectorResponse {
  query: string;
  results: SearchResult[];
  type: "vector";
}

interface OntologyResponse {
  query: string;
  expandedQuery: string;
  results: SearchResult[];
  ontologyContext: {
    matchedEntities: Array<{
      label: string;
      type: string;
      description: string;
      matchScore: number;
    }>;
    graphHops: Array<{ from: string; relationship: string; to: string; description?: string }>;
    nodesUsed: number;
    graphSize: number;
  };
  type: "ontology";
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const { projectId, project } = useProject();

  const [query, setQuery] = useState("");
  const [graphState, setGraphState] = useState<GraphState | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const [vectorResult, setVectorResult] = useState<VectorResponse | null>(null);
  const [ontologyResult, setOntologyResult] = useState<OntologyResponse | null>(null);
  const [vectorLoading, setVectorLoading] = useState(false);
  const [ontologyLoading, setOntologyLoading] = useState(false);
  const [vectorError, setVectorError] = useState<string | null>(null);
  const [ontologyError, setOntologyError] = useState<string | null>(null);

  // Load the current project's ontology from Supabase
  useEffect(() => {
    if (!projectId) return;
    setGraphLoading(true);
    loadOntology(projectId)
      .then(setGraphState)
      .catch(() => setGraphState(null))
      .finally(() => setGraphLoading(false));
  }, [projectId]);

  // Generate preset chips from ontology nodes (first 8 unique labels)
  const presetChips = graphState?.nodes
    .slice(0, 8)
    .map((n) => ({ label: n.label, query: n.label })) ?? [];

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !projectId) return;

      setVectorResult(null);
      setOntologyResult(null);
      setVectorError(null);
      setOntologyError(null);
      setVectorLoading(true);
      setOntologyLoading(true);

      // Vector search — project-scoped
      fetch("/api/search/vector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, topK: 5, projectId }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Vector search failed");
          return data as VectorResponse;
        })
        .then(setVectorResult)
        .catch((e) => setVectorError(e.message))
        .finally(() => setVectorLoading(false));

      // Ontology search — graph loaded from Supabase server-side via projectId
      if (!graphState) {
        setOntologyError("No ontology loaded for this project yet — build one on the Canvas first");
        setOntologyLoading(false);
        return;
      }

      fetch("/api/search/ontology", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, projectId, topK: 5 }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Ontology search failed");
          return data as OntologyResponse;
        })
        .then(setOntologyResult)
        .catch((e) => setOntologyError(e.message))
        .finally(() => setOntologyLoading(false));
    },
    [graphState, projectId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handlePreset = (q: string) => {
    setQuery(q);
    runSearch(q);
  };

  const isSearching = vectorLoading || ontologyLoading;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <div className="border-b border-stone-200 bg-white px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
            ← Canvas
          </Link>
          <h1 className="text-sm font-semibold text-stone-800">RAG Comparison</h1>
          <span className="text-xs text-stone-400">Vector vs Ontology-Guided</span>
          {project && (
            <>
              <span className="text-stone-200">·</span>
              <span className="text-xs text-stone-500 font-medium">{project.name}</span>
            </>
          )}
        </div>
        <div className="text-xs">
          {graphLoading ? (
            <span className="text-stone-400">Loading ontology…</span>
          ) : graphState && graphState.nodes.length > 0 ? (
            <span className="text-emerald-600">
              ✓ {graphState.nodes.length} nodes · {graphState.relationships.length} relationships
            </span>
          ) : (
            <span className="text-amber-500">
              ⚠ No ontology — build one on the Canvas first
            </span>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="border-b border-stone-100 bg-white px-6 py-4 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={project ? `Search ${project.name} corpus…` : "Enter a search query…"}
            className="flex-1 rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-800 placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!query.trim() || isSearching || !projectId}
            className="rounded-lg bg-stone-800 px-5 py-2 text-sm text-white hover:bg-stone-700 disabled:bg-stone-300 transition-colors"
          >
            {isSearching ? "Searching…" : "Search"}
          </button>
        </form>

        {/* Ontology entity chips — generated from project's graph */}
        {presetChips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-stone-400 uppercase tracking-wide shrink-0">
              From ontology
            </span>
            {presetChips.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p.query)}
                disabled={isSearching}
                title={`Search for "${p.query}"`}
                className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors disabled:opacity-40"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {presetChips.length === 0 && !graphLoading && (
          <p className="text-[11px] text-stone-400">
            Build an ontology on the Canvas to get entity-based search suggestions here.
          </p>
        )}
      </div>

      {/* Results columns */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-stone-200 min-h-0">
        {/* Left: Vector RAG */}
        <div className="p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Vector RAG
            </h2>
            <span className="text-[10px] text-stone-400 font-mono">raw embed → search</span>
          </div>
          {vectorLoading && <LoadingState />}
          {vectorError && <ErrorState message={vectorError} />}
          {vectorResult && <ResultsList results={vectorResult.results} />}
          {!vectorLoading && !vectorResult && !vectorError && <EmptyState />}
        </div>

        {/* Right: Ontology RAG */}
        <div className="p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Ontology-Guided RAG
            </h2>
            <span className="text-[10px] text-stone-400 font-mono">
              graph traverse → expand → search
            </span>
          </div>
          {ontologyLoading && <LoadingState />}
          {ontologyError && <ErrorState message={ontologyError} />}
          {ontologyResult && (
            <>
              <OntologyTrace result={ontologyResult} />
              <ResultsList results={ontologyResult.results} />
            </>
          )}
          {!ontologyLoading && !ontologyResult && !ontologyError && <EmptyState />}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500" />
      Retrieving…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
      {message}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-10 text-center text-sm text-stone-300">Results will appear here</div>
  );
}

function OntologyTrace({ result }: { result: OntologyResponse }) {
  const [open, setOpen] = useState(true);
  const { ontologyContext, expandedQuery } = result;

  return (
    <div className="mb-4 rounded-lg border border-violet-100 bg-violet-50/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-violet-700 hover:bg-violet-50 transition-colors"
      >
        <span className="font-medium">
          {ontologyContext.nodesUsed} nodes matched · {ontologyContext.graphHops.length} hops
        </span>
        <span className="text-violet-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-violet-100 space-y-3">
          {ontologyContext.matchedEntities.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide mt-2 mb-1.5">
                Matched entities
              </p>
              <div className="flex flex-wrap gap-1">
                {ontologyContext.matchedEntities.map((e) => (
                  <span
                    key={e.label}
                    title={e.description}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700 cursor-default"
                  >
                    {e.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide mb-1.5">
              Expanded query
            </p>
            <p className="text-[11px] text-stone-600 leading-relaxed line-clamp-5">
              {expandedQuery}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsList({ results }: { results: SearchResult[] }) {
  if (!results || results.length === 0) {
    return <p className="text-sm text-stone-400 py-4">No results returned.</p>;
  }

  return (
    <div className="space-y-3">
      {results.map((r, i) => {
        // Handle both Phase 2 (doc_url, doc_title) and Phase 1 (url, title) field names
        const url = r.doc_url || r.url;
        const title = r.doc_title || r.title || "Untitled";
        const section = r.doc_section || r.section;

        return (
          <div
            key={r.id}
            className="rounded-lg border border-stone-100 bg-white p-4 hover:border-stone-200 transition-colors"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-stone-700 truncate">{title}</p>
                {section && (
                  <p className="text-[10px] text-stone-400 mt-0.5">{section}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ${
                    r.similarity > 0.5
                      ? "bg-emerald-50 text-emerald-700"
                      : r.similarity > 0.35
                      ? "bg-amber-50 text-amber-700"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {(r.similarity * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] text-stone-300">#{i + 1}</span>
              </div>
            </div>
            <p className="text-[11px] text-stone-500 leading-relaxed line-clamp-4">
              {r.content}
            </p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[10px] text-stone-400 hover:text-stone-600 truncate max-w-full"
              >
                {url}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
