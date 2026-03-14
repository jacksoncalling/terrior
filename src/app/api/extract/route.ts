import { NextRequest, NextResponse } from "next/server";
import { extractFromNarrative } from "@/lib/extract";
import { logSession } from "@/lib/supabase";
import type { GraphState } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, graphState, projectId } = body as {
      text: string;
      graphState: GraphState;
      projectId?: string;
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const result = await extractFromNarrative(text, graphState);

    // Log session fire-and-forget
    if (projectId) {
      const nodeCount = result.graphUpdates?.filter(
        (u: { type: string }) => u.type === 'node_created'
      ).length ?? 0;
      const relCount = result.graphUpdates?.filter(
        (u: { type: string }) => u.type === 'relationship_created'
      ).length ?? 0;

      logSession({
        project_id: projectId,
        type: 'extraction',
        agent: 'sonnet',
        summary: `Extracted ${nodeCount} entities and ${relCount} relationships from narrative`,
        raw_output: { graphUpdates: result.graphUpdates },
      }).catch(err => console.warn('Session logging failed (non-fatal):', err));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Extract API error:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
