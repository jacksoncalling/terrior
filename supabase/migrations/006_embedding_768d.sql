-- Migration 006: Resize embedding vector column from 384d to 768d
--
-- Switching from local Transformers.js (paraphrase-multilingual-MiniLM-L12-v2, 384d)
-- to Gemini Embedding API (gemini-embedding-001, 768d).
--
-- Existing embeddings are incompatible — old chunks should be re-ingested.
-- Truncating document_chunks is safe; document text lives in the `documents` table.

-- Step 1: Wipe old 384d embeddings (incompatible with 768d model)
TRUNCATE document_chunks;

-- Step 2: Resize the vector column
ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(768);

-- Step 3: Drop existing functions (return type changed, CREATE OR REPLACE won't work)
DROP FUNCTION IF EXISTS search_chunks_v2(UUID, vector, INT);
DROP FUNCTION IF EXISTS search_chunks(vector, INT, TEXT);

-- Step 4: Recreate search_chunks_v2 RPC to accept 768d input
CREATE OR REPLACE FUNCTION search_chunks_v2(
  p_project_id UUID,
  query_embedding vector(768),
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT,
  doc_url TEXT,
  doc_title TEXT,
  doc_section TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.url   AS doc_url,
    d.title AS doc_title,
    d.section AS doc_section
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE dc.project_id = p_project_id
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 5: Recreate search_chunks (v1 fallback) to accept 768d input
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding vector(768),
  match_count INT DEFAULT 5,
  filter_section TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT,
  url TEXT,
  title TEXT,
  section TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.url,
    d.title,
    d.section
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE (filter_section IS NULL OR d.section = filter_section)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
