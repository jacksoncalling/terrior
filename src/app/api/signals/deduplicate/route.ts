import { NextResponse } from "next/server";
import type { EvaluativeSignal, ProjectBrief } from "@/types";
import { deduplicateSignals } from "@/lib/gemini";
import { executeSignalMerges } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body: {
      projectId:    string;
      signals:      EvaluativeSignal[];
      projectBrief?: ProjectBrief;
    } = await req.json();

    const { projectId, signals, projectBrief } = body;

    if (!projectId || !signals?.length) {
      return NextResponse.json({ error: "projectId and signals are required" }, { status: 400 });
    }

    const originalCount = signals.length;

    // Ask Gemini which signals are near-duplicates
    const mergeGroups = await deduplicateSignals(signals, projectBrief);

    if (mergeGroups.length === 0) {
      return NextResponse.json({
        updatedSignals: signals,
        clusterCount:   0,
        originalCount,
        mergedCount:    0,
      });
    }

    // Apply merges to Supabase + get updated signal list
    const updatedSignals = await executeSignalMerges(projectId, mergeGroups, signals);

    const mergedCount = originalCount - updatedSignals.length;

    return NextResponse.json({
      updatedSignals,
      clusterCount:  mergeGroups.length,
      originalCount,
      mergedCount,
    });
  } catch (err) {
    console.error("[/api/signals/deduplicate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Deduplication failed" },
      { status: 500 }
    );
  }
}
