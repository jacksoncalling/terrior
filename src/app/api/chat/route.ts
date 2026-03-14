import { NextRequest, NextResponse } from "next/server";
import { runConversation } from "@/lib/claude";
import { logSession } from "@/lib/supabase";
import type { GraphState } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, graphState, projectId } = body as {
      messages: { role: "user" | "assistant"; content: string }[];
      graphState: GraphState;
      projectId?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured. Add it to .env.local" },
        { status: 500 }
      );
    }

    const result = await runConversation(messages, graphState);

    // Log session fire-and-forget (don't fail the request if logging fails)
    if (projectId) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      logSession({
        project_id: projectId,
        type: 'inquiry',
        agent: 'sonnet',
        summary: lastUserMessage
          ? lastUserMessage.content.slice(0, 200)
          : 'Chat session',
        raw_output: {
          graphUpdates: result.graphUpdates,
          nodeCount: result.updatedGraph?.nodes?.length,
        },
      }).catch(err => console.warn('Session logging failed (non-fatal):', err));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
