/**
 * POST /api/classify
 *
 * Batch-classifies documents before extraction using Gemini 2.5 Flash.
 * Sends document titles + first ~2000 chars to Gemini in a single call.
 * Returns a classification verdict for each document:
 *   EXTRACT — high-value organisational intelligence
 *   CAUTION — marketing/aspirational content, extract selectively
 *   SKIP    — legal boilerplate, compliance noise, navigation artefacts
 *
 * Body: {
 *   documents: { index: number; title: string; content: string }[],
 *   projectBrief?: ProjectBrief,
 * }
 *
 * Returns: { classifications: DocumentClassification[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { classifyDocuments } from "@/lib/gemini";
import { logSession } from "@/lib/supabase";
import type { ProjectBrief } from "@/types";

const PREVIEW_LENGTH = 2000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      documents: { index: number; title: string; content: string }[];
      projectId?: string;
      projectBrief?: ProjectBrief;
    };

    const { documents, projectId, projectBrief } = body;

    if (!documents?.length) {
      return NextResponse.json(
        { error: "No documents provided" },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // Truncate content to preview length for classification
    const previews = documents.map((doc) => ({
      index:   doc.index,
      title:   doc.title,
      preview: doc.content.slice(0, PREVIEW_LENGTH),
    }));

    const classifications = await classifyDocuments(previews, projectBrief);

    // Log session (fire and forget)
    if (projectId) {
      const skipCount    = classifications.filter((c) => c.verdict === "SKIP").length;
      const extractCount = classifications.filter((c) => c.verdict === "EXTRACT").length;
      const cautionCount = classifications.filter((c) => c.verdict === "CAUTION").length;

      logSession({
        project_id: projectId,
        type:       "classification",
        agent:      "gemini",
        summary:    `Classified ${documents.length} documents: ${extractCount} extract, ${cautionCount} caution, ${skipCount} skip`,
        raw_output: { classifications },
      }).catch((err) => console.warn("[classify] Session log failed (non-fatal):", err));
    }

    return NextResponse.json({ classifications });
  } catch (err) {
    console.error("[classify] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
