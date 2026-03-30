import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { embedText } from '@/lib/embeddings';

export async function POST(request: NextRequest) {
  try {
    const { query, topK = 5, projectId, section } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const queryEmbedding = await embedText(query);

    // Fetch more than topK so we can deduplicate and still return topK unique sources
    let chunks: Record<string, unknown>[] | null = null;
    let searchError: { message: string } | null = null;

    if (projectId) {
      // Phase 2: project-scoped HNSW search
      const { data, error } = await supabase.rpc('search_chunks_v2', {
        p_project_id: projectId,
        query_embedding: queryEmbedding,
        match_count: topK * 4,
      });
      chunks = data;
      searchError = error;
    } else {
      // Phase 1 fallback: section-based search (for compare page backward compat)
      const { data, error } = await supabase.rpc('search_chunks', {
        query_embedding: queryEmbedding,
        match_count: topK * 4,
        filter_section: section || null,
      });
      chunks = data;
      searchError = error;
    }

    if (searchError) {
      console.error('Supabase search error:', searchError);
      return NextResponse.json({ error: searchError.message }, { status: 500 });
    }

    // Deduplicate: by URL first, then content fingerprint (first 120 chars)
    // search_chunks_v2 returns doc_url; search_chunks (v1) returns url
    const seenUrls = new Set<string>();
    const seenContent = new Set<string>();
    const deduped = (chunks || []).filter((c) => {
      const urlKey = (c.doc_url || c.url || c.id) as string;
      const contentKey = ((c.content as string) || '').slice(0, 120).trim();
      if (seenUrls.has(urlKey) || seenContent.has(contentKey)) return false;
      seenUrls.add(urlKey);
      seenContent.add(contentKey);
      return true;
    }).slice(0, topK);

    return NextResponse.json({
      query,
      results: deduped,
      model: 'gemini-embedding-001',
      type: 'vector',
    });
  } catch (err) {
    console.error('Vector search error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
