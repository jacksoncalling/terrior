# Document Ingestion — Sessions 4 & 5 Plan

**Overall Progress:** `55%` — Session 4 backend complete, Session 5 UI remaining

## TLDR

Replace the brittle developer-only pipeline (manual scripts → JSON → import button) with an in-app **Document Inbox**: Anna Bergmann drops files or pastes text into Terroir, Gemini extracts the ontology, and the graph populates automatically. No CLI required.

## Critical Decisions

- **Ingestion model: Option A+D (file upload + paste text)**. No URL scraping (fragile, legal issues). No platform connectors (Phase 3+ scope). The realistic Anna Bergmann workflow is: export from source → drop into Terroir. This covers 90% of real use.
- **File formats: PDF, DOCX, TXT, MD, JSON**. Use `pdf-parse` (MIT, lightweight) for PDFs, `mammoth` for DOCX, plain read for text/markdown. JSON covers pre-extracted ontologies and platform exports.
- **Extraction engine: Gemini 2.5 Flash for bulk docs, existing Claude Sonnet for conversational/small text**. Gemini is ~10x cheaper and handles large context windows well. Claude stays for the interactive chat loop.
- **Dual output: ontology extraction + document storage**. Uploaded docs feed both the graph (via Gemini extraction) AND the vector store (via chunking + embedding) so Compare/Search works on the same corpus.
- **UI surface: new "Sources" tab in left panel** alongside Chat and Extract. Keeps the 3-panel layout intact, doesn't pollute the conversation UI.
- **Session 4 scope: backend only** (API routes + utilities). Session 5: UI + integration + verification.

## Risks

- **PDF parsing quality varies.** Scanned PDFs won't extract text — only digital/text PDFs work. Display a clear message when extraction yields no content.
- **Gemini rate limits.** Flash tier has generous limits but large batches (50+ docs) may hit them. Build with single-doc processing, batch later.
- **Entity type UUID bug must be fixed first.** If entity types can't persist to Supabase, extraction results with new types will silently fail on save. This is the prerequisite.
- **Supabase schema: no changes needed.** `documents` and `document_chunks` tables already have `project_id` columns. `ontology_nodes` + `ontology_relationships` already support the output format.
- **Large file uploads.** Next.js API routes have a default body size limit (~4MB). Need to configure `next.config.ts` for larger uploads or use streaming.

## Tasks

### Session 4: Backend Infrastructure

- [x] 🟩 **Step 1: Fix entity type UUID bug (prerequisite)**
  - [x] 🟩 Root cause was in `src/lib/supabase.ts` not `entity-types.ts` — schema has `type_id text` column, `id` is auto-UUID PK
  - [x] 🟩 `loadOntology`: maps `row.type_id` → `EntityTypeConfig.id` (was `row.id`)
  - [x] 🟩 `saveOntology`: sends `type_id: et.id`, `onConflict: 'project_id,type_id'` (was `id: et.id`, `onConflict: 'id'`)
  - [x] 🟩 `saveOntology` delete: filters by `type_id` not `id`

- [x] 🟩 **Step 2: Gemini API client**
  - [x] 🟩 Created `src/lib/gemini.ts` — Gemini 2.5 Flash REST wrapper
  - [x] 🟩 `extractOntologyWithGemini(text, graphState)` — generic prompt, same output shape as `extract.ts`
  - [x] 🟩 Full deduplication, label→id resolution, handles entities/relationships/tensions/signals

- [x] 🟩 **Step 3: Document parser utility**
  - [x] 🟩 Created `src/lib/document-parser.ts`
  - [x] 🟩 `parseDocument(buffer, filename, mimeType?)` → `{ title, content, isEmpty }`
  - [x] 🟩 Supports: PDF (pdf-parse), DOCX (mammoth), TXT, MD, JSON (GraphState + generic)
  - [x] 🟩 `isEmpty` flag for scanned PDFs — caller shows clear error message

- [x] 🟩 **Step 4: Document ingest API route**
  - [x] 🟩 Created `src/app/api/ingest/route.ts`
  - [x] 🟩 Accepts `multipart/form-data` with `file` + `projectId`
  - [x] 🟩 Flow: parse → chunk → embed → save to `documents` + `document_chunks`
  - [x] 🟩 `next.config.ts` updated: `serverActions.bodySizeLimit: "20mb"`

- [x] 🟩 **Step 5: Gemini extraction API route**
  - [x] 🟩 Created `src/app/api/extract-gemini/route.ts`
  - [x] 🟩 Accepts `{ text, graphState, projectId }` — same shape as `/api/extract`
  - [x] 🟩 Logs session to Supabase (agent: `gemini`, type: `extraction`)

- [x] 🟩 **Step 6: Ingest script project scoping**
  - [x] 🟩 `scripts/ingest.mjs` now accepts `--project <uuid>` flag
  - [x] 🟩 Sets `project_id` on documents and chunks when flag is present
  - [x] 🟩 Usage: `node scripts/ingest.mjs babor-raw --project <uuid>`

### Session 5: UI + Integration + Verification

- [ ] 🟥 **Step 7: Sources tab component**
  - [ ] 🟥 Create `src/components/Sources.tsx` — file upload zone (drag & drop + click to select)
  - [ ] 🟥 Shows list of ingested documents for current project (from Supabase `documents` table)
  - [ ] 🟥 Upload triggers: parse → ingest → extract → graph merge (sequential pipeline)
  - [ ] 🟥 Progress indicator per document (uploading → parsing → extracting → done)
  - [ ] 🟥 Also accepts paste-as-text (same as current Extract mode, but routed through Gemini)

- [ ] 🟥 **Step 8: Wire Sources tab into main page**
  - [ ] 🟥 Update `src/app/page.tsx` — add "Sources" as third mode alongside Chat/Extract in left panel
  - [ ] 🟥 On extraction complete: merge returned nodes/relationships into canvas graph state
  - [ ] 🟥 Auto-layout after merge (existing `autoLayout()`)

- [ ] 🟥 **Step 9: End-to-end verification**
  - [ ] 🟥 Test: upload a PDF → verify document stored in Supabase with correct `project_id`
  - [ ] 🟥 Test: verify Gemini extraction produces graph nodes on canvas
  - [ ] 🟥 Test: navigate to Compare page → verify uploaded doc appears in search results
  - [ ] 🟥 Test: navigate back to canvas → verify graph persists (the nav bug fix)
  - [ ] 🟥 Test: switch projects → verify document isolation

---

## File Map (what gets created / modified)

| Action | File |
|--------|------|
| **Create** | `src/lib/gemini.ts` |
| **Create** | `src/lib/document-parser.ts` |
| **Create** | `src/app/api/ingest/route.ts` |
| **Create** | `src/app/api/extract-gemini/route.ts` |
| **Create** | `src/components/Sources.tsx` |
| **Modify** | `src/lib/entity-types.ts` (UUID fix) |
| **Modify** | `src/app/page.tsx` (Sources tab) |
| **Modify** | `scripts/ingest.mjs` (--project flag) |
| **Modify** | `next.config.ts` (body size limit) |
| **Modify** | `package.json` (add pdf-parse, mammoth) |
