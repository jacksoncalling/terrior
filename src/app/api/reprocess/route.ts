/**
 * POST /api/reprocess
 *
 * Re-extracts all documents for a project using a new abstraction layer.
 * This is the "change lens and rebuild" escape valve.
 *
 * Flow:
 *   1. Fetch all documents for the project
 *   2. Clear the existing ontology (full replace — no merge)
 *   3. Extract each document sequentially with the new abstraction layer,
 *      accumulating entities so later docs can connect to earlier ones
 *   4. Save the new graph to Supabase
 *   5. Return the new GraphState
 *
 * IMPORTANT: The client is responsible for downloading a graph snapshot
 * BEFORE calling this endpoint. This route does not produce a backup.
 *
 * Body: {
 *   projectId:        string,
 *   abstractionLayer: AbstractionLayer,
 * }
 *
 * Returns: {
 *   updatedGraph: GraphState,
 *   documentCount: number,
 *   totalUpdates:  number,
 * }
 */

// Vercel: allow up to 5 minutes for sequential Gemini extraction across large corpora
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { extractOntologyWithGemini } from "@/lib/gemini";
import {
  getProject,
  getProjectDocuments,
  clearOntology,
  saveOntology,
  logSession,
} from "@/lib/supabase";
import { seedHubNodes } from "@/lib/entity-types";
import type { GraphState, AbstractionLayer, AttractorPreset, ProjectBrief } from "@/types";

// Empty graph — starting point for a full re-extraction
const EMPTY_GRAPH: GraphState = {
  nodes: [],
  relationships: [],
  tensions: [],
  evaluativeSignals: [],
  entityTypes: [],
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      projectId: string;
      abstractionLayer: AbstractionLayer;
    };

    const { projectId, abstractionLayer } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const validLayers: AbstractionLayer[] = [
      "domain_objects",
      "interaction_patterns",
      "concerns_themes",
    ];
    if (!abstractionLayer || !validLayers.includes(abstractionLayer)) {
      return NextResponse.json(
        { error: `abstractionLayer must be one of: ${validLayers.join(", ")}` },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // ── Fetch documents and brief ─────────────────────────────────────────────
    const [documents, project] = await Promise.all([
      getProjectDocuments(projectId),
      getProject(projectId),
    ]);

    if (documents.length === 0) {
      return NextResponse.json(
        { error: "No documents found for this project. Nothing to re-process." },
        { status: 400 }
      );
    }

    const brief = project?.metadata?.brief as ProjectBrief | undefined;

    // ── Clear existing ontology (full replace) ────────────────────────────────
    console.log(
      `[reprocess] Clearing ontology for project ${projectId} before rebuild`
    );
    await clearOntology(projectId);

    // ── Sequential re-extraction with new abstraction layer ───────────────────
    // Each document uses the accumulated graph from all previous documents,
    // so entities can be connected across sources.
    // Seed hub nodes first so assembleGraph can create belongs_to_hub relationships
    // during extraction — without them, findHubByAttractorId always returns undefined
    // and every entity ends up unconnected (Emergent zone).
    const preset = (project?.metadata?.attractorPreset as AttractorPreset) ?? 'startup';
    const hubNodes = seedHubNodes(preset);
    let currentGraph: GraphState = { ...structuredClone(EMPTY_GRAPH), nodes: hubNodes };
    let totalUpdates = 0;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      console.log(
        `[reprocess] Extracting document ${i + 1}/${documents.length}: "${doc.title}"`
      );

      if (!doc.content?.trim()) {
        console.warn(`[reprocess] Skipping "${doc.title}" — empty content`);
        continue;
      }

      const { updatedGraph, graphUpdates } = await extractOntologyWithGemini(
        doc.content,
        currentGraph,
        abstractionLayer,
        brief
      );

      currentGraph = updatedGraph;
      totalUpdates += graphUpdates.length;
    }

    // ── Save the new graph to Supabase ────────────────────────────────────────
    await saveOntology(projectId, currentGraph);

    // ── Log session (fire and forget) ─────────────────────────────────────────
    logSession({
      project_id: projectId,
      type:       "extraction",
      agent:      "gemini",
      summary:    `Reprocessed ${documents.length} documents with lens: ${abstractionLayer}. Graph rebuilt: ${currentGraph.nodes.length} nodes, ${currentGraph.relationships.length} relationships.`,
      raw_output: {
        abstractionLayer,
        documentCount: documents.length,
        nodeCount:     currentGraph.nodes.length,
        relCount:      currentGraph.relationships.length,
        totalUpdates,
      },
    }).catch((err) => console.warn("[reprocess] Session log failed (non-fatal):", err));

    return NextResponse.json({
      updatedGraph:  currentGraph,
      documentCount: documents.length,
      totalUpdates,
    });
  } catch (err) {
    console.error("[reprocess] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
