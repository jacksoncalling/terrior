# PoC Readiness — Implementation Plan

**Overall Progress:** `60%`

## TLDR
Ship the minimum features needed to run a PoC with a real consulting partner (BracketLab or Amber Search). Five additions: paste-text input for wiki/Confluence content, combined export (ontology + synthesis as structured JSON), a guided upload checklist, a validation experiment with Babor data, and a demo script.

## Critical Decisions
- **Export format: JSON, not PDF** — JSON is machine-readable (agents can consume it), and we already have the serialization infrastructure. A consultant can paste JSON into any report tool. PDF is cosmetic and adds a dependency (puppeteer/react-pdf).
- **Paste-text lives in Sources tab** — not a separate route. Pasted content joins the same classify → extract pipeline as uploaded files.
- **Guided checklist is UI-only** — no new API. It's a collapsible helper panel in Sources that tells the consultant what to prioritize. Zero backend work.
- **Experiment before building more** — validate the "aha" threshold with Babor data before adding features nobody asked for.

---

## Tasks

- [x] 🟩 **Step 1: Paste-Text Input in Sources**
  - [x] 🟩 Add a "Paste text" toggle/tab alongside the file drop zone in `Sources.tsx`
  - [x] 🟩 Textarea with title field — user pastes content + gives it a name
  - [x] 🟩 "Add" button creates a synthetic `SourceFile` (status: `"queued"`, content stored in state)
  - [x] 🟩 `enqueuePastedText()` skips `/api/ingest`, goes directly to classify with raw text
  - [x] 🟩 Pasted docs flow through the same classify → review → extract pipeline as uploaded files

- [x] 🟩 **Step 2: Combined Export (Ontology + Synthesis)**
  - [x] 🟩 Created `buildProjectBundle()` + `downloadProjectBundle()` in `src/lib/export.ts`
  - [x] 🟩 "Bundle ↓" button added to bottom actions bar in `page.tsx` (next to existing Export)
  - [x] 🟩 Downloads `terroir-{projectName}-{date}.json` with graph + synthesis + brief + stats
  - [x] 🟩 Includes `schema_version: "1.0"` field for forward compatibility

- [x] 🟩 **Step 3: Guided Upload Checklist**
  - [x] 🟩 Collapsible "What to upload" panel in Sources tab (visible when no files loaded)
  - [x] 🟩 Prioritised list: process docs → org charts → meeting notes → strategy docs
  - [x] 🟩 Source-specific tips: Confluence, SharePoint, Google Drive, Notion, wiki/paste
  - [x] 🟩 Panel auto-collapses once first file is added

- [ ] 🟥 **Step 4: Validation Experiment (Babor Data)**
  - [ ] 🟥 Run 3 batches through Terroir: 5 operational docs, 15 mixed docs, all 44 docs
  - [ ] 🟥 For each batch: capture synthesis output, count term collisions, connecting threads, graph gaps
  - [ ] 🟥 Document the "aha" threshold — at what batch size does synthesis reveal something non-obvious?
  - [ ] 🟥 Record findings in a short writeup (what worked, what didn't, minimum viable corpus size)

- [ ] 🟥 **Step 5: 10-Minute Demo Script**
  - [ ] 🟥 Write a step-by-step walkthrough: scoping → upload → classify → extract → synthesis → export
  - [ ] 🟥 Identify 3 "wow moments" to highlight (classification filtering noise, term collisions, graph gaps as interview questions)
  - [ ] 🟥 Time each step — ensure full flow fits in 10 minutes with pre-loaded data
  - [ ] 🟥 Prepare a backup project with pre-ingested Babor data for demo reliability

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/Sources.tsx` | Upload/Paste mode toggle, `enqueuePastedText()`, guided checklist, paste icon on file cards |
| `src/lib/export.ts` | **NEW** — `buildProjectBundle()`, `downloadProjectBundle()`, `ProjectBundle` interface |
| `src/app/page.tsx` | Import export utils, `handleExportBundle()`, "Bundle ↓" button in actions bar |
| `src/lib/supabase.ts` | Added `"classification"` to `SessionType` union (fixes pre-existing type error) |
