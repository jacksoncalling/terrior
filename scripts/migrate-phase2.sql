-- ============================================================
-- Terroir Phase 2 — Schema Migration
-- Run in Supabase Dashboard → SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS / OR REPLACE)
-- ============================================================

-- ── Step 1: Fix the broken search index (run this first) ────
-- Drop the IVFFlat index that fails with real query embeddings.
-- IVFFlat with lists=10 only probes 1 cluster — real queries get 0 results.
-- HNSW has no stale centroids and handles inserts without rebuilding.

DROP INDEX IF EXISTS document_chunks_embedding_idx;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Step 2: New tables ───────────────────────────────────────

-- Projects: the core isolation primitive
CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  sector          text,
  description     text,
  embedding_model text NOT NULL DEFAULT 'paraphrase-multilingual-MiniLM-L12-v2',
  phase           text NOT NULL DEFAULT 'preparation'
                  CHECK (phase IN ('preparation', 'workshop', 'synthesis', 'validation', 'live')),
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Ontology nodes: server-persisted, no more localStorage
CREATE TABLE IF NOT EXISTS ontology_nodes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id          text NOT NULL,          -- client-side ID from GraphNode (e.g. "node_1")
  label            text NOT NULL,
  type             text NOT NULL,
  description      text,
  position_x       float DEFAULT 0,
  position_y       float DEFAULT 0,
  properties       jsonb DEFAULT '{}',
  source_type      text DEFAULT 'manual'
                   CHECK (source_type IN ('haiku', 'gemini', 'sonnet', 'manual', 'synthesis')),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, node_id)
);

-- Ontology relationships
CREATE TABLE IF NOT EXISTS ontology_relationships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_id           text NOT NULL,           -- client-side ID (e.g. "rel_1")
  source_node_id   text NOT NULL,           -- references ontology_nodes.node_id
  target_node_id   text NOT NULL,
  type             text NOT NULL,
  description      text,
  source_type      text DEFAULT 'manual'
                   CHECK (source_type IN ('haiku', 'gemini', 'sonnet', 'manual', 'synthesis')),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, rel_id)
);

-- Tension markers
CREATE TABLE IF NOT EXISTS tension_markers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tension_id       text NOT NULL,
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'unresolved'
                   CHECK (status IN ('unresolved', 'resolved')),
  related_node_ids text[],                  -- array of node_id strings
  created_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, tension_id)
);

-- Evaluative signals
CREATE TABLE IF NOT EXISTS evaluative_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signal_id        text NOT NULL,
  label            text NOT NULL,
  direction        text NOT NULL
                   CHECK (direction IN ('toward', 'away_from', 'protecting')),
  strength         integer NOT NULL DEFAULT 3
                   CHECK (strength BETWEEN 1 AND 5),
  source_description text,
  evidence         text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, signal_id)
);

-- Entity type configs per project
CREATE TABLE IF NOT EXISTS entity_type_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type_id          text NOT NULL,
  label            text NOT NULL,
  color            text NOT NULL DEFAULT '#6b7280',
  created_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, type_id)
);

-- Sessions: every agent interaction logged
CREATE TABLE IF NOT EXISTS sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type             text NOT NULL
                   CHECK (type IN ('inquiry', 'extraction', 'synthesis', 'validation')),
  agent            text NOT NULL
                   CHECK (agent IN ('haiku', 'gemini', 'sonnet', 'opus', 'manual')),
  summary          text,
  raw_output       jsonb,
  created_at       timestamptz DEFAULT now()
);

-- ── Step 3: Add project_id to existing tables ────────────────

-- Nullable first (existing rows have no project yet)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);

-- ── Step 4: New project-scoped search function ───────────────

CREATE OR REPLACE FUNCTION search_chunks_v2(
  p_project_id    uuid,
  query_embedding vector(384),
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  document_id uuid,
  content     text,
  chunk_index integer,
  similarity  float,
  doc_url     text,
  doc_title   text,
  doc_section text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.url   AS doc_url,
    d.title AS doc_title,
    d.section AS doc_section
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE
    dc.embedding IS NOT NULL
    AND dc.project_id = p_project_id
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Step 5: RLS for new tables ────────────────────────────────

ALTER TABLE projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_nodes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tension_markers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluative_signals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_type_configs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (same pattern as Phase 1)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON projects FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ontology_nodes' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON ontology_nodes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ontology_relationships' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON ontology_relationships FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tension_markers' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON tension_markers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evaluative_signals' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON evaluative_signals FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'entity_type_configs' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON entity_type_configs FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'Allow all for anon') THEN
    CREATE POLICY "Allow all for anon" ON sessions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Done ─────────────────────────────────────────────────────
-- After running this, run: node scripts/migrate-data.mjs
-- That creates the two projects (Babor, Bikes) and backfills project_id.
