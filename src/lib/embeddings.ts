/**
 * Embedding generation using @xenova/transformers (runs locally, no API cost).
 * Model: paraphrase-multilingual-MiniLM-L12-v2 — 384 dimensions, ~120MB download on first use.
 * Multilingual (50+ languages including German/English), direct replacement for all-MiniLM-L6-v2.
 */

// Dynamically import to avoid issues with Next.js bundler
let pipeline: ((task: string, model: string) => Promise<(texts: string | string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array[] }>>) | null = null;
let embedder: ((texts: string | string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array[] }>) | null = null;

async function getEmbedder() {
  if (embedder) return embedder;

  // @xenova/transformers requires native ONNX runtime binaries that are not
  // available in Vercel's serverless environment. Dynamic import + try/catch
  // lets the ingest route continue without embeddings when running on Vercel.
  // Vector search (Compare page) will be unavailable, but Gemini extraction works fine.
  const { pipeline: createPipeline } = await import('@xenova/transformers');
  pipeline = createPipeline as typeof pipeline;
  embedder = await pipeline!('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  return embedder;
}

/**
 * Generate embeddings for a single text string.
 * Returns a 384-dimensional float array.
 */
export async function embedText(text: string): Promise<number[]> {
  try {
    const extractor = await getEmbedder();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as unknown as Float32Array);
  } catch (err) {
    console.warn('[embeddings] embedText unavailable (ONNX runtime missing — Vercel serverless):', err);
    return [];
  }
}

/**
 * Generate embeddings for multiple texts in batch.
 * Returns empty arrays per text if ONNX runtime is unavailable (e.g. Vercel).
 * The ingest route skips chunk storage when embeddings are empty.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  try {
    const extractor = await getEmbedder();
    const results: number[][] = [];
    const DIMS = EMBEDDING_DIMENSIONS;

    const BATCH_SIZE = 8;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      const flat = output.data as unknown as Float32Array;
      for (let j = 0; j < batch.length; j++) {
        results.push(Array.from(flat.slice(j * DIMS, (j + 1) * DIMS)));
      }
    }
    return results;
  } catch (err) {
    console.warn('[embeddings] embedBatch unavailable (ONNX runtime missing — Vercel serverless):', err);
    // Return empty array per text — caller checks length before inserting chunks
    return texts.map(() => []);
  }
}

export const EMBEDDING_DIMENSIONS = 384;
