/**
 * POST /api/meta-tensions
 *
 * Cross-graph fault line detection pass. Reads the hub topology and
 * surfaces 2–4 structural tensions that only become visible by holding
 * the full graph simultaneously — not any single document.
 *
 * Uses somatic vocabulary (contracted / blocked / pulled) as the
 * diagnostic frame. Returns TensionMarkers with scope: "cross-graph"
 * anchored to hub nodes.
 *
 * Body:    { projectId: string }
 * Returns: { metaTensions: TensionMarker[], updatedGraph: GraphState }
 */

export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { detectMetaTensions } from "@/lib/gemini";
import { buildTopologyPayload } from "@/lib/topology";
import { getProject, loadOntology, saveOntology, logSession } from "@/lib/supabase";
import type { ProjectBrief, TensionMarker } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = (await req.json()) as { projectId: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    // ── Load graph + project brief in parallel ────────────────────────────────
    const [graph, project] = await Promise.all([
      loadOntology(projectId),
      getProject(projectId),
    ]);

    const hubNodes = graph.nodes.filter((n) => n.is_hub === true);
    if (hubNodes.length === 0) {
      return NextResponse.json(
        { error: "No hub nodes found. Run extraction first." },
        { status: 400 }
      );
    }

    const brief = project?.metadata?.brief as ProjectBrief | undefined;
    const payload = buildTopologyPayload(graph, brief);

    console.log(
      `[meta-tensions] Starting fault line detection for project ${projectId}: ` +
        `${payload.hubs.length} hubs, ${payload.totalEntities} entities, ` +
        `${payload.emergentCount} emergent`
    );

    // ── Run Gemini meta-tension pass ──────────────────────────────────────────
    const metaTensions: TensionMarker[] = await detectMetaTensions(payload, hubNodes);

    // ── Remove any existing cross-graph tensions, replace with new results ────
    // Re-running the pass should give a fresh read, not accumulate duplicates.
    const localTensions = graph.tensions.filter((t) => (t.scope ?? "local") === "local");
    const updatedGraph = {
      ...graph,
      tensions: [...localTensions, ...metaTensions],
    };

    await saveOntology(projectId, updatedGraph);

    console.log(
      `[meta-tensions] Done: ${metaTensions.length} fault lines surfaced for project ${projectId}`
    );

    logSession({
      project_id: projectId,
      type: "synthesis",
      agent: "gemini",
      summary: `Meta-tension pass: ${metaTensions.length} cross-graph fault lines surfaced.`,
      raw_output: {
        faultLineCount: metaTensions.length,
        descriptions: metaTensions.map((t) => t.description.slice(0, 120)),
      },
    }).catch((err) => console.warn("[meta-tensions] Session log failed (non-fatal):", err));

    return NextResponse.json({ metaTensions, updatedGraph });
  } catch (err) {
    console.error("[meta-tensions] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
