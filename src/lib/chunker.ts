/**
 * Text chunker — splits documents into overlapping chunks for embedding.
 * Uses character-based splitting (approximating tokens at ~4 chars/token).
 */

const CHUNK_SIZE = 500;   // target tokens per chunk
const CHUNK_OVERLAP = 50; // overlap tokens between chunks
const CHARS_PER_TOKEN = 4; // rough approximation

const CHUNK_SIZE_CHARS = CHUNK_SIZE * CHARS_PER_TOKEN;       // 2000 chars
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP * CHARS_PER_TOKEN; // 200 chars

export interface TextChunk {
  content: string;
  chunkIndex: number;
}

/**
 * Split text into overlapping chunks, breaking on sentence/paragraph boundaries.
 */
export function chunkText(text: string): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  // Normalise whitespace
  const normalised = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

  if (normalised.length <= CHUNK_SIZE_CHARS) {
    return [{ content: normalised, chunkIndex: 0 }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalised.length) {
    let end = start + CHUNK_SIZE_CHARS;

    if (end >= normalised.length) {
      // Last chunk — take everything remaining
      chunks.push({ content: normalised.slice(start).trim(), chunkIndex });
      break;
    }

    // Try to break at paragraph boundary first
    const paragraphBreak = normalised.lastIndexOf('\n\n', end);
    if (paragraphBreak > start + CHUNK_SIZE_CHARS * 0.5) {
      end = paragraphBreak;
    } else {
      // Try sentence boundary
      const sentenceBreak = normalised.lastIndexOf('. ', end);
      if (sentenceBreak > start + CHUNK_SIZE_CHARS * 0.5) {
        end = sentenceBreak + 1; // include the period
      } else {
        // Try word boundary
        const wordBreak = normalised.lastIndexOf(' ', end);
        if (wordBreak > start) {
          end = wordBreak;
        }
      }
    }

    const chunk = normalised.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({ content: chunk, chunkIndex });
      chunkIndex++;
    }

    // Move start forward, minus overlap
    start = end - CHUNK_OVERLAP_CHARS;
    if (start < 0) start = 0;
  }

  return chunks;
}
