# Feature Implementation Plan — Cross-Document Integration Pass

**Overall Progress:** `100%`

---

## TLDR
After all documents are extracted, run a single Gemini pass that merges duplicate entities across documents, generates cross-document relationships, and reassigns attractors where per-document context was misleading. Triggered manually via an "Integrate" button in the Sources panel (Phase 5 of the pipeline).

---

## Critical Decisions

- **Manual trigger (button), not auto:** Shows before/after clearly; move to auto once proven reliable
- **Single Gemini call for all three phases** (merge + cross-doc rels + attractor reassign): one round-trip, less latency
- **Compact payload:** label + attractor + first 100 chars of description per entity — keeps token count manageable for large graphs
- **Thinking disabled for integration call:** same as extraction — faster and more reliable structured JSON (thinkingBudget: 0 inside generationConfig)
- **Survivor selection:** entity with the most existing relationships wins a merge; Gemini provides canonical label/description
- **>800 entity fallback:** batch Phase 1 (merges) by attractor group first, then Phase 2 (cross-doc rels) on the reduced set

---

## Tasks

- [x] 🟩 **Step 1: Types**
  - [x] 🟩 Add `CompactEntity`, `MergeGroup`, `CrossDocRelationship`, `AttractorReassignment`, `IntegrationResult` interfaces to `src/types/index.ts`

- [x] 🟩 **Step 2: Supabase helpers**
  - [x] 🟩 Add `getProjectEntitiesCompact(projectId)` — loads all nodes with id, label, type, attractor, description
  - [x] 🟩 Add `executeMerges(projectId, mergeGroups)` — picks survivor, re-points relationships + tension markers, deletes merged entities, deduplicates relationships
  - [x] 🟩 Add `addCrossDocRelationships(projectId, newRelationships)` — validates entity IDs exist, dedup-checks, inserts into `ontology_relationships`
  - [x] 🟩 Add `reassignAttractors(projectId, reassignments)` — updates `attractor` field on `ontology_nodes`

- [x] 🟩 **Step 3: Gemini integration function**
  - [x] 🟩 Add `integrateEntities(entities, relationships, projectBrief)` to `src/lib/gemini.ts`
  - [x] 🟩 Build compact payload (truncate descriptions to 100 chars)
  - [x] 🟩 Write integration prompt (three-phase: merges → cross-doc rels → attractor reassign)
  - [x] 🟩 Call with thinking disabled (`thinkingBudget: 0`), no JSON mode, fence-strip + parse response
  - [x] 🟩 Validate all entity IDs in response before returning (log + drop invalid ones)
  - [x] 🟩 Retry once with JSON reinforcement if parse fails

- [x] 🟩 **Step 4: `/api/integrate` route**
  - [x] 🟩 Create `src/app/api/integrate/route.ts`
  - [x] 🟩 Set `export const maxDuration = 300`
  - [x] 🟩 Load entities + relationships + project brief from Supabase
  - [x] 🟩 Call `integrateEntities()`, then execute the three mutation phases sequentially
  - [x] 🟩 Return `IntegrationResult` summary (merges, new rels, reassignments)

- [x] 🟩 **Step 5: Sources UI — Integrate button**
  - [x] 🟩 Track `integrationState: "idle" | "running" | "done" | "error"` in `Sources.tsx`
  - [x] 🟩 Show Integrate button after extraction phase completes (at least one file `done`)
  - [x] 🟩 Show entity count + prompt: "N entities across X documents — run integration to merge duplicates and connect across documents"
  - [x] 🟩 Show spinner while running, summary on completion ("Merged X into Y groups. Added Z cross-document relationships. Reassigned N attractors.")
  - [x] 🟩 On success, call `onGraphUpdate` to refresh canvas

- [x] 🟩 **Step 6: CLAUDE.md update**
  - [x] 🟩 Add cross-document integration entry to Patterns & Gotchas as described in spec
