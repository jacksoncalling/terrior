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
- **AI:** Claude Sonnet (chat + graph tool use), Gemini (batch ontology extraction)
- **DB:** Supabase (projects, ontology nodes/relationships, documents, embeddings, sessions)
- **Embeddings:** Transformers.js local (paraphrase-multilingual-MiniLM-L12-v2)
- **Layout:** Dagre (hierarchical auto-layout)

---

## Architecture: 3-Panel Editor

```
[Chat / Extract] | [Canvas — ReactFlow graph] | [Inspector]
```

- **Chat panel** — dual mode: conversational (Claude with 9 graph tools) + narrative extraction
- **Canvas** — interactive graph, drag/click/auto-layout, type-filtered
- **Inspector** — node/edge property editor
- **TypePalette** — emergent entity types, color-coded
- **Projects page** (`/projects`) — multi-project management
- **Compare page** (`/compare`) — side-by-side vector vs. ontology search

---

## Data Model (Supabase)

Tables: `projects`, `ontology_nodes`, `ontology_relationships`, `tension_markers`, `evaluative_signals`, `entity_type_configs`, `documents`, `document_chunks`, `sessions`

All tables scoped by `project_id`.

---

## Phase 1 Status — NEARLY COMPLETE

### Completed (Sessions 1–3, Mar 9–13)
- [x] Next.js scaffold + Supabase schema
- [x] ReactFlow canvas with custom nodes/edges, Dagre auto-layout
- [x] Chat panel with Claude Sonnet tool use (9 graph manipulation tools)
- [x] Narrative extraction pipeline (`/api/extract`)
- [x] Multi-project support with `ProjectContext`
- [x] Project-scoped localStorage (messages + graph state keyed by `projectId`)
- [x] Supabase load/save with 800ms debounce
- [x] `↑ Migrate v1` button for recovering legacy unscoped localStorage data
- [x] Compare page fully project-scoped (removes hardcoded corpus selector, loads graph from Supabase, generates preset chips from ontology nodes)
- [x] Navigation bug fix: localStorage saves immediately on change; Supabase is durable backup. Fallback on load = localStorage if Supabase empty (prevents empty canvas on mid-flight nav)
- [x] Two demo projects in Supabase: Bike Components — Rennrad, Babor Beauty Group
- [x] Pre-built ontology JSONs: `data/bc-ontology-gemini.json`, `data/babor-ontology-gemini.json`

### Remaining (Sessions 4–5)
- [x] **Bonus fix (Mar 15):** Deduplication prompt — `create_node` tool description + system prompt guidelines now instruct Claude to check for existing nodes before creating. Prevents duplicate nodes in chat sessions.
- [x] **Session 4 (Mar 15):** Entity type UUID bug fixed (supabase.ts) · `src/lib/gemini.ts` (Gemini 2.5 Flash client) · `src/lib/document-parser.ts` (PDF/DOCX/TXT/MD/JSON) · `/api/ingest` route · `/api/extract-gemini` route · `scripts/ingest.mjs --project` flag · `next.config.ts` 20MB body limit
- [ ] **Session 5:** Sources tab UI (`src/components/Sources.tsx`) + wire into `page.tsx` + end-to-end verification

### Known Bug
- Entity type IDs use strings (`"organisation"`, `"platform"`) instead of UUIDs → `entity_type_configs` Supabase upsert returns 400. Non-fatal (caught silently), but entity types don't persist to Supabase. Fix: generate UUID on creation in `src/lib/entity-types.ts`.

---

## Phase 2 — Planned (not yet started)

**Milestone 2: Haiku Inquiry Agent**
- Structured inquiry mode (vs. open conversation) — a new interaction pattern
- Haiku as the listening instrument: asks questions, extracts, updates graph
- Needs Opus planning session before implementation

**Milestone 3+:** TBD — see full brief

---

## Key File Paths

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main 3-panel editor |
| `src/app/projects/page.tsx` | Project management |
| `src/app/compare/page.tsx` | Search comparison |
| `src/app/api/chat/route.ts` | Claude conversation loop |
| `src/app/api/extract/route.ts` | Narrative extraction |
| `src/lib/claude.ts` | Claude Sonnet + tool use loop |
| `src/lib/tools.ts` | 9 graph tool definitions |
| `src/lib/supabase.ts` | DB client + CRUD |
| `src/lib/graph-state.ts` | Graph state mutations |
| `src/lib/entity-types.ts` | Entity type management (has UUID bug) |
| `src/lib/system-prompt.ts` | Dynamic system prompt builder |
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

## Workflow Rules (for Claude)

- **Before executing any session:** confirm the current session number and what's in scope
- **After completing a session:** update the checkboxes above, then commit with `git commit`
- **Before ending any session:** ask Max if he wants to commit progress
- **Bug fixes count as their own commits**
