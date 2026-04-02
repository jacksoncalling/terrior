/**
 * POST /api/topology-signals
 *
 * Topology-aware signal enrichment pass — Phase 3 of the evaluative layer.
 * Runs after the graph is stable (post-integration). One Gemini call that:
 *
 *   1. Builds a compact topology payload (hub density, cross-hub connections,
 *      tension clusters, emergent count) from the current graph
 *   2. Returns enriched signal labels with reachability framing
 *   3. Returns an optimisation hypothesis — what the org structurally appears
 *      to be optimising for, derived from the graph pattern rather than
 *      document-stated values
 *
 * Triggered manually from the Reflect tab (like Synthesis). Enriched signals
 * are persisted via saveOntology; hypothesis stored in project.metadata.
 *
 * Body:    { projectId: string }
 * Returns: { updatedSignals: EvaluativeSignal[], optimizationHypothesis: string }
 */

export const maxDuration = 120; // single Gemini call — 2 min is ample

import { NextRequest, NextResponse } from "next/server";
import { enrichSignalsWithTopology } from "@/lib/gemini";
import { buildTopologyPayload } from "@/lib/topology";
import {
  getProject,
  loadOntology,
  saveOntology,
  updateProjectMetadata,
  logSession,
} from "@/lib/supabase";
import type { ProjectBrief } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json() as { projectId: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    // ── Load graph + project in parallel ─────────────────────────────────────
    const [graph, project] = await Promise.all([
      loadOntology(projectId),
      getProject(projectId),
    ]);

    if (graph.evaluativeSignals.length === 0) {
      return NextResponse.json(
        { error: "No evaluative signals found. Extract documents first." },
        { status: 400 }
      );
    }

    const brief = project?.metadata?.brief as ProjectBrief | undefined;

    // ── Build compact topology payload ────────────────────────────────────────
    const payload = buildTopologyPayload(graph, brief);

    console.log(
      `[topology-signals] Starting enrichment for project ${projectId}: ` +
      `${payload.signals.length} signals, ${payload.totalEntities} entities, ` +
      `${payload.hubs.length} hubs, ${payload.emergentCount} emergent`
    );

    // ── Run Gemini topology enrichment ────────────────────────────────────────
    const { enrichedSignals, optimizationHypothesis } = await enrichSignalsWithTopology(payload);

    // ── Merge enriched labels back into existing signals ──────────────────────
    // Only label + direction are updated. All reflect scores, sourceDescription,
    // and timestamps are preserved from the original signal.
    const enrichedById: Record<string, { label: string; direction: "toward" | "away_from" | "protecting" }> = {};
    for (const e of enrichedSignals) {
      enrichedById[e.id] = { label: e.label, direction: e.direction };
    }

    const updatedSignals = graph.evaluativeSignals.map((s) => {
      const enrichment = enrichedById[s.id];
      if (!enrichment) return s;
      return { ...s, label: enrichment.label, direction: enrichment.direction };
    });

    // ── Persist via saveOntology + updateProjectMetadata ──────────────────────
    await Promise.all([
      saveOntology(projectId, { ...graph, evaluativeSignals: updatedSignals }),
      updateProjectMetadata(projectId, { optimizationHypothesis }),
    ]);

    console.log(
      `[topology-signals] Done: ${enrichedSignals.length} signals enriched. ` +
      `Hypothesis: "${optimizationHypothesis.slice(0, 80)}…"`
    );

    // ── Log session (fire and forget) ─────────────────────────────────────────
    logSession({
      project_id: projectId,
      type:       "synthesis",
      agent:      "gemini",
      summary:    `Topology enrichment: ${enrichedSignals.length} signals enriched, optimisation hypothesis generated.`,
      raw_output: {
        signalCount:            updatedSignals.length,
        enrichedCount:          enrichedSignals.length,
        optimizationHypothesis: optimizationHypothesis.slice(0, 200),
      },
    }).catch((err) => console.warn("[topology-signals] Session log failed (non-fatal):", err));

    return NextResponse.json({ updatedSignals, optimizationHypothesis });
  } catch (err) {
    console.error("[topology-signals] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
