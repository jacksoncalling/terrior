# Feature Implementation Plan — UI Improvements

**Overall Progress:** `33%`

## TLDR
Three independent UI fixes: (1) signal labels expand on click so full text is readable, (2) resizable chat/canvas panel splitter for flexible layout, (3) blank canvas after reprocess — already fixed.

## Critical Decisions
- **Expand-on-click over tooltip** — full label + at_cost_of shown inline on card expand; keeps the list scannable by default
- **CSS resize over JS drag** — use a draggable divider with `mousedown` tracking in page.tsx; simpler than a third-party library
- **autoLayout on reprocess** — same pattern already used in the chat handler; one-line fix

## Tasks

- [x] 🟩 **Step 1: Fix blank canvas after reprocess**
  - [x] 🟩 In `page.tsx` reprocess handler, apply `autoLayout(result.updatedGraph)` before `setGraphState` — same as chat handler already does
  - [x] 🟩 Also apply in `handleGraphUpdate` so Sources integration + meta-tensions don't leave blank canvas

- [ ] 🟥 **Step 2: Signal label expand on click (Option 2)**
  - [ ] 🟥 Add `expandedId: string | null` state to the Reflect tab in `Chat.tsx`
  - [ ] 🟥 On `SignalCard` click, toggle expanded state for that signal
  - [ ] 🟥 When expanded: show full label (wrapped, no truncation) + `at_cost_of` if present + `sourceDescription` excerpt (first 120 chars)
  - [ ] 🟥 When collapsed: existing truncated single-line label
  - [ ] 🟥 Smooth height transition with `transition-all` on the card

- [ ] 🟥 **Step 3: Resizable panel splitter (Option 3)**
  - [ ] 🟥 Add `chatWidth` state to `page.tsx` (default 360px, min 260px, max 560px)
  - [ ] 🟥 Render a 4px drag handle div between chat panel and canvas
  - [ ] 🟥 `onMouseDown` on handle → track `mousemove` on `document` → update `chatWidth`
  - [ ] 🟥 `onMouseUp` → remove listeners; store last width in `localStorage` so it persists across reloads
  - [ ] 🟥 Apply `chatWidth` as inline `width` on the chat panel (replacing the hardcoded `w-[360px]`)
  - [ ] 🟥 Drag handle shows a subtle visual affordance (two vertical dots, visible on hover)
