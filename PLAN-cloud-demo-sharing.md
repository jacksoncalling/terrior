# Feature Implementation Plan — Cloud Deployment + Project Sharing

**Overall Progress:** `71%`

---

## TLDR

Deploy Terroir to Vercel so Max can demo it live to BracketLab and AmberSearch contacts. Add project sharing so a guest can open the same project URL in their browser during a call. Fix two known pre-deployment bugs first.

---

## Critical Decisions

- **Sharing model:** URL-based (`/?p=<projectId>`) — simplest possible sharing for a controlled demo. No auth, no invite flow. Anyone with the URL can read and write the project. Upgrade to auth/RLS after the demo.
- **Auth:** Skipped for the demo. Supabase anon key already gives full read/write. Sufficient for 1–2 trusted collaborators in a controlled session.
- **Real-time sync:** Supabase Realtime on `ontology_nodes` (Postgres change events). Echo suppression via `lastLocalSaveRef` — ignores events within 5s of a local save.
- **Deployment target:** Vercel (aligns with Next.js stack; env vars map directly).
- **Bug fixes shipped:** `maxDuration` fix + entity type upsert made non-fatal (requires SQL migration to fully fix).

---

## Tasks

- [x] 🟩 **Step 1: Fix Pre-Deployment Bugs**
  - [x] 🟩 Add `export const maxDuration = 300` to `src/app/api/reprocess/route.ts`
  - [x] 🟩 Make entity type upsert non-fatal in `src/lib/supabase.ts` + generate SQL migration (`supabase/migrations/001_entity_type_unique_constraint.sql`)

- [x] 🟩 **Step 2: Audit Supabase Schema**
  - [x] 🟩 `projects` table has no `user_id`/`owner_id` — no RLS, full anon access
  - [x] 🟩 Decision: skip auth for demo; use URL-based sharing with anon key
  - [x] 🟩 Schema is clean for direct sharing without migration

- [ ] 🟩 **Step 3: Auth (Skipped for demo)**
  - Deferred post-demo. URL sharing + anon key is sufficient for 1–2 trusted contacts.

- [x] 🟩 **Step 4: Project Sharing**
  - [x] 🟩 `src/lib/project-context.tsx` reads `?p=<id>` from URL on init — takes precedence over localStorage
  - [x] 🟩 Share button added to project name bar in `src/app/page.tsx` — copies `/?p=<projectId>` URL to clipboard
  - [x] 🟩 "Copied!" feedback state (2s timeout)

- [x] 🟩 **Step 5: Supabase Realtime Sync**
  - [x] 🟩 `useEffect` in `src/app/page.tsx` subscribes to `ontology_nodes` Postgres changes for current project
  - [x] 🟩 Echo suppression: skips reload within 5s of local save (`lastLocalSaveRef`)
  - [x] 🟩 SQL migration created: `supabase/migrations/002_enable_realtime.sql`
  - [x] 🟩 Channel cleanup on project switch / unmount

- [ ] 🟥 **Step 6: Deploy to Vercel**
  - [x] 🟩 `vercel.json` created (fra1 region, Next.js framework)
  - [ ] 🟥 Push repo to GitHub (if not already)
  - [ ] 🟥 Create Vercel project, connect repo
  - [ ] 🟥 Set env vars: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - [ ] 🟥 Run both SQL migrations in Supabase SQL editor
  - [ ] 🟥 Verify build passes + test reprocess with Babor data

- [ ] 🟥 **Step 7: Demo Preparation**
  - [ ] 🟥 Create demo project with internal search / AI agent use case (relevant to BracketLab / AmberSearch)
  - [ ] 🟥 Write 10-minute demo script: scoping → upload → classify → extract → synthesis → export
  - [ ] 🟥 Pre-ingest documents so demo can start from a populated graph as fallback
