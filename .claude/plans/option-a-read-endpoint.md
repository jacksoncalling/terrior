# Feature Implementation Plan: Terroir Public Read Endpoint

**Overall Progress:** `100%`

## TLDR
A single `GET /api/export?projectId=xxx` route on Vercel that returns the full project JSON bundle. Any agent (Mistral, Claude Code, Cursor, curl) calls one URL, gets the complete graph — nodes, signals, hubs, tensions, brief. No local server, no credentials, always current. Reuses everything that already exists.

## Critical Decisions
- **GET not POST** — it's a read, semantically correct, and simpler for agents to call (no request body needed)
- **No auth for demo phase** — URL param sharing pattern; `projectId` in the query string is the access gate for now, consistent with how Terroir already shares projects
- **`synthesisResult: null`** — synthesis lives in localStorage, not Supabase; it won't be in the bundle. Acceptable — all graph data is present
- **CORS open** — `Access-Control-Allow-Origin: *` so any agent, any origin, any platform can call it without preflight issues

---

## Tasks

- [x] 🟩 **Step 1: Create `GET /api/export` route**
  - [x] 🟩 New file `src/app/api/export/route.ts`
  - [x] 🟩 Read `projectId` from query params — return 400 if missing
  - [x] 🟩 Call `getProject(projectId)` + `loadOntology(projectId)` in parallel
  - [x] 🟩 Return 404 if project not found
  - [x] 🟩 Build bundle via existing `buildProjectBundle()`, return as JSON
  - [x] 🟩 Add `Access-Control-Allow-Origin: *` header on the response
  - [x] 🟩 Add `export const maxDuration = 60` for large projects
  - [x] 🟩 Wrap in try/catch — return `{ ok: false, error }` on failure, no stack traces

- [x] 🟩 **Step 2: Smoke test + commit**
  - [x] 🟩 `GET /api/export` (no projectId) → `{ ok: false, error: "projectId query parameter is required" }` (400)
  - [x] 🟩 `GET /api/export?projectId=<invalid-uuid>` → `{ ok: false, error: "Project not found" }` (404)
  - [x] 🟩 CORS header `Access-Control-Allow-Origin: *` confirmed present on all responses
  - [x] 🟩 TypeScript clean (zero errors)
  - [x] 🟩 Committed + pushed to Vercel
