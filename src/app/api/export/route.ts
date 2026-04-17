/**
 * GET /api/export?projectId=<uuid>
 *
 * Public read endpoint — returns the full Terroir project bundle as JSON.
 * Any agent (Mistral, Claude Code, Cursor, curl) can call this with a single
 * HTTP request. No local server required, always reflects current Supabase state.
 *
 * Auth: projectId in the query string is the access gate (URL-param sharing
 * pattern, consistent with how Terroir shares projects at demo phase).
 *
 * CORS: open (*) so cross-origin agents need no preflight configuration.
 *
 * Bundle shape: same as the manual JSON export — schema_version 1.1, meta
 * block, ontology (nodes/relationships/tensions/signals), stats. synthesisResult
 * is null (synthesis is localStorage-only, not persisted to Supabase).
 */

import { NextRequest, NextResponse } from "next/server";
import { getProject, loadOntology } from "@/lib/supabase";
import { buildProjectBundle } from "@/lib/export";
import type { ProjectBrief } from "@/types";

export const maxDuration = 60;

// CORS headers — applied to both the GET response and the OPTIONS preflight.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle preflight requests from browser-based agents.
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "projectId query parameter is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Load project metadata + full graph state in parallel.
    const [project, graphState] = await Promise.all([
      getProject(projectId),
      loadOntology(projectId),
    ]);

    if (!project) {
      return NextResponse.json(
        { ok: false, error: `Project not found: ${projectId}` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const projectBrief =
      (project.metadata?.brief as ProjectBrief | null) ?? null;
    const attractorPreset =
      (project.metadata?.attractorPreset as string | null) ?? null;

    const bundle = buildProjectBundle({
      projectName: project.name,
      graphState,
      projectBrief,
      synthesisResult: null, // synthesis is localStorage-only, not in Supabase
      attractorPreset,
    });

    return NextResponse.json(
      { ok: true, bundle },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
