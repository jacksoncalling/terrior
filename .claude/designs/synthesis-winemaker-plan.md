# Feature Implementation Plan — Synthesis: The Winemaker's Reading

**Overall Progress:** `100%`

## TLDR
Replace Terroir's mechanical synthesis output with a winemaker persona — an interpretive
listener that opens with a meta-observation about the organisation's attention pattern
(`soil_note`), then presents the knowledge map as supporting evidence, and closes with
a single traversal invitation that lights up relevant nodes on the canvas.

## Critical Decisions
- **Gemini, not Sonnet, runs synthesis** — the persona and soil_note live in `src/lib/gemini.ts` (line ~829), not in the Sonnet system prompt
- **soil_note is a new output field** — added to the Gemini prompt schema and the `SynthesisResult` TypeScript type; null when no clear pattern is present
- **soil_note leads the UI** — rendered before the four existing sections, in a distinct visual register (not a section header, not a card)
- **Invitation replaces the Graph Gaps list** — surface one gap as a question only; the most generative one. Node names returned by Gemini are used to trigger canvas highlight
- **Node highlight via shared state** — synthesis sets highlighted node IDs via a callback prop; the canvas reads from a lifted state in the parent (no new context needed)

## Tasks

- [x] 🟩 **Step 1: Winemaker persona + soil_note in Gemini**
  - [x] 🟩 Rewrite synthesis system prompt in `src/lib/gemini.ts` (~line 829) with winemaker persona framing
  - [x] 🟩 Add `soil_note: string | null` to the synthesis JSON output schema in the prompt
  - [x] 🟩 Add `invitation_question: string | null` and `invitation_node_names: string[]` to the output schema (Gemini picks the one most generative gap)

- [x] 🟩 **Step 2: Type + API route update**
  - [x] 🟩 Add `soilNote`, `invitationQuestion`, `invitationNodeNames` to `SynthesisResult` in `src/types/index.ts`
  - [x] 🟩 Updated log summary in `src/app/api/synthesis/route.ts` to include new fields

- [x] 🟩 **Step 3: SynthesisResults.tsx UI redesign**
  - [x] 🟩 **Opening** — `soilNote` rendered first, alone, in italic light type before all sections
  - [x] 🟩 **Map** — four sections kept, visually subordinate (narrative summary reduced to text-[10px])
  - [x] 🟩 **Invitation** — `InvitationBlock` component with question + node chips + "Show all" + "Ask in Chat →"

- [x] 🟩 **Step 4: Node highlight bridge**
  - [x] 🟩 `onHighlightNodes` prop on `SynthesisResults`, threaded through `Chat.tsx`
  - [x] 🟩 `highlightedNodeNames` state lifted to `page.tsx`
  - [x] 🟩 `synthesisHighlightedNodeNames` prop on `Canvas`; overlay memo applies amber glow to matching nodes
  - [x] 🟩 `onClearSynthesisHighlight` called in `handlePaneClick` — clears on canvas click
  - [x] 🟩 Amber `animate-pulse` ring applied in both `OntologyNode` and `CompactNode`
