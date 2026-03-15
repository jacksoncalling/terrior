/**
 * Document parser for TERROIR
 *
 * Parses uploaded files into plain text for extraction.
 * Supported: PDF, DOCX, TXT, MD, JSON (GraphState or platform exports)
 */

export interface ParsedDocument {
  title: string;
  content: string;
  /** true if no usable text was extracted (e.g. scanned PDF) */
  isEmpty: boolean;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  // Dynamic import — pdf-parse is CJS; .default may or may not be present depending on bundler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("pdf-parse") as any;
  const pdfParse = (mod.default ?? mod) as (buf: Buffer) => Promise<{ text: string }>;

  try {
    const result = await pdfParse(buffer);
    const content = result.text?.trim() ?? "";

    return {
      title: filename.replace(/\.pdf$/i, ""),
      content,
      isEmpty: content.length < 100, // likely a scanned/image-only PDF
    };
  } catch (err) {
    console.error("PDF parse error:", err);
    return { title: filename, content: "", isEmpty: true };
  }
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

async function parseDocx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");

  try {
    const result = await mammoth.extractRawText({ buffer });
    const content = result.value?.trim() ?? "";

    return {
      title: filename.replace(/\.docx$/i, ""),
      content,
      isEmpty: content.length < 100,
    };
  } catch (err) {
    console.error("DOCX parse error:", err);
    return { title: filename, content: "", isEmpty: true };
  }
}

// ── Plain text / Markdown ─────────────────────────────────────────────────────

function parseText(buffer: Buffer, filename: string): ParsedDocument {
  const content = buffer.toString("utf-8").trim();
  return {
    title: filename.replace(/\.(txt|md)$/i, ""),
    content,
    isEmpty: content.length < 50,
  };
}

// ── JSON (GraphState export or platform export) ───────────────────────────────
// If it looks like a GraphState, we summarise it as text so Gemini can re-extract.
// If it's a raw platform export (Notion, Confluence), we stringify it.

function parseJson(buffer: Buffer, filename: string): ParsedDocument {
  try {
    const parsed = JSON.parse(buffer.toString("utf-8"));

    // Check if it's a TERROIR GraphState export
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.relationships)) {
      const nodeLines = parsed.nodes.map(
        (n: { label: string; type: string; description?: string }) =>
          `- ${n.label} (${n.type})${n.description ? ": " + n.description : ""}`
      );
      const relLines = parsed.relationships.map(
        (r: { sourceId?: string; targetId?: string; type: string; source_label?: string; target_label?: string }) => {
          const src = r.source_label || r.sourceId || "";
          const tgt = r.target_label || r.targetId || "";
          return `- ${src} --[${r.type}]--> ${tgt}`;
        }
      );
      const content = `Entities:\n${nodeLines.join("\n")}\n\nRelationships:\n${relLines.join("\n")}`;
      return { title: filename.replace(/\.json$/i, ""), content, isEmpty: nodeLines.length === 0 };
    }

    // Generic JSON — flatten to readable text
    const content = JSON.stringify(parsed, null, 2);
    return { title: filename.replace(/\.json$/i, ""), content, isEmpty: false };
  } catch {
    return { title: filename, content: "", isEmpty: true };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<ParsedDocument> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType?.toLowerCase() ?? "";

  if (mime.includes("pdf") || ext === "pdf") {
    return parsePdf(buffer, filename);
  }

  if (
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return parseDocx(buffer, filename);
  }

  if (mime.includes("json") || ext === "json") {
    return parseJson(buffer, filename);
  }

  // TXT, MD, or anything else — treat as plain text
  return parseText(buffer, filename);
}
