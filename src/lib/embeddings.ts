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
  const extractor = await getEmbedder();
  // output.data is a flat Float32Array of length 384 for a single text
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getEmbedder();
  const results: number[][] = [];
  const DIMS = EMBEDDING_DIMENSIONS;

  // Process in smaller batches to avoid memory issues
  const BATCH_SIZE = 8;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    // output.data is a flat Float32Array of length batch.length * DIMS
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const flat = output.data as Float32Array;
    for (let j = 0; j < batch.length; j++) {
      results.push(Array.from(flat.slice(j * DIMS, (j + 1) * DIMS)));
    }
  }

  return results;
}

export const EMBEDDING_DIMENSIONS = 384;
