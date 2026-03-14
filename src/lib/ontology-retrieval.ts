/**
 * Ontology-Guided Retrieval
 *
 * Uses the Terrior knowledge graph to enhance vector search.
 *
 * The core idea: when a user asks a question, we don't just embed the raw query.
 * We first look up what the ontology knows about the entities in the question,
 * traverse relationships to find connected context, then use all of that to
 * build a richer query before hitting the vector store.
 *
 * This is where ontology-RAG should beat plain vector-RAG:
 * - Relational queries ("how does X relate to Y?")
 * - Cross-concept queries ("products for sensitive AND aging skin")
 * - Discovery queries ("where are there tensions?")
 */

import type { GraphState, GraphNode, Relationship } from '@/types';

export interface OntologyContext {
  matchedEntities: MatchedEntity[];
  expandedQuery: string;
  graphHops: GraphHop[];
}

export interface MatchedEntity {
  node: GraphNode;
  matchScore: number;
  matchReason: string;
}

export interface GraphHop {
  from: string;
  relationship: string;
  to: string;
  description?: string;
}

/**
 * Find entities in the graph that are relevant to the query.
 * Uses keyword matching against node labels and descriptions.
 */
function findRelevantEntities(query: string, graph: GraphState): MatchedEntity[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    // Remove common stop words
    .filter(w => !['the', 'and', 'for', 'are', 'how', 'what', 'which', 'does', 'can', 'with', 'from', 'that', 'this', 'their', 'have'].includes(w));

  const scored: MatchedEntity[] = [];

  for (const node of graph.nodes) {
    const labelLower = node.label.toLowerCase();
    const descLower = (node.description || '').toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    for (const word of queryWords) {
      if (labelLower === word) {
        score += 3; // Exact label match
        reasons.push(`exact label match: "${word}"`);
      } else if (labelLower.includes(word)) {
        score += 2; // Partial label match
        reasons.push(`label contains: "${word}"`);
      } else if (descLower.includes(word)) {
        score += 1; // Description match
        reasons.push(`description contains: "${word}"`);
      }
    }

    if (score > 0) {
      scored.push({
        node,
        matchScore: score,
        matchReason: reasons.join(', '),
      });
    }
  }

  // Return top 5 most relevant, sorted by score
  return scored
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);
}

/**
 * Traverse the graph from matched entities, collecting connected nodes and relationships.
 * Goes up to `maxHops` relationship steps away.
 */
function traverseGraph(
  startNodes: GraphNode[],
  graph: GraphState,
  maxHops = 2
): { connectedNodes: GraphNode[]; hops: GraphHop[] } {
  const visited = new Set(startNodes.map(n => n.id));
  const connectedNodes: GraphNode[] = [...startNodes];
  const hops: GraphHop[] = [];
  let frontier = startNodes.map(n => n.id);

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier: string[] = [];

    for (const rel of graph.relationships) {
      // Check if this relationship connects from/to frontier nodes
      const fromInFrontier = frontier.includes(rel.sourceId);
      const toInFrontier = frontier.includes(rel.targetId);

      if (!fromInFrontier && !toInFrontier) continue;

      const targetId = fromInFrontier ? rel.targetId : rel.sourceId;
      if (visited.has(targetId)) continue;

      const targetNode = graph.nodes.find(n => n.id === targetId);
      if (!targetNode) continue;

      const sourceNode = graph.nodes.find(n => n.id === rel.sourceId);
      const destNode = graph.nodes.find(n => n.id === rel.targetId);

      visited.add(targetId);
      connectedNodes.push(targetNode);
      nextFrontier.push(targetId);

      hops.push({
        from: sourceNode?.label || rel.sourceId,
        relationship: rel.type,
        to: destNode?.label || rel.targetId,
        description: rel.description,
      });
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return { connectedNodes, hops };
}

/**
 * Build an expanded query from the original query + ontology context.
 *
 * COMPACT MODE: Stays under ~100 tokens to respect the 128-token context window
 * of multilingual embedding models. Labels only — no descriptions, no relationship
 * prose. Full-text expansion causes truncation and dilutes the embedding signal.
 *
 * Strategy:
 *   1. Original query (anchor)
 *   2. Matched entity labels (concepts the query maps to)
 *   3. Top 6 connected node labels (product names act as corpus anchors)
 */
function buildExpandedQuery(
  originalQuery: string,
  matchedEntities: MatchedEntity[],
  connectedNodes: GraphNode[],
  hops: GraphHop[],
  graph: GraphState
): string {
  const parts: string[] = [originalQuery];

  // Matched entity labels only — no descriptions
  if (matchedEntities.length > 0) {
    parts.push(matchedEntities.map(e => e.node.label).join(', '));
  }

  // Top connected node labels (product names bridge into corpus vocabulary)
  const extraLabels = connectedNodes
    .filter(n => !matchedEntities.find(e => e.node.id === n.id))
    .slice(0, 6)
    .map(n => n.label);
  if (extraLabels.length > 0) {
    parts.push(extraLabels.join(', '));
  }

  // Suppress unused-param warnings — hops and graph kept for future modes
  void hops; void graph;

  return parts.join('. ');
}

/**
 * Main export: build ontology context for a query against a graph.
 * Returns the expanded query and the reasoning trail.
 */
export function buildOntologyContext(
  query: string,
  graph: GraphState
): OntologyContext {
  // Empty graph — return minimal context
  if (!graph || graph.nodes.length === 0) {
    return {
      matchedEntities: [],
      expandedQuery: query,
      graphHops: [],
    };
  }

  const matchedEntities = findRelevantEntities(query, graph);

  if (matchedEntities.length === 0) {
    return {
      matchedEntities: [],
      expandedQuery: query,
      graphHops: [],
    };
  }

  const { connectedNodes, hops } = traverseGraph(
    matchedEntities.map(e => e.node),
    graph,
    2
  );

  const expandedQuery = buildExpandedQuery(
    query,
    matchedEntities,
    connectedNodes,
    hops,
    graph
  );

  return {
    matchedEntities,
    expandedQuery,
    graphHops: hops,
  };
}
