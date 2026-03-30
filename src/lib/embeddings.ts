/**
 * Embedding generation using Gemini Embedding API.
 *
 * Model: gemini-embedding-001 — 768 dimensions (recommended sweet spot).
 * Replaces local @xenova/transformers which broke on Vercel (missing ONNX runtime).
 * Gemini is already in the stack (extraction + classification), so no new vendor.
 *
 * Free tier: 1,000 requests/day. Batch endpoint accepts up to 100 texts per call.
 */

const GEMINI_EMBED_MODEL = "models/gemini-embedding-001";
const GEMINI_EMBED_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001";

export const EMBEDDING_DIMENSIONS = 768;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("[embeddings] GEMINI_API_KEY is not set");
  return key;
}

// ─── Single text ──────────────────────────────────────────────────────────────

/**
 * Generate an embedding for a single text string.
 * Returns a 768-dimensional float array.
 */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${GEMINI_EMBED_BASE}:embedContent?key=${getApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_EMBED_MODEL,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[embeddings] Gemini embedContent failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.embedding.values as number[];
}

// ─── Batch ────────────────────────────────────────────────────────────────────

/** Safe batch size — Gemini allows 100, we stay conservative. */
const BATCH_SIZE = 50;

/**
 * Generate embeddings for multiple texts in batch.
 * Splits into chunks of BATCH_SIZE and calls batchEmbedContents for each.
 * Returns one 768-dim array per input text.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = getApiKey();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(`${GEMINI_EMBED_BASE}:batchEmbedContents?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: GEMINI_EMBED_MODEL,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[embeddings] Gemini batchEmbedContents failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    for (const embedding of data.embeddings) {
      results.push(embedding.values as number[]);
    }
  }

  return results;
}
