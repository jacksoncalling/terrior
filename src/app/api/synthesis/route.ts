/**
 * POST /api/synthesis
 *
 * Runs cross-source synthesis across all documents for a project.
 * Fetches document content and project brief server-side, then passes
 * everything to Haiku for a single-turn analytical read.
 *
 * Body: {
 *   projectId:  string,
 *   graphState: GraphState,   // current in-memory graph from the client
 * }
 *
 * Returns: SynthesisResult — structured JSON with:
 *   - narrativeSummary
 *   - termCollisions
 *   - connectingThreads
 *   - signalConvergence
 *   - graphGaps
 *   - documentCount
 *   - generatedAt
 *
 * Documents and project brief are fetched server-side to keep the request
 * body small and avoid sending large content payloads from the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { runSynthesis } from "@/lib/haiku";
import { getProject, getProjectDocuments, logSession } from "@/lib/supabase";
import type { GraphState, ProjectBrief } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      projectId: string;
      graphState: GraphState;
    };

    const { projectId, graphState } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    if (!graphState) {
      return NextResponse.json(
        { error: "graphState is required" },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // ── Fetch documents and project brief server-side ─────────────────────────
    const [documents, project] = await Promise.all([
      getProjectDocuments(projectId),
      getProject(projectId),
    ]);

    if (documents.length === 0) {
      return NextResponse.json(
        { error: "No documents found for this project. Upload transcripts first." },
        { status: 400 }
      );
    }

    // Extract brief from project metadata (stored under metadata.brief)
    const brief = project?.metadata?.brief as ProjectBrief | undefined;

    // ── Run Haiku synthesis ───────────────────────────────────────────────────
    const result = await runSynthesis(graphState, documents, brief);

    // ── Log session (fire and forget) ─────────────────────────────────────────
    logSession({
      project_id: projectId,
      type:       "synthesis",
      agent:      "haiku",
      summary:    `Synthesis across ${documents.length} documents — ${result.termCollisions.length} collisions, ${result.connectingThreads.length} threads, ${result.graphGaps.length} gaps`,
      raw_output: {
        documentCount:    result.documentCount,
        termCollisions:   result.termCollisions.length,
        connectingThreads: result.connectingThreads.length,
        signalConvergence: result.signalConvergence.length,
        graphGaps:        result.graphGaps.length,
      },
    }).catch((err) => console.warn("[synthesis] Session log failed (non-fatal):", err));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[synthesis] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
