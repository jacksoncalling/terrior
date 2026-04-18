/**
 * POST /api/scoping
 *
 * Drives the Haiku scoping dialogue. Called on every exchange in the
 * 4-5 question sequence that produces a ProjectBrief.
 *
 * Body: {
 *   messages:       ConversationMessage[],  // full history including latest user msg
 *   projectId:      string,
 *   projectContext?: { name?: string; sector?: string }  // hints from project record
 * }
 *
 * Returns: {
 *   response: string,          // Haiku's reply (may contain <brief> block)
 *   brief?:   ProjectBrief,    // present when Haiku signals the brief is complete
 * }
 *
 * When a brief is returned, the caller should save it via:
 *   PATCH /api/projects/:id  or  updateProjectMetadata(id, { brief })
 */

import { NextRequest, NextResponse } from "next/server";
import { runScopingDialogue } from "@/lib/haiku";
import { logSession } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      projectId: string;
      projectContext?: { name?: string; sector?: string };
      locale?: "en" | "de";
    };

    const { messages, projectId, projectContext, locale } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // ── Run Haiku scoping exchange ────────────────────────────────────────────
    const result = await runScopingDialogue(messages, projectContext, locale ?? "en");

    // ── Log session (fire and forget) ─────────────────────────────────────────
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    logSession({
      project_id: projectId,
      type:        "inquiry",
      agent:       "haiku",
      summary:     result.brief
        ? `Scoping complete — brief generated (layer: ${result.brief.abstractionLayer})`
        : `Scoping exchange: ${lastUserMsg?.content?.slice(0, 100) ?? "..."}`,
      raw_output: result.brief ? { brief: result.brief } : undefined,
    }).catch((err) => console.warn("[scoping] Session log failed (non-fatal):", err));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[scoping] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
