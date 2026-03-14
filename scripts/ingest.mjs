/**
 * Babor Document Ingestion Script
 *
 * Reads scraped JSON files, chunks them, generates embeddings (locally),
 * and uploads everything to Supabase.
 *
 * Usage: node scripts/ingest.mjs
 * Requires: SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Load env vars from .env.local ---
function loadEnv() {
  const envPath = join(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) throw new Error('.env.local not found');
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    process.env[key.trim()] = valueParts.join('=').trim();
  }
}

// --- Chunker ---
const CHUNK_SIZE_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;

function chunkText(text) {
  if (!text || text.trim().length === 0) return [];
  const normalised = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (normalised.length <= CHUNK_SIZE_CHARS) return [{ content: normalised, chunkIndex: 0 }];

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalised.length) {
    let end = start + CHUNK_SIZE_CHARS;
    if (end >= normalised.length) {
      chunks.push({ content: normalised.slice(start).trim(), chunkIndex });
      break;
    }
    const paragraphBreak = normalised.lastIndexOf('\n\n', end);
    if (paragraphBreak > start + CHUNK_SIZE_CHARS * 0.5) {
      end = paragraphBreak;
    } else {
      const sentenceBreak = normalised.lastIndexOf('. ', end);
      if (sentenceBreak > start + CHUNK_SIZE_CHARS * 0.5) end = sentenceBreak + 1;
      else {
        const wordBreak = normalised.lastIndexOf(' ', end);
        if (wordBreak > start) end = wordBreak;
      }
    }
    const chunk = normalised.slice(start, end).trim();
    if (chunk.length > 0) { chunks.push({ content: chunk, chunkIndex }); chunkIndex++; }
    start = end - CHUNK_OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return chunks;
}

// --- Main ---
async function main() {
  console.log('=== Babor Document Ingestion ===\n');

  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.local');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load embedding model
  console.log('Loading embedding model (downloads ~23MB on first run)...');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  console.log('Model ready.\n');

  // Read scraped files — accepts optional data subdir + --project flag
  // Usage: node scripts/ingest.mjs                              → data/babor-raw (default)
  //        node scripts/ingest.mjs bc-raw                      → data/bc-raw
  //        node scripts/ingest.mjs babor-raw --project <uuid>  → scoped to project
  const args = process.argv.slice(2);
  const projectFlagIdx = args.indexOf('--project');
  const projectId = projectFlagIdx !== -1 ? args[projectFlagIdx + 1] ?? null : null;
  const dataSubdir = args.find(a => !a.startsWith('--') && a !== projectId) || 'babor-raw';

  if (projectId) {
    console.log(`Project scope: ${projectId}`);
  } else {
    console.log('No --project flag — documents will not be scoped to a project');
  }

  const dataDir = join(__dirname, '..', 'data', dataSubdir);
  console.log(`Data directory: ${dataDir}`);
  const files = readdirSync(dataDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log(`Found ${files.length} documents to ingest\n`);

  let totalChunks = 0;
  let totalDocs = 0;

  for (const filename of files) {
    const raw = JSON.parse(readFileSync(join(dataDir, filename), 'utf-8'));
    console.log(`[${totalDocs + 1}/${files.length}] ${raw.title || filename}`);

    // Skip very thin content
    if (!raw.content || raw.content.length < 200) {
      console.log('  Skipped (thin content)');
      continue;
    }

    // Upsert document
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .upsert({
        url: raw.url,
        title: raw.title || filename,
        section: raw.section || 'other',
        content: raw.content,
        ...(projectId ? { project_id: projectId } : {}),
      }, { onConflict: 'url' })
      .select('id')
      .single();

    if (docError) {
      console.error('  Document insert error:', docError.message);
      continue;
    }

    const documentId = doc.id;

    // Delete existing chunks for this document (fresh ingest)
    await supabase.from('document_chunks').delete().eq('document_id', documentId);

    // Chunk and embed
    const chunks = chunkText(raw.content);
    console.log(`  ${chunks.length} chunks`);

    const BATCH_SIZE = 8;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.content);

      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      // output.data is a flat Float32Array of length batch.length * 384
      const flat = output.data;
      const DIMS = 384;

      const rows = batch.map((chunk, j) => ({
        document_id: documentId,
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        embedding: Array.from(flat.slice(j * DIMS, (j + 1) * DIMS)),
        ...(projectId ? { project_id: projectId } : {}),
      }));

      const { error: chunkError } = await supabase.from('document_chunks').insert(rows);
      if (chunkError) {
        console.error('  Chunk insert error:', chunkError.message);
      }

      totalChunks += batch.length;
      process.stdout.write(`  Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks\r`);
    }

    console.log(`  ✓ Done (${chunks.length} chunks)`);
    totalDocs++;
  }

  console.log('\n=== Ingestion Complete ===');
  console.log(`Documents: ${totalDocs}`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log('\nNext: test vector search with scripts/test-search.mjs');
}

main().catch(console.error);
