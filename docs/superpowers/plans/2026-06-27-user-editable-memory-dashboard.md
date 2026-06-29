# User-Editable Memory Dashboard (#533) Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task.

**Goal:** Build a user-editable memory dashboard inside Settings for reviewing/correcting candidates and graph memory records.

**Architecture:** New `dashboard-service.ts` + `dashboard-routes.ts` in `@jarv1s/memory`; shared schemas in `@jarv1s/shared`; React tabs UI extending `settings-memory-pane.tsx`. No migration needed — all tables exist from #528/#529/#532.

**Tech Stack:** Fastify routes, Kysely SQL, React + TanStack Query, vitest integration tests.

## Global Constraints

- `DataContextDb` only — no root Kysely in any dashboard path
- `AccessContext` = `{ actorUserId, requestId }` only
- FORCE RLS on all memory tables — no admin bypass
- No `isSensitive` from client payload; determine server-side
- No raw source ids / full bodies / secrets in any DTO, log, or payload
- Stage only task-specific files; no `git add -A`
- Co-Authored-By trailer on every commit
- `JARVIS_PGDATABASE=jarvis_build_rfa_533_memory_dashboard` for integration tests
- File-size gate: 1000-line cap on all source files

---

## Tasks

### Task 1 — Dashboard types + shared schemas

**Files:**

- Create: `packages/memory/src/dashboard-types.ts`
- Create: `packages/shared/src/memory-dashboard-api.ts`
- Modify: `packages/shared/src/index.ts` (export new schemas)
- Modify: `packages/memory/src/index.ts` (export new types + `registerMemoryDashboardRoutes`)

Define `MemoryDashboardItem`, `MemoryDashboardItemKind`, `MemoryDashboardResponse`, `MemoryDashboardQuery`, `AcceptMemoryCandidateRequest`, `RejectMemoryCandidateRequest`, `SuppressMemoryCandidateRequest`, `PatchMemoryFactDashboardRequest`, `PatchMemoryEntityDashboardRequest` exactly as in spec §4–5. Add Fastify JSON schemas for all 7 new routes. Commit green typecheck.

### Task 2 — Repository additions

**Files:**

- Modify: `packages/memory/src/candidates-repository.ts`
- Modify: `packages/memory/src/graph-repository.ts`

Candidates: add `markSuppressed(scopedDb, ownerUserId, id, reason)`, `getById(scopedDb, ownerUserId, id)`, `listForDashboard(scopedDb, ownerUserId, opts: { status?, limit, cursor? })` returning `{ items, nextCursor, counts }`.

Graph: add `listFactsForDashboard(scopedDb, ownerUserId, opts)`, `listEntitiesForDashboard(scopedDb, ownerUserId, opts)`, `patchFactLifecycle(scopedDb, ownerUserId, factId, patch: PatchMemoryFactDashboardRequest)` (updates search doc in same tx when active/stale/expired eligibility changes), `updateEntity(scopedDb, ownerUserId, entityId, patch)`, `forgetEntity(scopedDb, ownerUserId, entityId)` (→ 409 if any fact references entity), `forgetFactWithConflictCleanup(scopedDb, ownerUserId, factId)` (clears conflict group when last sibling).

Commit green typecheck.

### Task 3 — Dashboard service

**Files:**

- Create: `packages/memory/src/dashboard-service.ts`

`MemoryDashboardService` methods:

- `listDashboard(scopedDb, ownerUserId, query)` — assemble DTO from candidates + facts + entities; apply ordering from spec §9
- `acceptCandidate(scopedDb, ownerUserId, id, body)` — structured path (payloadJson has `kind`+`action`) → `createFactFromEpisode`/`createEntity`; manual path → `manualRememberHelper` (self entity + predicate from recordKind + confirmed provenance ≥ 0.90); mark promoted; create manual episode if `episodeId = null`
- `rejectCandidate(scopedDb, ownerUserId, id, body)` — `markRejected`
- `suppressCandidate(scopedDb, ownerUserId, id, body)` — `markSuppressed`

Helper `isStructuredCandidate(payloadJson)` — truthy when has valid `kind`/`action` fields. Helper `recordKindToPredicate(rk)` per spec §6. Commit green typecheck.

### Task 4 — Dashboard routes

**Files:**

- Create: `packages/memory/src/dashboard-routes.ts`

Export `registerMemoryDashboardRoutes(server, deps)`. Wire 7 routes:

| Route                                      | Handler summary                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/memory/dashboard`                | parse query, call `listDashboard`, return `MemoryDashboardResponse`        |
| `POST /api/memory/candidates/:id/accept`   | validate body (unknown top-level fields → 400), call `acceptCandidate`     |
| `POST /api/memory/candidates/:id/reject`   | call `rejectCandidate`                                                     |
| `POST /api/memory/candidates/:id/suppress` | call `suppressCandidate`                                                   |
| `PATCH /api/memory/graph/facts/:id`        | call `patchFactLifecycle`; 404 if missing                                  |
| `PATCH /api/memory/graph/entities/:id`     | call `updateEntity`; 403 if self entity; 409 if archived with active facts |
| `DELETE /api/memory/graph/entities/:id`    | call `forgetEntity`; 403 if self entity; 409 if facts exist                |

All routes: `resolveAccessContext` → `withDataContext`. Commit green typecheck.

### Task 5 — Integration tests

**Files:**

- Create: `tests/integration/memory-dashboard.test.ts`

Cover every acceptance criterion from spec §12. Key test cases:

- Dashboard returns candidates + active facts + entities for actor only (not user B's)
- Filter by status, kind, sourceKind, q
- Accept → fact active with confidence ≥ 0.90, provenance = confirmed, candidate = promoted
- Manual accept → self→predicate→objectText fact; manual episode created when episodeId null
- Accept with empty objectText → 400
- Reject → candidate = rejected, no new fact
- Suppress → candidate = suppressed
- PATCH fact lifecycle → search doc updated transactionally
- Conflict fact → generic status route returns 400; confirm/correct succeed
- Forget fact with conflict sibling → sibling conflict_group_id cleared, status = active
- Entity forget → 409 when any fact references it; 403 for self entity
- Entity PATCH → 403 for self entity; 409 archive with active facts
- DTO never includes raw source id (except as opaque string), no full source bodies

Run: `JARVIS_PGDATABASE=jarvis_build_rfa_533_memory_dashboard pnpm test:memory`

Commit green tests.

### Task 6 — Frontend client + query keys

**Files:**

- Modify: `apps/web/src/api/memory-client.ts` (add dashboard functions)
- Modify: `apps/web/src/api/query-keys.ts` (add `memory.dashboard`, `memory.dashboardItem`)

Add: `getMemoryDashboard(query)`, `acceptMemoryCandidate(id, body)`, `rejectMemoryCandidate(id, body)`, `suppressMemoryCandidate(id, body)`, `patchMemoryFact(id, body)`, `patchMemoryEntity(id, body)`, `deleteMemoryEntity(id)`. All call `requestJson`. Commit green typecheck.

### Task 7 — Dashboard UI

**Files:**

- Create: `apps/web/src/settings/settings-memory-dashboard.tsx` (≤ 950 lines)

Three-tab layout using existing `jds-*` primitives, `Group`, `Row`, `PaneHead` from `settings-ui`. Tabs: **Review Queue** (`status=pending`), **Memory Records** (`status=active`), **History** (`status=history`). Item row: statement, kind badge, confidence tier, status, provenance, source summary, updatedAt. Detail drawer: full lifecycle timestamps, conflict/supersession info, editable fields (summary, recordKind, validFrom, validTo, staleAt, pinned). Action buttons per item kind per spec §6–7.1. Forget: `useFeedback().confirm(...)` before mutating. Accept with edit: inline form in drawer. Commit after working UI.

### Task 8 — Wire into settings pane + unit tests

**Files:**

- Modify: `apps/web/src/settings/settings-memory-pane.tsx`
- Create: `tests/unit/settings-memory-dashboard.test.tsx`

Replace legacy pane body with `<MemoryDashboardPane />` (keep settings toggles at top). Unit tests: empty review queue render, item row render with kind/tier/status, forget confirmation dialog, accept drawer shows editable fields, self-entity hides destructive actions. Run `pnpm test:web`. Commit green.

### Task 9 — Final gate

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
JARVIS_PGDATABASE=jarvis_build_rfa_533_memory_dashboard pnpm test:memory
pnpm test:chat && pnpm test:web && pnpm test:api
git fetch origin main && git rebase origin/main
```

Record all exit codes. Then invoke `coordinated-wrap-up`.

---

## Collision Notes (from handoff)

- Do NOT modify `usefulness_feedback` table (#527 mid-build)
- Do NOT assume migration number; this spec needs NO migration
- `confidence_score`, `confirmed_at`, `needs_review`, `superseded_by` (#532) → already `confidence`, `lastConfirmedAt`, `conflictGroupId`, `supersededByFactId` in TypeScript
- Stage only `packages/memory/`, `packages/shared/`, `apps/web/`, `tests/` paths touched by each task
