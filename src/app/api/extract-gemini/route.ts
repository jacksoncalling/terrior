/**
 * POST /api/extract-gemini
 *
 * Extracts an ontology from a block of text using Gemini 2.5 Flash.
 * Used for bulk document extraction (PDFs, DOCX, large corpora).
 *
 * Counterpart to /api/extract (Claude Sonnet) — same input/output shape,
 * so the Sources UI can call either depending on document size/preference.
 *
 * Body: { text: string, graphState: GraphState, projectId: string }
 * Returns: { updatedGraph: GraphState, graphUpdates: GraphUpdate[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { extractOntologyWithGemini } from "@/lib/gemini";
import { logSession } from "@/lib/supabase";
import type { GraphState } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      text: string;
      graphState: GraphState;
      projectId?: string;
    };

    const { text, graphState, projectId } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    if (!graphState) {
      return NextResponse.json({ error: "No graphState provided" }, { status: 400 });
    }

    // ── Run Gemini extraction ─────────────────────────────────────────────────
    const { updatedGraph, graphUpdates } = await extractOntologyWithGemini(text, graphState);

    // ── Log session (fire and forget) ─────────────────────────────────────────
    if (projectId) {
      logSession({
        project_id: projectId,
        type:       "extraction",
        agent:      "gemini",
        summary:    `Extracted ${graphUpdates.filter(u => u.type === "node_created").length} entities, ${graphUpdates.filter(u => u.type === "relationship_created").length} relationships`,
      }).catch((err) => console.warn("Session log failed (non-fatal):", err));
    }

    return NextResponse.json({ updatedGraph, graphUpdates });
  } catch (err) {
    console.error("extract-gemini error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
