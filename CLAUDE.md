# TERROIR — Project Context

> Load this at the start of every session. It is the ground truth for where we are.

---

## What This Is

**TERROIR** is an organisational listening tool for digital consultants. It surfaces the latent ontology of an organisation through narrative inquiry and AI-powered graph extraction. Output: an editable knowledge graph (digital twin) that accelerates enterprise knowledge system implementations.

Primary persona: **Anna Bergmann** — Digital Implementation Manager at a consultancy, leading discovery for a German Mittelstand client.

Full brief: `../TERROIR_brief_v2.md`

---

## Stack

- **Framework:** Next.js (app router, TypeScript)
- **UI:** ReactFlow (graph canvas) + Tailwind
- **AI:** Claude Sonnet (chat + graph tool use), Gemini 2.5 Flash (extraction + classification + synthesis), Claude Haiku (scoping dialogue only)
- **DB:** Supabase (projects, ontology nodes/relationships, documents, embeddings, sessions)
- **Embeddings:** Transformers.js local (paraphrase-multilingual-MiniLM-L12-v2)
- **Layout:** Dagre (hierarchical auto-layout)

---

## Architecture: 3-Panel Editor

```
[Chat / Extract / Sources / Synthesis] | [Canvas — ReactFlow graph] | [Inspector + Project Brief]
```

- **Chat panel** — four modes: Chat (Claude Sonnet + 9 graph tools), Extract (narrative → graph), Sources (file upload + paste-text → Gemini extraction), Synthesis (Gemini cross-source analysis)
- **Canvas** — interactive graph, drag/click/auto-layout, type-filtered
- **Inspector** — node/edge property editor + Project Brief panel (when nothing selected)
- **TypePalette** — emergent entity types, color-coded
- **Projects page** (`/projects`) — multi-project management
- **Compare page** (`/compare`) — side-by-side vector vs. ontology search
- **Scoping Modal** — full-screen overlay, Haiku dialogue → ProjectBrief

---

## Data Model (Supabase)

Tables: `projects`, `ontology_nodes`, `ontology_relationships`, `tension_markers`, `evaluative_signals`, `entity_type_configs`, `documents`, `document_chunks`, `sessions`

All tables scoped by `project_id`.

Project brief stored in `projects.metadata.brief` (jsonb — no schema migration needed).

---

## Phase 1 Status — COMPLETE ✅

### Completed (Sessions 1–5, Mar 9–15)
- [x] Next.js scaffold + Supabase schema
- [x] ReactFlow canvas with custom nodes/edges, Dagre auto-layout
- [x] Chat panel with Claude Sonnet tool use (9 graph manipulation tools)
- [x] Narrative extraction pipeline (`/api/extract`)
- [x] Multi-project support with `ProjectContext`
- [x] Project-scoped localStorage (messages + graph state keyed by `projectId`)
- [x] Supabase load/save with 800ms debounce
- [x] `↑ Migrate v1` button for recovering legacy unscoped localStorage data
- [x] Compare page fully project-scoped
- [x] Two demo projects: Bike Components — Rennrad, Babor Beauty Group
- [x] Gemini 2.5 Flash extraction client + `/api/extract-gemini`
- [x] Document ingest pipeline (`/api/ingest`, `scripts/ingest.mjs`)
- [x] Sources tab UI with drag-and-drop file upload

### Known Bug
- Entity type IDs use strings (`"organisation"`, `"platform"`) instead of UUIDs → `entity_type_configs` Supabase upsert returns 400. Non-fatal (caught silently), but entity types don't persist to Supabase. Fix: generate UUID on creation in `src/lib/entity-types.ts`.

---

## Phase 2 Status — COMPLETE ✅

**Haiku Synthesis Agent** — completed Mar 16, 2026 (Sessions 6–9)

### What was built
- [x] **Project Brief** — scoping dialogue with Haiku → editable brief stored in `projects.metadata.brief`
- [x] **Abstraction layers** — three extraction lenses (domain objects / interaction patterns / concerns & themes) fed to Gemini
- [x] **Sources integration** — new uploads use the project's abstraction layer automatically
- [x] **Cross-source synthesis** — Haiku reads all documents + graph, returns term collisions, connecting threads, signal convergence, graph gaps
- [x] **Synthesis tab** — 4th tab in Chat panel with full results display
- [x] **Re-process escape valve** — change abstraction layer → snapshot download → full graph rebuild
- [x] **LocalStorage caching** — synthesis results + scoping messages cached per project
- [x] **Session logging** — all Haiku + Gemini interactions logged to `sessions` table

### Architecture decisions
- **Haiku has NO graph tools.** Reads and recommends only. Consultant acts on suggestions.
- **Synthesis before interview.** Cross-source reading is higher value than structured Q&A.
- **Brief in `projects.metadata`** — no migration, jsonb patch via read-modify-write.
- **Re-process = full replace + snapshot.** No merge. Consultant retains snapshot for rollback.
- **`<brief>` tag protocol** — Haiku signals completion by embedding JSON in `<brief>...</brief>`. Stripped from display.
- **Context window guard** — 600k chars (~150k tokens). Docs pre-summarised with Haiku if exceeded.

---

## Phase 2.5 Status — IN PROGRESS 🟨

**Bug Fixes + Ingestion Intelligence + PoC Readiness** — Mar 18–20, 2026

### What was built (completed Mar 20)
- [x] **Reset All fix** — now clears Supabase (ontology + documents + chunks), not just React state
- [x] **Synthesis moved to Gemini** — replaced Haiku synthesis with Gemini (1M context, 32768 output tokens). Haiku now scoping-only.
- [x] **Document pre-classification** — batch Gemini call classifies docs as EXTRACT/CAUTION/SKIP before extraction. Filters legal boilerplate, marketing, compliance noise.
- [x] **4-phase Sources flow** — Ingest (parallel) → Classify (batch) → Review (user overrides verdicts) → Extract (sequential, approved only)
- [x] **Paste-text input** — "Paste text" tab in Sources for Confluence/wiki/copy-paste workflows. Skips file ingest, enters pipeline at classify phase.
- [x] **Combined export bundle** — `src/lib/export.ts` — one JSON file with graph + synthesis + brief + classifications + stats. Machine-readable for RAG pipelines. Schema-versioned.
- [x] **Guided upload checklist** — collapsible "What to upload" panel in Sources empty state. Prioritised list + source-specific export tips (Confluence, SharePoint, Notion). Auto-collapses on first file.
- [x] **Button rename** — "← Projects" → "← All Projects"
- [x] **SessionType fix** — added `"classification"` to the SessionType union

### What's left for PoC readiness
- [ ] **Validation experiment** — run Babor data at 5/15/44 doc batch sizes, find the "aha" threshold where synthesis reveals non-obvious insights
- [ ] **10-minute demo script** — timed walkthrough: scoping → upload → classify → extract → synthesis → export. Identify 3 "wow moments". Prepare backup project with pre-ingested data.

### Architecture decisions (Phase 2.5)
- **Gemini does all document work:** extraction + classification + synthesis. Haiku = scoping only. Three-agent division updated.
- **Classification before extraction:** single Gemini call classifies all docs (first 2000 chars each). SKIP docs never extracted. Reduces noise + speeds up pipeline.
- **Paste-text is a pipeline bypass:** pasted content skips `/api/ingest` and enters at classify phase. Same downstream flow as uploaded files.
- **JSON export over PDF:** machine-readable format serves both humans and agents. `schema_version: "1.0"` for forward compatibility.

### Plan document
Full implementation plan at: `PLAN-poc-readiness.md` (Steps 1–3 complete, Steps 4–5 pending)

---

## Key File Paths

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main 3-panel editor + all Phase 2 state/handlers |
| `src/app/projects/page.tsx` | Project management |
| `src/app/compare/page.tsx` | Search comparison |
| `src/app/api/chat/route.ts` | Claude Sonnet conversation loop |
| `src/app/api/extract/route.ts` | Narrative extraction (Sonnet) |
| `src/app/api/extract-gemini/route.ts` | Bulk extraction (Gemini + abstraction layer) |
| `src/app/api/scoping/route.ts` | Haiku scoping dialogue |
| `src/app/api/classify/route.ts` | Batch document classification (Gemini) |
| `src/app/api/synthesis/route.ts` | Gemini cross-source synthesis |
| `src/app/api/reprocess/route.ts` | Re-extract all docs with new lens |
| `src/lib/claude.ts` | Claude Sonnet + tool use loop |
| `src/lib/haiku.ts` | Haiku client: scoping dialogue only |
| `src/lib/gemini.ts` | Gemini: extraction + classification + synthesis |
| `src/lib/export.ts` | Project bundle export (graph + synthesis + brief as JSON) |
| `src/lib/tools.ts` | 9 graph tool definitions |
| `src/lib/supabase.ts` | DB client + CRUD (incl. updateProjectMetadata, getProjectDocuments, clearOntology, clearDocuments) |
| `src/lib/graph-state.ts` | Graph state mutations |
| `src/lib/entity-types.ts` | Entity type management (has UUID bug) |
| `src/lib/system-prompt.ts` | Dynamic system prompt builder |
| `src/types/index.ts` | All types incl. ProjectBrief, SynthesisResult, AbstractionLayer |
| `src/components/Chat.tsx` | 4-tab chat panel (Chat/Extract/Sources/Synthesis) |
| `src/components/Sources.tsx` | 4-phase sources: upload/paste → classify → review → extract |
| `src/components/Inspector.tsx` | Node/edge editor + ProjectBrief panel |
| `src/components/ProjectBrief.tsx` | Inline-editable brief + re-process button |
| `src/components/ScopingModal.tsx` | Haiku scoping dialogue modal |
| `src/components/SynthesisResults.tsx` | Cross-source synthesis results display |
| `data/bc-ontology-gemini.json` | Bike Components pre-built ontology |
| `data/babor-ontology-gemini.json` | Babor Beauty pre-built ontology |
| `scripts/ingest.mjs` | Ingest ontologies into Supabase |

---

## Dev Server

```bash
cd terroir
npm run dev
# → localhost:3000
```

Or use the launch.json config (`terroir-dev`).

---

## Patterns & Gotchas

- **Three-agent cognitive division (revised):** Gemini = extract + classify + synthesise (all document work), Sonnet = converse + tools, Haiku = scoping dialogue only. See `~/.claude/learnings/2026-03-15-three-agent-cognitive-division.md`
- **Abstraction layer is explicit:** Three presets fed to Gemini — never default to "extract everything". See `~/.claude/learnings/2026-03-15-abstraction-layer-problem.md`
- **Synthesis before interview:** Cross-source synthesis first, structured interviewing second. See `~/.claude/learnings/2026-03-15-synthesis-before-interview.md`
- **Dynamic contexts framework:** Brief = stable context, Graph = dynamic context, Synthesis = inferred context. Maps to LineUp7's 9-layer model. See `~/.claude/learnings/2026-03-16-dynamic-contexts-framework.md`
- **Edit-on-blur pattern:** ProjectBrief uses same UX as Inspector — local state mirrors fields, Supabase updated on blur.
- **`saveOntology` ID interpolation:** NOT IN filter uses string-interpolated IDs — safe for UUIDs, watch if slug IDs ever contain special chars.
- **Reprocess timeout risk:** Sequential Gemini calls in `/api/reprocess` — add `export const maxDuration = 300` for Vercel deployments with 5+ large documents.
- **Classification filters noise at the gate:** Pre-classify all docs in one Gemini call (first 2000 chars each). 25 of 44 Babor docs were legal boilerplate — SKIP verdict prevents them from ever entering extraction.
- **Paste-text bypasses ingest:** `enqueuePastedText()` skips `/api/ingest` entirely, enters pipeline at classify. Same downstream flow. See `~/.claude/learnings/2026-03-20-paste-text-ingest-bypass.md`
- **Export bundles are agent context files:** The JSON bundle from `src/lib/export.ts` is designed to become the "CLAUDE.md for the organisation" — a structured preamble that travels with every agent call in a RAG pipeline.

---

## Workflow Rules (for Claude)

- **Before executing any session:** confirm the current session number and what's in scope
- **After completing a session:** update the checkboxes above, then commit with `git commit`
- **Before ending any session:** ask Max if he wants to commit progress
- **Bug fixes count as their own commits**
