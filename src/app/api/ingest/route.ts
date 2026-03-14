/**
 * POST /api/ingest
 *
 * Accepts a file upload (multipart/form-data) and:
 *  1. Parses the file (PDF, DOCX, TXT, MD, JSON) → plain text
 *  2. Chunks the text
 *  3. Generates local embeddings (Transformers.js)
 *  4. Saves document + chunks to Supabase (scoped to projectId)
 *
 * Returns: { documentId, chunkCount, title }
 *
 * This feeds the vector store so Compare / Search works on uploaded docs.
 * For ontology extraction from the doc, call /api/extract-gemini separately.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseDocument } from "@/lib/document-parser";
import { chunkText } from "@/lib/chunker";
import { embedBatch } from "@/lib/embeddings";
import { supabase } from "@/lib/supabase";

export const config = {
  api: { bodyParser: false },
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file      = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;

    if (!file)      return NextResponse.json({ error: "No file provided" },      { status: 400 });
    if (!projectId) return NextResponse.json({ error: "No projectId provided" }, { status: 400 });

    // ── Parse ───────────────────────────────────────────────────────────────
    const buffer   = Buffer.from(await file.arrayBuffer());
    const parsed   = await parseDocument(buffer, file.name, file.type);

    if (parsed.isEmpty) {
      return NextResponse.json(
        {
          error:
            "No usable text found in this file. If it's a PDF, it may be scanned/image-based. " +
            "Try copy-pasting the text instead.",
        },
        { status: 422 }
      );
    }

    // ── Chunk ────────────────────────────────────────────────────────────────
    const chunks = chunkText(parsed.content);

    // ── Save document ────────────────────────────────────────────────────────
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .upsert(
        {
          url:        `upload://${projectId}/${encodeURIComponent(file.name)}`,
          title:      parsed.title,
          section:    "upload",
          content:    parsed.content,
          project_id: projectId,
        },
        { onConflict: "url" }
      )
      .select("id")
      .single();

    if (docError) {
      console.error("Document upsert error:", docError);
      return NextResponse.json({ error: docError.message }, { status: 500 });
    }

    const documentId = doc.id;

    // Delete stale chunks for this document (fresh ingest)
    await supabase.from("document_chunks").delete().eq("document_id", documentId);

    // ── Embed + save chunks ──────────────────────────────────────────────────
    const texts      = chunks.map((c) => c.content);
    const embeddings = await embedBatch(texts);

    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      project_id:  projectId,
      content:     chunk.content,
      chunk_index: chunk.chunkIndex,
      embedding:   embeddings[i],
    }));

    const { error: chunkError } = await supabase.from("document_chunks").insert(rows);
    if (chunkError) {
      console.error("Chunk insert error:", chunkError);
      return NextResponse.json({ error: chunkError.message }, { status: 500 });
    }

    return NextResponse.json({
      documentId,
      chunkCount: chunks.length,
      title:      parsed.title,
    });
  } catch (err) {
    console.error("Ingest route error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
