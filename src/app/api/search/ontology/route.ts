import { NextRequest, NextResponse } from 'next/server';
import { supabase, loadOntology } from '@/lib/supabase';
import { buildOntologyContext } from '@/lib/ontology-retrieval';
import { embedText } from '@/lib/embeddings';
import type { GraphState } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      query: string;
      projectId?: string;
      graphState?: GraphState; // Phase 1 fallback (compare page)
      topK?: number;
      section?: string;
    };

    const { query, projectId, topK = 5, section } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    // Resolve graph: prefer projectId (authoritative Supabase), fall back to client-sent graphState
    let graphState: GraphState;
    if (projectId) {
      graphState = await loadOntology(projectId);
    } else if (body.graphState) {
      graphState = body.graphState;
    } else {
      return NextResponse.json(
        { error: 'projectId or graphState is required' },
        { status: 400 }
      );
    }

    // Step 1: Build ontology context from the graph
    const ontologyContext = buildOntologyContext(query, graphState);
    const { expandedQuery, matchedEntities, graphHops } = ontologyContext;

    // Step 2: Embed the expanded query
    const queryEmbedding = await embedText(expandedQuery);

    // Step 3: Search Supabase with the enriched embedding
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
      // Phase 1 fallback
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

    // Deduplicate: by URL first, then content fingerprint
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
      expandedQuery,
      results: deduped,
      ontologyContext: {
        matchedEntities: matchedEntities.map(e => ({
          label: e.node.label,
          type: e.node.type,
          description: e.node.description,
          matchScore: e.matchScore,
          matchReason: e.matchReason,
        })),
        graphHops,
        nodesUsed: matchedEntities.length,
        graphSize: graphState?.nodes?.length || 0,
      },
      model: 'gemini-embedding-001',
      type: 'ontology',
    });
  } catch (err) {
    console.error('Ontology search error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
