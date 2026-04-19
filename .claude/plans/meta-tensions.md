# Feature Implementation Plan — Meta Tensions

**Overall Progress:** `100%`

## TLDR
Surface cross-graph fault lines that only become visible by traversing the hub topology — not any single document. Uses somatic vocabulary (contracted / bracing / nervous) in a new Gemini pass. Stored as `tension_markers` with `scope: "cross-graph"`, displayed with the same red visual treatment, labelled distinctly in Inspector and Reflect tab.

## Critical Decisions
- **Scope field on existing table** — add `scope: "local" | "cross-graph"` to `tension_markers` rather than a new table. Keeps the data model minimal; all existing tension logic continues to work unchanged.
- **Hub topology as input, not raw documents** — the meta-tension pass reads the already-built topology payload + evaluative signals, not full document texts. Cheaper, faster, and forces reasoning at the hub level rather than re-reading prose.
- **Manual trigger, not automatic** — "Surface fault lines" button in the Synthesis tab. Meta-tensions are a deliberate reflection act, not part of every extraction run.
- **Hub nodes as anchors** — `relatedNodeIds` on cross-graph tensions point to hub nodes (already in the graph). No new node types needed; visual anchoring is free.
- **Somatic vocabulary is the prompt framing** — contracted / bracing / nervous as the three fault-line patterns Gemini looks for. Gold examples needed in the prompt.

## Tasks

- [x] 🟩 **Step 1: Data model — add scope to tension_markers**
  - [x] 🟩 Write migration SQL: `ALTER TABLE tension_markers ADD COLUMN scope TEXT NOT NULL DEFAULT 'local'`
  - [x] 🟩 Add `scope?: 'local' | 'cross-graph'` to `TensionMarker` type in `src/types/index.ts`
  - [x] 🟩 Update `saveOntology` in `supabase.ts` to write `scope` field on tension insert
  - [x] 🟩 Update `loadOntology` in `supabase.ts` to read `scope` field

- [x] 🟩 **Step 2: Meta-tension Gemini pass**
  - [x] 🟩 Add `buildMetaTensionPrompt` to `gemini.ts` — somatic vocabulary framing, hub-traversal input, 2–4 fault lines max, gold examples
  - [x] 🟩 Add `detectMetaTensions` function: builds topology payload, calls Gemini, returns `TensionMarker[]` with `scope: "cross-graph"`
  - [x] 🟩 Add `POST /api/meta-tensions` route — calls `detectMetaTensions`, replaces existing cross-graph tensions, saves to Supabase

- [x] 🟩 **Step 3: Synthesis tab trigger**
  - [x] 🟩 Add "Surface fault lines" button to Synthesis tab in `Chat.tsx` (below existing synthesis results)
  - [x] 🟩 Wire button to `POST /api/meta-tensions`, update `graphState` with returned tensions on success
  - [x] 🟩 Show loading state + result count ("3 fault lines surfaced")

- [x] 🟩 **Step 4: Inspector — cross-graph label**
  - [x] 🟩 In the tension list section of `Inspector.tsx`, render `Cross-graph` badge (same red, small) when `tension.scope === "cross-graph"`
  - [x] 🟩 Local tensions show no badge (current behaviour unchanged)

- [x] 🟩 **Step 5: Reflect tab — meta tensions section**
  - [x] 🟩 In `Chat.tsx` Reflect tab, split tension list into two groups: `Tensions` (local) and `Meta tensions` (cross-graph)
  - [x] 🟩 Meta tensions section shows below local tensions with a section header
  - [x] 🟩 Same resolve/note interaction as local tensions
