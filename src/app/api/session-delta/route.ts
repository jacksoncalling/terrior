/**
 * POST /api/session-delta
 *
 * Diffs the two most recent graph snapshots and generates a Sonnet narration
 * describing what changed since the last integration run.
 *
 * Narration is descriptive, not interpretive — the consultant interprets.
 * Sonnet is used (not Gemini) because interpretive prose belongs to the chat-side model.
 *
 * Body: { projectId: string }
 *
 * Returns:
 *   { narration: string }            — prose description of changes
 *   { error: "no_snapshots" }        — fewer than 2 snapshots exist
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getLatestTwoSnapshots } from "@/lib/supabase";
import { diffSnapshots } from "@/lib/evaluative";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NARRATION_SYSTEM_PROMPT = `You are an organisational intelligence assistant helping consultants understand changes in a knowledge graph between integration runs.

ROLE: Describe changes factually. Do NOT interpret, evaluate, or recommend. Do NOT say "this suggests", "this indicates", or "you should". The consultant interprets; you describe.

LANGUAGE: Match the language of the entity and signal labels. If they are German, respond in German. If English, respond in English.

FORMAT: 2–4 short paragraphs, plain prose. No bullet points, no headers, no markdown.`;

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json() as { projectId: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }

    const snapshots = await getLatestTwoSnapshots(projectId);

    if (snapshots.length < 2) {
      return NextResponse.json({ error: "no_snapshots" }, { status: 200 });
    }

    // Newest first — diff from older (index 1) to newer (index 0)
    const [newer, older] = snapshots;
    const diff = diffSnapshots(older.snapshot_json, newer.snapshot_json);

    // Build a compact diff summary for the prompt
    const diffLines: string[] = [];

    if (diff.nodesAdded.length > 0) {
      diffLines.push(`Entities added: ${diff.nodesAdded.join(", ")}`);
    }
    if (diff.nodesRemoved.length > 0) {
      diffLines.push(`Entities removed: ${diff.nodesRemoved.join(", ")}`);
    }
    if (diff.edgesAdded > 0 || diff.edgesRemoved > 0) {
      diffLines.push(
        `Relationships: +${diff.edgesAdded} added, -${diff.edgesRemoved} removed`
      );
    }
    if (diff.signalsAdded.length > 0) {
      diffLines.push(`New evaluative signals: ${diff.signalsAdded.join(", ")}`);
    }
    if (diff.tensionsAppeared.length > 0) {
      diffLines.push(`New tensions: ${diff.tensionsAppeared.join(" | ")}`);
    }
    if (diff.tensionsResolved.length > 0) {
      diffLines.push(`Resolved tensions: ${diff.tensionsResolved.join(" | ")}`);
    }
    const intensityNodeIds = Object.keys(diff.intensityChanges);
    if (intensityNodeIds.length > 0) {
      // Resolve node IDs to labels from the newer snapshot
      const nodeById = new Map(
        newer.snapshot_json.nodes.map((n) => [n.id, n.label])
      );
      const intensityLines = intensityNodeIds.map((id) => {
        const { before, after } = diff.intensityChanges[id];
        const label = nodeById.get(id) ?? id;
        const direction = after > before ? "↑" : "↓";
        return `${label} ${direction} (${before.toFixed(0)} → ${after.toFixed(0)})`;
      });
      diffLines.push(`Evaluative intensity shifts: ${intensityLines.join(", ")}`);
    }

    if (diffLines.length === 0) {
      return NextResponse.json({
        narration: "No meaningful changes were detected between the last two integration runs.",
      });
    }

    const userMessage = `The following changes occurred in the organisational knowledge graph between the last two integration runs:\n\n${diffLines.join("\n")}\n\nDescribe these changes in plain prose for the consultant.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: NARRATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const narration =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    return NextResponse.json({ narration });
  } catch (err) {
    console.error("[session-delta] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
