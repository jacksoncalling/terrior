-- Babor RAG Schema for Terrior
-- Run this in Supabase Dashboard → SQL Editor

-- Enable pgvector extension
create extension if not exists vector;

-- Documents table (one row per scraped page)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  url text unique not null,
  title text not null,
  section text not null default 'other',
  content text not null,
  created_at timestamptz default now()
);

-- Document chunks table (one row per chunk, with embedding)
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  content text not null,
  chunk_index integer not null,
  embedding vector(384),  -- all-MiniLM-L6-v2 produces 384 dimensions
  created_at timestamptz default now()
);

-- Index for fast vector similarity search
create index if not exists document_chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

-- Index for document lookups
create index if not exists document_chunks_document_id_idx
  on document_chunks(document_id);

-- Vector similarity search function
-- Returns top-k chunks most similar to a query embedding
create or replace function search_chunks(
  query_embedding vector(384),
  match_count int default 5,
  filter_section text default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  similarity float,
  doc_url text,
  doc_title text,
  doc_section text
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) as similarity,
    d.url as doc_url,
    d.title as doc_title,
    d.section as doc_section
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where
    dc.embedding is not null
    and (filter_section is null or d.section = filter_section)
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- Allow anon key to read/write (needed for ingest script)
alter table documents enable row level security;
alter table document_chunks enable row level security;

create policy "Allow all for anon" on documents for all using (true) with check (true);
create policy "Allow all for anon" on document_chunks for all using (true) with check (true);
