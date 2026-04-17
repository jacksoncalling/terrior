# Plan — Filesystem Export (Terroir → Markdown Folder)

> Author: Opus (strategy session, 2026-04-17)
> Target executor: Sonnet
> Status: Ready for execution
> Estimated scope: 1 afternoon (v1, no git push)

---

## Conversation summary (for the next agent)

Joshua is preparing an April 21 demo with **Matthias** — owner of **eoniq**, a 2-person startup in car-shipping logistics coordination. Matthias has 20+ years of domain expertise largely in his head. His developer colleague has 15+ years experience and they're a tight team. They use **Mistral agents**.

The demo evolved from "show him Terroir" to a **retro-style workshop** where Matthias + dev externalize tacit knowledge into a Terroir graph, with the developer's Mistral agent then reading that graph for domain context.

### Strategic frame (read these before touching code)
1. **Meta-Harness paper (Stanford)** — harnesses drive 6× performance gap; one harness transfers across 5 models for +4.7pt lift. Implication: **Terroir is the transferable asset**, the Canal/Genau harness is commoditizing. Terroir is the moat.
2. **John Cutler — Single-Player to Multiplayer AI** (in `~/Documents/Obsidian/Clean Slate/sources/`). Core diagnosis: this is an **Opportunity problem, not a Motivation problem**. Infrastructure for shared AI work doesn't exist. Cutler's highest-leverage intervention: *"make sharing a byproduct, not an additional task."* Terroir + Canal is exactly the infrastructure Cutler says doesn't exist.
3. **Bracketlab origin story** — Joshua's original impulse for Terroir came from watching 6 teams in a 35-person AI-native startup drift apart. "Economy of scope" across projects was the vision. The 2-person eoniq case is the **minimum viable multiplayer case** — not a compromise, a clean test.
4. **Team world model thesis** — Canal + Terroir should support teamwork first via a shared alive world model + guided workshop. The sharpest value prop: **reducing the context-maintenance tax** when team members each run agents and have to keep themselves + their agents + each other in sync.

### Architectural decision this plan implements
Hybrid — **Supabase stays the source of truth**, filesystem becomes a **projection**. Inspired by InfraNodus's pattern (canonical Postgres + many distribution surfaces: REST, MCP, n8n, Make). One-way export (DB → files) for the experiment. Reverse sync and MCP server are deferred to later phases.

Agents of any kind (Mistral CLI, Claude Code, Cursor, browser tools) read the folder via filesystem primitives. Writes still go through Terroir web UI / Canal — this is a feature, not a limitation (curated surface where stewardship happens).

### What Joshua asked for now
Build the export endpoint and file format. He will clone the result into a git repo, point Matthias's dev's Mistral at it during the workshop, and measure whether the domain graph carries meaning outside Terroir's web UI.

### Out of scope in this plan
- Reverse sync (files → DB)
- Git push automation (v1 writes to a local folder; Joshua commits + pushes manually)
- MCP server
- Live collaboration / file watching
- Real-time conflict resolution
- Self-hosted Gitea (DSGVO story — later phase)

---

## Goal

Produce a `/api/export-to-files` endpoint that serialises a Terroir project from Supabase into a markdown folder structure an agent can read with filesystem tools alone. Zero lock-in — if the experiment fails, delete the endpoint; Terroir is byte-identical to today.

---

## File format specification

### Folder structure

```
<output-root>/
└── <project-slug>/
    ├── README.md                        # Project brief + graph summary
    ├── _meta/
    │   ├── export.json                  # Full machine-readable mirror (fidelity)
    │   └── schema-version.txt           # "1.0"
    ├── hubs/
    │   └── <hub-slug>.md                # Nodes with is_hub=true
    ├── nodes/
    │   └── <node-slug>.md               # Regular entities
    ├── signals/
    │   └── <signal-slug>.md             # Evaluative signals
    └── tensions/
        └── <tension-slug>.md            # Tension markers (if any)
```

**Slug rules:** lowercase, hyphenated, ASCII. Collisions resolved by appending `-<short-uuid>`. Keep the full UUID in frontmatter `id` field for round-trip fidelity.

### `README.md` (project root)

```markdown
---
id: <project-uuid>
name: "eoniq team memory"
parent_project_id: null
attractor_preset: startup
schema_version: "1.0"
exported_at: "2026-04-17T14:22:00Z"
---

# eoniq team memory

<!-- From projects.metadata.brief.summary -->
Brief summary paragraph.

## Discovery goal
<!-- From projects.metadata.brief.discoveryGoal -->

## Key themes
<!-- From projects.metadata.brief.keyThemes (array) -->
- Theme one
- Theme two

## Graph summary
- Hubs: 5
- Nodes: 47
- Signals: 12
- Tensions: 2
- Relationships: 89

## Attractor distribution
- expertise: 18
- aspiration: 8
- (etc.)
```

### Node file — `nodes/<slug>.md` or `hubs/<slug>.md`

```markdown
---
id: <node-uuid>
label: "Car shipping logistics"
slug: car-shipping-logistics
type: domain
attractor: expertise
hub: domain                    # slug of primary hub (from belongs_to_hub)
is_hub: false
position: { x: 120, y: 340 }
created_at: "2026-04-17T..."
updated_at: "2026-04-17T..."
relationships:
  - target: customs-compliance
    target_id: <uuid>
    type: depends_on
    description: "Shipping requires customs clearance for each border"
  - target: matthias
    target_id: <uuid>
    type: known_by
    description: null
---

# Car shipping logistics

<!-- From ontology_nodes.description, free-form markdown -->
Coordinating multi-leg international car shipments including customs, carrier selection, and handover logistics.

## Related
- [[customs-compliance]]
- [[matthias]]

## Signals touching this node
- [[response-time-is-critical]]
```

**Notes for implementer:**
- Hub nodes go in `hubs/`, non-hub in `nodes/`. Determined by `is_hub`.
- `relationships` in frontmatter lists *outgoing* edges from this node. Do not duplicate on the target node — that would be a maintenance nightmare. Agents resolve bidirectionally by reading both ends if needed. Keep this rule explicit in a comment.
- `hub` field is the slug of the hub node this node belongs to via `belongs_to_hub` relationship. If multiple hubs, take the first; flag with a comment if ambiguous.
- `[[wikilinks]]` in markdown body are rendered from relationships for human legibility. They are **derived**, not source. The frontmatter `relationships` array is authoritative.

### Signal file — `signals/<slug>.md`

```markdown
---
id: <signal-uuid>
label: "Response time is critical"
slug: response-time-is-critical
direction: positive               # positive | negative | ambivalent
strength: 4                       # 1-5
relevance_score: 5                # 1-5 (from Reflect tab)
intensity_score: 4                # 1-5
temporal_horizon: operational     # operational | tactical | strategic | foundational
source_description: "Matthias said customers expect sub-2-hour response"
reflected_at: "2026-04-15T..."
user_note: "This is table stakes for logistics"
related_nodes:
  - car-shipping-logistics
  - customer-experience
related_node_ids:
  - <uuid>
  - <uuid>
---

# Response time is critical

Matthias said customers expect sub-2-hour response. This is table stakes for logistics.

## Touches
- [[car-shipping-logistics]]
- [[customer-experience]]
```

### Tension file — `tensions/<slug>.md`

```markdown
---
id: <tension-uuid>
status: unresolved                # unresolved | resolved
between_nodes:
  - car-shipping-logistics
  - team-bandwidth
between_node_ids:
  - <uuid>
  - <uuid>
created_at: "..."
---

# Tension: Car shipping logistics ↔ Team bandwidth

<!-- From tension_markers.description -->
Scaling domain breadth requires more hands; current team is 2.
```

### `_meta/export.json`

A full machine-readable dump of the project (same shape as the existing JSON export at [src/lib/export.ts](../../src/lib/export.ts)) — guarantees lossless round-trip even if the markdown format drops something. Agents that prefer structured data (or future reverse-sync) read this.

---

## Implementation steps

### 1. Create the serializer library
**File:** `src/lib/export-filesystem.ts` (new)

**Public API:**
```ts
export async function exportProjectToFilesystem(
  projectId: string,
  outputRoot: string
): Promise<ExportResult>;

type ExportResult = {
  projectSlug: string;
  filesWritten: string[];
  counts: { hubs: number; nodes: number; signals: number; tensions: number };
  exportedAt: string;
};
```

**Internal helpers:**
- `slugify(label: string, existingSlugs: Set<string>, fallbackId: string): string`
- `serializeNode(node, allRels, hubLookup): string` — returns markdown string
- `serializeSignal(signal, nodeLookup): string`
- `serializeTension(tension, nodeLookup): string`
- `serializeProjectReadme(project, graphSummary): string`

**Reuse existing code:**
- `loadOntology(projectId)` from [src/lib/supabase.ts](../../src/lib/supabase.ts) — gives you nodes + relationships + tensions + signals in one call
- `buildProjectBundle(...)` from [src/lib/export.ts](../../src/lib/export.ts) — source of truth for the JSON mirror; reuse for `_meta/export.json`

**Directory handling:**
- Before writing, wipe the project's output folder (`fs.rm(path, { recursive: true, force: true })`) then recreate. This guarantees stale files from a prior export don't linger. Critical: only wipe inside `<outputRoot>/<projectSlug>/`, never the `outputRoot` itself.

**Use node:fs/promises**, not sync. Use `path.join`, never string concat.

### 2. Create the API endpoint
**File:** `src/app/api/export-to-files/route.ts` (new)

**Spec:**
```
POST /api/export-to-files
Body: { projectId: string, outputRoot?: string }
  outputRoot defaults to process.env.TERROIR_EXPORT_ROOT
  or <repo-root>/exports/
Returns: { ok: true, result: ExportResult } | { ok: false, error: string }
```

Add `export const maxDuration = 60` — large projects with many nodes can take a moment.

Wrap the serializer in try/catch and return structured errors (don't leak stack traces to the client).

### 3. Add a UI trigger
**File:** `src/components/Inspector.tsx` (existing)

Add a button in the project-level view (when nothing is selected, below the graph summary). Label: **"Sync to filesystem"**. Show loading state. On success, toast "Exported N files to <path>" with the output path. On error, show the message.

Track last sync in component state — optional: persist to localStorage keyed by project id, display "Last synced: 2 minutes ago".

### 4. Environment config
Add to `.env.local.example` (if it exists) or document in [CLAUDE.md](../../CLAUDE.md):
```
TERROIR_EXPORT_ROOT=/absolute/path/to/exports
```
Default behaviour when unset: `<repo-root>/exports/`.

### 5. Smoke test
Manual test flow — no unit tests required for this experiment:
1. Open a project with ≥5 nodes, ≥1 signal, ≥1 tension
2. Click "Sync to filesystem"
3. Verify folder structure matches spec
4. Open a few `.md` files in a plain editor — frontmatter valid YAML, body readable
5. Verify `_meta/export.json` matches existing JSON export output
6. Re-run export — confirm stale files removed (add a node, export, delete node in UI, re-export, confirm old file gone)
7. Have Claude Code (or another agent with filesystem access) read one of the node files and summarise it — the test that matters

### 6. Commit
Use `/commit` skill. Single commit titled `feat: filesystem export endpoint + markdown projection`. Don't bundle with unrelated changes.

---

## Risks / decisions the executor may need to resolve

1. **Slug collisions with nodes across hubs.** Two nodes labelled "Customer" in different hubs. Resolution: slug per-folder, so `hubs/customer.md` and `nodes/customer.md` can coexist but two nodes in `nodes/` cannot. Fall back to `customer-<short-uuid>` on collision within same folder.

2. **Node with no primary hub.** If `belongs_to_hub` relationship is missing (legacy data?), put it in `nodes/` with `hub: null`. Don't error — log a warning.

3. **Multi-hub nodes.** If a node has `belongs_to_hub` to more than one hub, the `hub` frontmatter field is the first one alphabetically by slug, and a `hubs: [hub-a, hub-b]` array field is added. Pick one; prefer consistency over cleverness.

4. **Legacy NOT NULL mirror columns in Supabase** — this is a read operation, not writing to DB, so doesn't apply here. Noted for awareness.

5. **Position data in filesystem view is noise.** Keep it in frontmatter for round-trip fidelity, but don't render it in the markdown body. Agents reading for meaning will ignore frontmatter they don't understand.

6. **Large descriptions with code fences / YAML-breaking chars.** Use a YAML library (`js-yaml`) to serialise frontmatter — do not hand-template. Never include user-controlled text in a hand-rolled YAML string.

7. **Concurrency.** If two users click "Sync to filesystem" simultaneously, the wipe-then-write pattern races. For v1, accept this — document as a known limitation. Real fix is a lock file or atomic rename, v2 territory.

---

## Definition of done

- `POST /api/export-to-files` with valid `projectId` writes the folder structure to disk
- All four file types (project README, hub, node, signal) are produced with correct frontmatter and body
- `_meta/export.json` present and valid
- Inspector button triggers the export and reports success/failure
- A second export of the same project cleanly overwrites the previous one
- An external agent (Claude Code with filesystem access) can read a node file and accurately summarise it in one turn

Stop here. Do not build git integration, file watchers, or reverse sync. Those are separate plans.
