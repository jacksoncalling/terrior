import { createClient } from '@supabase/supabase-js';
import type {
  Project,
  ProjectPhase,
  GraphState,
  GraphNode,
  Relationship,
  TensionMarker,
  EvaluativeSignal,
  EntityTypeConfig,
} from '@/types';

// NEXT_PUBLIC_ prefix makes these available in both server and client bundles.
// Fallback to unprefixed versions for scripts/API routes that set them directly.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Legacy types (Phase 1 compatibility) ────────────────────────────────────

export type Document = {
  id: string;
  url: string;
  title: string;
  section: string;
  content: string;
  project_id: string | null;
  created_at: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  embedding: number[];
  project_id: string | null;
};

// ── Search result type ───────────────────────────────────────────────────────

export type SearchResult = {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  similarity: number;
  doc_url: string;
  doc_title: string;
  doc_section: string;
};

// ── Project CRUD ─────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getProjects: ${error.message}`);
  return data ?? [];
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`getProject: ${error.message}`);
  }
  return data;
}

export async function createProject(input: {
  name: string;
  sector?: string;
  description?: string;
  embedding_model?: string;
  phase?: ProjectPhase;
  metadata?: Record<string, unknown>;
}): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      sector: input.sector ?? null,
      description: input.description ?? null,
      embedding_model: input.embedding_model ?? 'paraphrase-multilingual-MiniLM-L12-v2',
      phase: input.phase ?? 'preparation',
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (error) throw new Error(`createProject: ${error.message}`);
  return data;
}

export async function updateProjectPhase(id: string, phase: ProjectPhase): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ phase, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`updateProjectPhase: ${error.message}`);
}

/**
 * Deep-merges a metadata patch into the project's existing metadata jsonb.
 * Used to store the ProjectBrief under projects.metadata.brief without
 * overwriting other metadata keys.
 *
 * Read → merge → write (two round trips, but keeps all existing fields safe).
 */
export async function updateProjectMetadata(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  // Read current metadata first so we can merge rather than replace
  const { data: current, error: readError } = await supabase
    .from('projects')
    .select('metadata')
    .eq('id', id)
    .single();

  if (readError) throw new Error(`updateProjectMetadata (read): ${readError.message}`);

  const merged = { ...(current?.metadata ?? {}), ...patch };

  const { error } = await supabase
    .from('projects')
    .update({ metadata: merged, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`updateProjectMetadata (write): ${error.message}`);
}

/**
 * Returns the number of documents for a project without fetching content.
 * Used by the Inspector to decide whether "Re-process sources" is available.
 */
export async function countProjectDocuments(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (error) throw new Error(`countProjectDocuments: ${error.message}`);
  return count ?? 0;
}

/**
 * Fetches all documents for a project, ordered by creation date.
 * Used by the synthesis route to load full document content into Haiku's
 * context window and by the reprocess route to rebuild the graph.
 */
export async function getProjectDocuments(
  projectId: string
): Promise<{ id: string; title: string; content: string }[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getProjectDocuments: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title ?? 'Untitled',
    content: row.content ?? '',
  }));
}

/**
 * Deletes all ontology data for a project across all five tables.
 * Used by the reprocess route before rebuilding the graph from scratch.
 */
export async function clearOntology(projectId: string): Promise<void> {
  const tables = [
    'ontology_nodes',
    'ontology_relationships',
    'tension_markers',
    'evaluative_signals',
    'entity_type_configs',
  ] as const;

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('project_id', projectId);

    if (error) throw new Error(`clearOntology (${table}): ${error.message}`);
  }
}

/**
 * Deletes all documents and their chunks for a project.
 * Used by the full reset flow to prevent duplicate documents on re-upload.
 * Chunks deleted first (FK dependency on document_id).
 */
export async function clearDocuments(projectId: string): Promise<void> {
  const { error: chunkError } = await supabase
    .from('document_chunks')
    .delete()
    .eq('project_id', projectId);

  if (chunkError) throw new Error(`clearDocuments (chunks): ${chunkError.message}`);

  const { error: docError } = await supabase
    .from('documents')
    .delete()
    .eq('project_id', projectId);

  if (docError) throw new Error(`clearDocuments (documents): ${docError.message}`);
}

// ── Ontology load / save ─────────────────────────────────────────────────────
//
// loadOntology: fetches all 5 ontology tables for a project in parallel and
//               maps DB rows → TypeScript interfaces (GraphState).
//
// saveOntology: upserts the full GraphState, then deletes any rows that are no
//               longer present in the state (by comparing IDs).

export async function loadOntology(projectId: string): Promise<GraphState> {
  const [nodesRes, relsRes, tensionsRes, signalsRes, entityTypesRes] = await Promise.all([
    supabase.from('ontology_nodes').select('*').eq('project_id', projectId),
    supabase.from('ontology_relationships').select('*').eq('project_id', projectId),
    supabase.from('tension_markers').select('*').eq('project_id', projectId),
    supabase.from('evaluative_signals').select('*').eq('project_id', projectId),
    supabase.from('entity_type_configs').select('*').eq('project_id', projectId),
  ]);

  if (nodesRes.error) throw new Error(`loadOntology nodes: ${nodesRes.error.message}`);
  if (relsRes.error) throw new Error(`loadOntology rels: ${relsRes.error.message}`);
  if (tensionsRes.error) throw new Error(`loadOntology tensions: ${tensionsRes.error.message}`);
  if (signalsRes.error) throw new Error(`loadOntology signals: ${signalsRes.error.message}`);
  if (entityTypesRes.error) throw new Error(`loadOntology entityTypes: ${entityTypesRes.error.message}`);

  const nodes: GraphNode[] = (nodesRes.data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    type: row.type,
    description: row.description ?? '',
    position: { x: row.position_x ?? 0, y: row.position_y ?? 0 },
    properties: row.properties ?? {},
  }));

  const relationships: Relationship[] = (relsRes.data ?? []).map((row) => ({
    id: row.id,
    sourceId: row.source_node_id,
    targetId: row.target_node_id,
    type: row.type,
    description: row.description ?? undefined,
  }));

  const tensions: TensionMarker[] = (tensionsRes.data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    relatedNodeIds: row.related_node_ids ?? [],
    status: row.status,
  }));

  const evaluativeSignals: EvaluativeSignal[] = (signalsRes.data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    direction: row.direction,
    strength: row.strength,
    sourceDescription: row.source_description ?? '',
  }));

  const entityTypes: EntityTypeConfig[] = (entityTypesRes.data ?? []).map((row) => ({
    id: row.type_id,   // type_id is the slug ("organisation"); id is the auto-generated UUID PK
    label: row.label,
    color: row.color,
  }));

  return { nodes, relationships, tensions, evaluativeSignals, entityTypes };
}

export async function saveOntology(projectId: string, state: GraphState): Promise<void> {
  // ── Upsert nodes ──────────────────────────────────────────────────────────
  if (state.nodes.length > 0) {
    const { error } = await supabase.from('ontology_nodes').upsert(
      state.nodes.map((n) => ({
        id: n.id,
        project_id: projectId,
        label: n.label,
        type: n.type,
        description: n.description,
        position_x: n.position.x,
        position_y: n.position.y,
        properties: n.properties ?? {},
        // preserve source_type if already set — don't override on upsert
      })),
      { onConflict: 'id', ignoreDuplicates: false }
    );
    if (error) throw new Error(`saveOntology nodes: ${error.message}`);
  }

  // ── Upsert relationships ──────────────────────────────────────────────────
  if (state.relationships.length > 0) {
    const { error } = await supabase.from('ontology_relationships').upsert(
      state.relationships.map((r) => ({
        id: r.id,
        project_id: projectId,
        source_node_id: r.sourceId,
        target_node_id: r.targetId,
        type: r.type,
        description: r.description ?? null,
      })),
      { onConflict: 'id', ignoreDuplicates: false }
    );
    if (error) throw new Error(`saveOntology rels: ${error.message}`);
  }

  // ── Upsert tension markers ────────────────────────────────────────────────
  if (state.tensions.length > 0) {
    const { error } = await supabase.from('tension_markers').upsert(
      state.tensions.map((t) => ({
        id: t.id,
        project_id: projectId,
        description: t.description,
        related_node_ids: t.relatedNodeIds,
        status: t.status,
      })),
      { onConflict: 'id', ignoreDuplicates: false }
    );
    if (error) throw new Error(`saveOntology tensions: ${error.message}`);
  }

  // ── Upsert evaluative signals ─────────────────────────────────────────────
  if (state.evaluativeSignals.length > 0) {
    const { error } = await supabase.from('evaluative_signals').upsert(
      state.evaluativeSignals.map((s) => ({
        id: s.id,
        project_id: projectId,
        label: s.label,
        direction: s.direction,
        strength: s.strength,
        source_description: s.sourceDescription,
      })),
      { onConflict: 'id', ignoreDuplicates: false }
    );
    if (error) throw new Error(`saveOntology signals: ${error.message}`);
  }

  // ── Upsert entity type configs ────────────────────────────────────────────
  // Non-fatal: the onConflict clause requires a unique index on (project_id, type_id)
  // in Supabase. If that index is missing the upsert returns 400. Entity types
  // are rebuilt from graph nodes on every load (syncTypesFromGraph), so a failed
  // persist here is acceptable — it just means colours won't survive a cold reload
  // from Supabase alone. Run supabase/migrations/001_entity_type_unique_constraint.sql
  // to fix this permanently.
  if (state.entityTypes.length > 0) {
    const { error } = await supabase.from('entity_type_configs').upsert(
      state.entityTypes.map((et) => ({
        type_id: et.id,   // et.id is the slug; type_id is the text column; id PK is auto-generated
        project_id: projectId,
        label: et.label,
        color: et.color,
      })),
      { onConflict: 'project_id,type_id', ignoreDuplicates: false }
    );
    if (error) {
      // Log but don't throw — entity types are derived from nodes and can be
      // reconstructed client-side, so this failure is non-blocking.
      console.warn(`saveOntology entityTypes (non-fatal): ${error.message}`);
    }
  }

  // ── Delete rows removed from state ────────────────────────────────────────
  // Only delete if we have IDs to check against (otherwise skip to avoid nuking everything)
  const nodeIds = state.nodes.map((n) => n.id);
  const relIds = state.relationships.map((r) => r.id);
  const tensionIds = state.tensions.map((t) => t.id);
  const signalIds = state.evaluativeSignals.map((s) => s.id);
  const entityTypeIds = state.entityTypes.map((et) => et.id);

  if (nodeIds.length > 0) {
    await supabase.from('ontology_nodes')
      .delete()
      .eq('project_id', projectId)
      .not('id', 'in', `(${nodeIds.map((id) => `'${id}'`).join(',')})`);
  }
  if (relIds.length > 0) {
    await supabase.from('ontology_relationships')
      .delete()
      .eq('project_id', projectId)
      .not('id', 'in', `(${relIds.map((id) => `'${id}'`).join(',')})`);
  }
  if (tensionIds.length > 0) {
    await supabase.from('tension_markers')
      .delete()
      .eq('project_id', projectId)
      .not('id', 'in', `(${tensionIds.map((id) => `'${id}'`).join(',')})`);
  }
  if (signalIds.length > 0) {
    await supabase.from('evaluative_signals')
      .delete()
      .eq('project_id', projectId)
      .not('id', 'in', `(${signalIds.map((id) => `'${id}'`).join(',')})`);
  }
  if (entityTypeIds.length > 0) {
    await supabase.from('entity_type_configs')
      .delete()
      .eq('project_id', projectId)
      .not('type_id', 'in', `(${entityTypeIds.map((id) => `'${id}'`).join(',')})`);
  }
}

// ── Session logging ──────────────────────────────────────────────────────────

export type SessionType = 'inquiry' | 'extraction' | 'synthesis' | 'classification' | 'manual';
export type SessionAgent = 'haiku' | 'sonnet' | 'gemini' | 'manual';

export async function logSession(input: {
  project_id: string;
  type: SessionType;
  agent: SessionAgent;
  summary: string;
  raw_output?: unknown;
}): Promise<string> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      project_id: input.project_id,
      type: input.type,
      agent: input.agent,
      summary: input.summary,
      raw_output: input.raw_output ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`logSession: ${error.message}`);
  return data.id;
}

export async function getSessions(projectId: string): Promise<{
  id: string;
  type: SessionType;
  agent: SessionAgent;
  summary: string;
  created_at: string;
}[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, type, agent, summary, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getSessions: ${error.message}`);
  return data ?? [];
}

// ── Project-scoped vector search ─────────────────────────────────────────────

export async function searchChunks(
  projectId: string,
  queryEmbedding: number[],
  matchCount = 5
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_chunks_v2', {
    p_project_id: projectId,
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });

  if (error) throw new Error(`searchChunks: ${error.message}`);
  return data ?? [];
}
