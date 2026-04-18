/**
 * POST /api/integrate
 *
 * Phase 5 of the Sources pipeline — cross-document integration pass.
 *
 * After all documents in a batch are extracted, this route runs a single
 * Gemini pass over the full entity set to:
 *   1. Merge near-duplicate entities that were extracted from different documents
 *   2. Add relationships between entities that span source documents
 *   3. Correct attractor assignments that were wrong in per-document isolation
 *
 * The three mutation phases are executed sequentially so that:
 *   - Relationship re-pointing (step 1) is complete before new rels are added (step 2)
 *   - Entity IDs in steps 2 + 3 are validated post-merge (non-survivors are gone)
 *
 * Body: { projectId: string }
 *
 * Returns: {
 *   updatedGraph: GraphState   — full reloaded graph state post-integration
 *   result: IntegrationResult  — summary of changes made
 * }
 */

export const maxDuration = 300; // Gemini integration call can be slow for large graphs

import { NextRequest, NextResponse } from "next/server";
import { integrateEntities, normaliseRelType } from "@/lib/gemini";
import {
  getProject,
  getProjectEntitiesCompact,
  executeMerges,
  addCrossDocRelationships,
  reassignAttractors,
  loadOntology,
  logSession,
  createSnapshot,
} from "@/lib/supabase";
import type { ProjectBrief, IntegrationResult } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json() as { projectId: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    // ── Load compact entity + relationship data ────────────────────────────────
    const [entities, project, fullGraph] = await Promise.all([
      getProjectEntitiesCompact(projectId),
      getProject(projectId),
      loadOntology(projectId),
    ]);

    if (entities.length === 0) {
      return NextResponse.json(
        { error: "No entities found. Extract documents first." },
        { status: 400 }
      );
    }

    const brief = project?.metadata?.brief as ProjectBrief | undefined;

    // Build compact relationship list for the Gemini prompt.
    // Uses labels (not IDs) since relationships are for context only — Gemini
    // references entities by ID when producing outputs.
    const labelById: Record<string, string> = {};
    for (const e of entities) labelById[e.id] = e.label;

    const compactRels = fullGraph.relationships.map((r) => ({
      sourceLabel: labelById[r.sourceId] ?? r.sourceId,
      targetLabel: labelById[r.targetId] ?? r.targetId,
      type: r.type,
    }));

    console.log(
      `[integrate] Starting integration for project ${projectId}: ` +
      `${entities.length} entities, ${compactRels.length} relationships`
    );

    // ── Run Gemini integration pass ───────────────────────────────────────────
    const { mergeGroups, newRelationships, reassignments } = await integrateEntities(
      entities,
      compactRels,
      brief
    );

    console.log(
      `[integrate] Gemini returned: ${mergeGroups.length} merge groups, ` +
      `${newRelationships.length} new relationships, ${reassignments.length} reassignments`
    );

    // ── Phase 1: Execute merges ────────────────────────────────────────────────
    // Build a deletedId → survivorId map while executing, so we can remap
    // entity IDs in later phases (non-survivors are gone after merges).
    const deletedToSurvivor: Record<string, string> = {};
    for (const group of mergeGroups) {
      // Mirror survivor-selection logic from executeMerges to build the remap
      // (executeMerges picks survivor internally, so we approximate here)
      const survivorId = group.entityIdsToMerge[0]; // will be corrected by executeMerges
      for (const id of group.entityIdsToMerge) {
        if (id !== survivorId) deletedToSurvivor[id] = survivorId;
      }
    }

    const entitiesMerged = await executeMerges(projectId, mergeGroups);

    // ── Remap IDs in subsequent phases ────────────────────────────────────────
    // Any entity ID that was deleted (non-survivor) must be mapped to its survivor
    // before we try to create relationships or reassign attractors.
    const remapId = (id: string) => deletedToSurvivor[id] ?? id;

    const remappedRels = newRelationships.map((r) => ({
      ...r,
      sourceEntityId: remapId(r.sourceEntityId),
      targetEntityId: remapId(r.targetEntityId),
      type: normaliseRelType(r.type),
    }));

    const remappedReassignments = reassignments.map((r) => ({
      ...r,
      entityId: remapId(r.entityId),
    }));

    // ── Phase 2: Add cross-document relationships ─────────────────────────────
    const relationshipsAdded = await addCrossDocRelationships(projectId, remappedRels);

    // ── Phase 3: Reassign attractors ──────────────────────────────────────────
    const attractorsReassigned = await reassignAttractors(projectId, remappedReassignments);

    console.log(
      `[integrate] Done: merged ${entitiesMerged} entities, ` +
      `added ${relationshipsAdded} rels, reassigned ${attractorsReassigned} attractors`
    );

    // ── Load fresh graph state ────────────────────────────────────────────────
    // Return the full reloaded state so the client can update the canvas in one shot.
    const updatedGraph = await loadOntology(projectId);

    const result: IntegrationResult = {
      mergeGroupCount:      mergeGroups.length,
      entitiesMerged,
      relationshipsAdded,
      attractorsReassigned,
    };

    // ── Snapshot post-integration state (fire and forget) ────────────────────
    createSnapshot(projectId, "integration").catch((err) =>
      console.warn("[integrate] Snapshot failed (non-fatal):", err)
    );

    // ── Log session (fire and forget) ─────────────────────────────────────────
    logSession({
      project_id: projectId,
      type:       "extraction",
      agent:      "gemini",
      summary:
        `Integration pass: merged ${entitiesMerged} entities into ${mergeGroups.length} groups, ` +
        `added ${relationshipsAdded} cross-doc relationships, reassigned ${attractorsReassigned} attractors.`,
      raw_output: result,
    }).catch((err) => console.warn("[integrate] Session log failed (non-fatal):", err));

    return NextResponse.json({ updatedGraph, result });
  } catch (err) {
    console.error("[integrate] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
