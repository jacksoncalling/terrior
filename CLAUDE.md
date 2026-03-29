# TERROIR — Project Context

> Load this at the start of every session. Start here, not with the phase history.

---

## What This Is

**TERROIR** is an organisational listening tool for digital consultants. It surfaces the latent ontology of an organisation through narrative inquiry and AI-powered graph extraction. Output: an editable knowledge graph (digital twin) that accelerates enterprise knowledge system implementations.

Primary personas:
- **Anna Bergmann** — Digital Implementation Manager at a consultancy, leading discovery for a German Mittelstand client (enterprise preset)
- **Small AI startup founder** — 2-person team, 25+ years domain expertise locked in one person's head, building AI products in a field they know deeply. Needs to externalize tacit knowledge for their agents and onboard faster. (startup preset)

**Live URL:** https://terroir-mu.vercel.app/
**GitHub:** https://github.com/jacksoncalling/terrior (repo name is "terrior", app name is "terroir")
**Deploys:** Vercel auto-deploys on push to `main`

---

## Current State — Updated 2026-03-29

### What's working
- Full 3-panel editor live on Vercel (Chat / Sources+Synthesis+Reflect / Canvas / Inspector)
- **Attractor category presets** — dual-tagging: every node carries `attractor` (structural) + `type` (freeform descriptive). Startup preset: Domain, Capability, Toolchain, Customer, Method, Value. Enterprise preset: Identity, Policy, Structure, People, Functions, Processes, Resources. Selected at project creation.
- **Emergent zone** — nodes with 0–1 relationships get dashed borders + reduced opacity. "Emergent" filter chip with count badge in TypePalette. System prompt includes emergent zone section with suggested follow-up actions.
- **Nested ontologies** — `parent_project_id` on projects. Parent nodes appear read-only in child canvas. Projects page groups children under parents with "+ Add sub-project" buttons.
- Gemini extraction and Sonnet chat both assign attractors on node creation
- System prompt groups nodes by attractor, includes emergent zone context
- JSON export includes `attractor`, `type`, and computed `zone` per node
- Share button, Reflect tab, collapsible Inspector — all still working
- **Graph clarity features (Phase 6 — 2026-03-29):**
  - **Tensions in Reflect tab** — unresolved tensions visible below signals with full description, linked entity labels, and "Mark resolved" button. Reflect tab shows red count badge when tensions exist.
  - **Signal deduplication pass** — "Deduplicate" button appears in Reflect tab when signal count > 20. Triggers a Gemini pass that groups near-duplicates, picks canonical label + richer description, deletes non-survivors from Supabase. Shows summary: "382 → 41 signals (341 merged into 12 clusters)". Route: `POST /api/signals/deduplicate`.
  - **Filter-first canvas rendering** — attractor filter now shows matching nodes + their direct neighbors (not just matching nodes). Stats panel shows "X of Y entities" count when filtered.

### Known bugs
- **Entity type UUID bug** — entity type IDs use slugs not UUIDs → `entity_type_configs` upsert returns 400. Non-fatal (caught silently).
- **Existing nodes all tagged "emergent"** — pre-existing entities need re-extraction or manual attractor assignment to distribute across categories. Reprocess via Sources will auto-assign.
- **Realtime unconfirmed** — `ontology_relationships` may not be published to Realtime.

### What's next
1. **Test graph clarity features on Vercel** — open Step Into More (126 nodes), apply an attractor filter and verify neighbors are visible + count shows "X of Y". Check Reflect tab for tensions + dedup button.
2. **1-hour workshop demo script** — design the flow for the 2-man AI startup CEO session (15 docs + 1 hour conversation → show value)
3. **OpenClaw segment exploration** — assess whether Terroir can serve Claude/AI power users who want to map their automation landscape

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (app router, TypeScript) |
| UI | ReactFlow (graph canvas) + Tailwind |
| AI — Chat | Claude Sonnet + 9 graph tools |
| AI — Documents | Gemini 2.5 Flash (extract + classify + synthesise) |
| AI — Scoping | Claude Haiku (scoping dialogue only) |
| Database | Supabase (postgres + realtime) |
| Embeddings | Transformers.js local (paraphrase-multilingual-MiniLM-L12-v2) |
| Layout | Dagre (hierarchical auto-layout) |
| Hosting | Vercel |

---

## Architecture: 3-Panel Editor

```
[Chat panel] | [Canvas — ReactFlow graph] | [Inspector — collapsible]
```

### Chat panel (left, 360px)
Three tabs + one triggered mode:
- **Chat** — Claude Sonnet conversation + 9 graph manipulation tools
- **Synthesis** — Gemini cross-source analysis (term collisions, threads, gaps)
- **Reflect** — Rate evaluative signals on Relevance × Intensity (1–5), add notes
- **Sources** — Triggered via `+` button in chat input (not a tab). 4-phase pipeline: Ingest → Classify → Review → Extract

The `+` button also offers "Paste text" — expands an inline textarea, skips file ingest, enters pipeline at classify phase.

### Canvas (centre, flex)
Interactive ReactFlow graph. Drag/click/auto-layout. Type-filtered via TypePalette bar above. Double-click empty space to create a node.

### Inspector (right, collapsible)
- Collapses to 24px `‹/›` strip — gives canvas full width when not editing
- **Nothing selected:** Project Brief (editable) + Graph Summary (entity/rel counts, unresolved tensions)
- **Node selected:** Label, Type, Description editors + connections + tensions
- **Edge selected:** Type + Description editors
- Evaluative signals live exclusively in the **Reflect tab** — not in Inspector

### TypePalette (above canvas)
Attractor categories from active preset, color-coded. Click to filter canvas by attractor. "Emergent" chip with count badge shows nodes with 0–1 relationships. Click again to clear.

### Other pages
- `/projects` — multi-project management
- `/compare` — side-by-side vector vs. ontology search
- **Scoping Modal** — full-screen overlay, Haiku dialogue → ProjectBrief

---

## Data Model (Supabase)

All tables scoped by `project_id`.

| Table | Purpose |
|-------|---------|
| `projects` | Project metadata, brief in `metadata.brief`, attractor preset in `metadata.attractorPreset`, optional `parent_project_id` for nesting |
| `ontology_nodes` | Graph nodes (label, type, attractor, description, position) |
| `ontology_relationships` | Edges between nodes |
| `tension_markers` | Unresolved/resolved tensions flagged by Claude |
| `evaluative_signals` | What the org values/fears. Cols: `label`, `direction`, `strength`, `relevance_score`, `intensity_score`, `reflected_at`, `user_note` |
| `entity_type_configs` | Color + label per entity type (has UUID bug — see above) |
| `documents` | Uploaded/pasted source documents |
| `document_chunks` | Chunked content for vector search |
| `sessions` | AI interaction logs (Haiku, Sonnet, Gemini calls) |

### Migrations run in Supabase
- `001_entity_type_unique_constraint.sql` — unique index on `(project_id, type_id)`
- `002_enable_realtime.sql` — Realtime publication for `ontology_nodes` (and possibly `ontology_relationships` — unconfirmed)
- `003_reflect_scores.sql` — adds `relevance_score`, `intensity_score`, `reflected_at`, `user_note` to `evaluative_signals` ✅ run
- `004_attractor_and_nesting.sql` — adds `attractor` TEXT to `ontology_nodes`, `parent_project_id` UUID to `projects`, index on parent ✅ run

---

## Key File Paths

### App shell
| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main 3-panel editor — all state, handlers, layout |
| `src/app/projects/page.tsx` | Project list + creation |
| `src/app/compare/page.tsx` | Vector vs. ontology search comparison |

### API routes
| File | Purpose |
|------|---------|
| `src/app/api/chat/route.ts` | Claude Sonnet conversation + tool use loop |
| `src/app/api/extract/route.ts` | Narrative extraction (Sonnet) |
| `src/app/api/extract-gemini/route.ts` | Bulk document extraction (Gemini + abstraction layer) |
| `src/app/api/scoping/route.ts` | Haiku scoping dialogue → ProjectBrief |
| `src/app/api/classify/route.ts` | Batch document pre-classification (Gemini) |
| `src/app/api/synthesis/route.ts` | Gemini cross-source synthesis |
| `src/app/api/reprocess/route.ts` | Re-extract all docs with new lens (maxDuration = 300) |
| `src/app/api/reflect/route.ts` | PATCH — write reflection scores for a signal |
| `src/app/api/signals/deduplicate/route.ts` | POST — Gemini dedup pass + Supabase merges for evaluative signals |

### Components
| File | Purpose |
|------|---------|
| `src/components/Chat.tsx` | 3-tab panel (Chat/Synthesis/Reflect) + Sources via + menu |
| `src/components/Sources.tsx` | 4-phase ingest: upload/paste → classify → review → extract |
| `src/components/Canvas.tsx` | ReactFlow graph, node/edge rendering |
| `src/components/Inspector.tsx` | Node/edge editor + ProjectBrief panel (collapsible) |
| `src/components/OntologyNode.tsx` | Custom ReactFlow node component |
| `src/components/ProjectBrief.tsx` | Inline-editable brief + re-process button |
| `src/components/ScopingModal.tsx` | Full-screen Haiku scoping dialogue |
| `src/components/SynthesisResults.tsx` | Synthesis results display |
| `src/components/TypePalette.tsx` | Entity type filter bar above canvas |

### Library
| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | DB client + all CRUD (loadOntology, saveOntology, etc.) |
| `src/lib/claude.ts` | Claude Sonnet + tool use loop |
| `src/lib/gemini.ts` | Gemini: extraction + classification + synthesis |
| `src/lib/haiku.ts` | Haiku client: scoping dialogue only |
| `src/lib/tools.ts` | 9 graph tool definitions (add/delete/update nodes, edges, signals) |
| `src/lib/graph-state.ts` | Pure graph state mutation functions |
| `src/lib/entity-types.ts` | Entity type management (has UUID bug) |
| `src/lib/system-prompt.ts` | Dynamic system prompt builder (graph state → context) |
| `src/lib/export.ts` | Project bundle export as JSON (graph + synthesis + brief) |
| `src/lib/layout.ts` | Dagre auto-layout |
| `src/types/index.ts` | All TypeScript interfaces |

---

## Dev Server

```bash
cd ~/Terrior/terroir
npm run dev
# → localhost:3000
```

Or use the VS Code launch config (`terroir-dev`).

---

## Patterns & Gotchas

**Architecture**
- **Three-agent division:** Gemini = all document work (extract + classify + synthesise). Sonnet = chat + graph tools. Haiku = scoping dialogue only. Never cross these boundaries.
- **Abstraction layer is explicit:** three presets fed to Gemini — never default to "extract everything". Set in ProjectBrief, passed to every Gemini extraction call.
- **Signals live in Reflect tab only** — not on the canvas overlay, not in the Inspector. One source of truth.

**Data**
- **saveOntology ID interpolation:** NOT IN filter uses string-interpolated UUIDs — safe for UUIDs, watch if slug IDs ever contain special chars.
- **Reflect scores dual-write:** `/api/reflect` writes immediately (server-stamped `reflected_at`). `saveOntology` (debounced 800ms) also carries scores. Both are idempotent — no conflict.
- **Entity type UUID bug:** `entity_type_configs` upsert fails silently. Types rebuilt from graph nodes on load. Non-blocking.
- **Brief in `projects.metadata`:** no dedicated table — jsonb read-modify-write via `updateProjectMetadata()`.

**UI patterns**
- **Edit-on-blur:** all inline editors (Inspector, ProjectBrief) update local state on change, persist to Supabase on blur.
- **Sources always-mounted:** `<Sources />` renders with `display:none` when not active — preserves file queue state across tab switches.
- **Optimistic updates in Reflect tab:** `onSignalReflect` updates `graphState` immediately; API write is fire-and-forget with `.catch()`.

**Deployment**
- **Vercel timeout:** `/api/reprocess` and `/api/extract-gemini` both have `export const maxDuration = 300` — required for large documents. On Vercel Hobby the effective cap is lower, which is why extraction was also moved to non-thinking mode (see below).
- **Paste-text bypasses ingest:** enters pipeline at classify phase, skips `/api/ingest`. Same downstream flow.
- **Supabase migrations:** always paste the SQL directly into the Supabase SQL Editor — never reference the file path.

**Graph clarity**
- **Attractor filter includes neighbors:** When a TypePalette attractor filter is active, `filteredGraphState` in page.tsx includes matching nodes + their direct neighbors (not exclusive). Zone filter (Emergent) remains exclusive. Stats panel shows "X of Y entities" count.
- **Tensions resolve via graphState:** `handleTensionResolve` in page.tsx sets `tension.status = "resolved"` locally; `saveOntology` (debounced 800ms) persists it. No dedicated API route.
- **Signal dedup pattern:** Same as entity integration pass — Gemini groups near-duplicates in one call, `executeSignalMerges` in supabase.ts applies batch deletes + survivor update, API route at `POST /api/signals/deduplicate`.

**Cross-document integration**
- Integration runs AFTER all documents in a batch are extracted — it is Phase 5 of the Sources pipeline, not part of extraction
- Triggered manually via the "Run integration" button (violet panel, appears when ≥1 file is `done`)
- API route: `POST /api/integrate` — takes `{ projectId }`, returns `{ updatedGraph, result }`
- Three sequential mutation phases: (1) merge near-duplicate entities → (2) add cross-doc relationships → (3) correct attractor assignments
- Entity merges: survivor = entity with most existing relationships. Gemini provides canonical label + description. All rels + tension markers re-pointed to survivor, non-survivors deleted. Duplicate rels deduped after.
- After merges, non-survivor entity IDs are remapped to their survivors before phases 2 + 3 execute (Gemini's response uses pre-merge IDs)
- Compact payload: first 100 chars of description per entity to stay within context limits
- `thinkingBudget: 0` same as extraction — faster and reliable JSON

**Gemini extraction — known gotchas (debugged 2026-03-28)**
Bulk document extraction was silently returning 0 entities for 11/13 podcast transcripts. Three fixes were applied, in order:

1. **`maxDuration = 300` on `/api/extract-gemini`** — the route was missing it (only `/api/reprocess` had it). Without it, Vercel kills the function at the plan default (10s Hobby / 60s Pro) before Gemini responds.

2. **Remove `responseMimeType: "application/json"` from extraction calls** — Gemini 2.5 Flash (thinking model) silently returns `{}` or empty arrays when JSON mode is forced on long/complex prompts. The prompt already instructs plain JSON output. `stripJsonFences()` was added as a fallback to strip markdown code fences if Gemini wraps the response anyway. Classify and synthesis keep JSON mode (shorter prompts, works fine).

3. **Disable thinking for extraction: `thinkingConfig: { thinkingBudget: 0 }` inside `generationConfig`** — Gemini 2.5 Flash thinking mode runs a reasoning pass before generating output. For structured extraction this is slow (30–90s, exceeds Hobby timeout) and interferes with JSON output. Disabling thinking drops response time to 3–8s and produces consistent JSON. Classify and synthesis keep thinking enabled. Note: `thinkingConfig` must be nested inside `generationConfig`, not at the request body top level — the API returns a 400 otherwise.

---

## Phase History (compressed)

| Phase | Period | Status |
|-------|--------|--------|
| Phase 1 — Core graph editor | Mar 9–15 | ✅ Complete |
| Phase 2 — Haiku scoping + synthesis | Mar 16 | ✅ Complete |
| Phase 2.5 — PoC readiness (Gemini synthesis, 4-phase Sources, paste-text, export bundle) | Mar 18–20 | ✅ Complete |
| Phase 3 — Cloud deployment (Vercel, Share button, Realtime) | Mar 24 | ✅ Complete |
| Phase 3.5 — Reflect tab (signal rating, UI restructure, collapsible inspector) | Mar 26 | ✅ Complete |
| Phase 4 — Ontology scaffolding (attractor presets, emergent zone, nested ontologies) | Mar 27 | ✅ Complete |
| Phase 5 — Graph clarity (tensions visible, signal dedup, filter-first canvas) | Mar 29 | ✅ Complete |
| Phase 6 — PoC validation + demo prep | TBD | 🟥 Next |

---

## Workflow Rules (for Claude)

- **Start every session** by reading this file and the Current State section — don't assume
- **Before building anything** — confirm what's in scope with Max
- **After completing work** — update "Current State" in this file, then commit
- **Supabase migrations** — always show the SQL inline in the response, never just the filename
- **Commits** — use `/commit` skill; don't push without asking
- **Bug fixes** — count as their own commits, don't bundle with features
- **Always run `/review` before `/commit`** on non-trivial sessions — TypeScript won't catch async error-swallowing or DB/client divergence bugs. See `~/.claude/learnings/2026-03-29-review-before-commit-workflow.md`
