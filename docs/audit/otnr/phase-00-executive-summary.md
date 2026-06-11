## Phase 0 — Executive Summary

THERMO-NUCLEAR code-quality review of Jarv1s — executive synthesis across all 29 phase
findings (Phases 1–29). Zero CRIT findings were raised in any phase; the audit is
HIGH/MED-heavy. The codebase passes every mechanical gate (file-size, `as any`,
`BYPASSRLS`, cross-module imports, console) and has a genuinely strong RLS test suite. The
recurring theme is *defense-in-depth-by-convention*: several CRIT-class invariants
(metadata-only payloads, DataContextDb-only, private-by-default) are upheld today only by
discipline at each call site rather than enforced structurally, and a cluster of dead
"workspace"/"resource_grants" scaffolding survives the house-model migration.

### 1. Dimension grades

| Dimension      | Grade | Rationale |
| -------------- | ----- | --------- |
| Security       | **B** | RLS+FORCE everywhere, NOBYPASSRLS roles, secrets encrypted-at-rest and proven not to escape (P1/P27/P26). Pulled down by: bearer-token backdoor (P2), zero rate-limiting on AI/chat/MCP cost surfaces (P3/P23), settings raw-Kysely admin surface with no RLS backstop (P18), dead resource-grants admin path that silently no-ops (P18). |
| Architecture   | **B** | Clean module isolation, thin composition root, canonical route/data-context patterns. Pulled down by: dead workspace subsystem persisting post-Slice-1f (P4/P6/P18/P22), unwired modules (structured-state P17), registry enforces nothing it aggregates (P20). |
| Code Quality   | **B** | Under 1000 lines everywhere, no `as any`, single TODO in tree (P28). Pulled down by: `handleRouteError`-collapse-to-401 duplicated across calendar/email/notifications (P13/P14/P16), test-only writers shipped in prod repos (P13/P14), bespoke duplicated schema fragments (P22). |
| TypeScript     | **B** | Zero `as any`/`@ts-ignore` (one justified `@ts-expect-error`). Pulled down by: `as unknown as Record` casts at the metadata-only payload boundary (P28), open `Record<string,unknown>`/`unknown` SDK contracts (P21), non-null assertions in chat routes (P28). |
| Tests          | **B** | RLS cross-user isolation and secret-never-escape genuinely and broadly tested against real Postgres roles (P26). Pulled down by: cross-test `app.shares` contamination (P26), no negative INSERT WITH-CHECK tests (P26), e2e auth always-admin/always-succeed (P29), approve/deny e2e never checks payload (P29). |
| Standards      | **A−** | Mechanical sweep is exceptionally clean (P28): zero size violations, zero forbidden patterns, zero cross-module internal imports, one tracked TODO. Only residual cast/env-locality smells remain. |

### 2. CRIT findings

**None.** No CRIT-severity finding was raised in any of Phases 1–29.

### 3. HIGH findings (35 total)

| Phase | File:line | Summary |
| ----- | --------- | ------- |
| 1 | `infra/postgres/migrations/*` (resource_grants) | `resource_grants` table has no RLS enabled |
| 1 | `infra/postgres/migrations/*` (workspace_memberships) | `workspace_memberships` has no RLS enabled |
| 2 | `packages/auth/src/index.ts:215-219` | Bearer-token backdoor / parallel session auth path |
| 3 | `packages/ai/*` (gateway/chat) | No rate limiting on AI/chat/MCP cost surfaces |
| 3 | `packages/ai/*` (MCP allowlist) | MCP tool allowlist not enforced for Codex/Gemini engines |
| 3 | `packages/ai/*` (MCP transport) | MCP transport not rate-limited |
| 4 | `apps/api` / settings (workspaces) | Dead workspaces subsystem reachable via API |
| 5 | `packages/db/src/migrations/sql-runner.ts` | `runSqlMigrations` cross-directory version collisions |
| 6 | `packages/auth/src/index.ts` | Bearer auth live in production resolve path |
| 6 | `packages/auth/src/index.ts:269-300` | Bootstrap workspace seed self-sets actor GUC |
| 7 | `packages/vault/src/*` (withVaultContext) | `withVaultContext` performs no `actorUserId` validation |
| 7 | `packages/vault/src/*` (path containment) | Lexical path containment allows symlink escape |
| 8 | `packages/ai/src/routes.ts` | REST route bypasses gateway identity token |
| 9 | `packages/chat/sql/*` (worker grant) | Worker UPDATE `chat_messages` dead grant |
| 9 | `packages/chat/src/*` (incognito) | Incognito mode not enforced immutable |
| 10 | `packages/tasks/src/*` (activity) | View-only sharee can write task activity |
| 10 | `packages/tasks/src/*` (sub-tasks) | Sub-tasks creatable under another user's parent task |
| 10 | `packages/tasks/src/*` (list/parent) | No ownership check on `list_id`/`parent_task_id` |
| 11 | `packages/connectors/src/routes.ts` (/google/authorize) | `/google/authorize` has no rate limit |
| 11 | `packages/connectors/src/*` (OAuth error) | OAuth token error body echoed to client |
| 12 | `packages/memory/src/*` (repositories) | Repositories never call `assertDataContextDb` |
| 12 | `packages/memory/src/*` (vectorSearch) | `vectorSearch` has no explicit owner predicate |
| 15 | `packages/briefings/src/repository.ts:253-262` | Assistant tools executed with blank `ToolContext` (`actorUserId:""`) |
| 16 | `packages/notifications/src/routes.ts:111-117` | `handleRouteError` collapses every error to 401 |
| 17 | `packages/structured-state/src/manifest.ts:28-31` | Declared `contribute`/`manage` share levels unenforceable by RLS |
| 18 | `packages/settings/src/repository.ts:262-346` | Resource-grants admin surface is a dead silent no-op |
| 18 | `packages/settings/src/repository.ts:64` | Repository takes raw `Kysely`, bypasses `withDataContext`/RLS |
| 18 | `packages/settings/src/routes.ts:86-102` | `/api/me` reads other users' workspace rows via unguarded raw Kysely |
| 19 | `packages/jobs/src/pg-boss.ts:14-20,84-98` | Metadata-only payload invariant unenforced (marker interface only) |
| 23 | `apps/api/src/server.ts:59-65` | No global rate limit; module routes (chat/AI/tasks) unthrottled |
| 26 | `tests/integration/foundation.test.ts:208-235` | Cross-test `app.shares` contamination, order-dependent assertions |
| 29 | `scripts/export-user-data.ts:33-53` | `export:user` silently omits memory + structured-state private content |

### 4. Top 5 systemic issues

1. **Defense-in-depth by convention, not mechanism.** The metadata-only payload rule
   (P19/P21/P25/P28), DataContextDb-only (P12/P17/P21), and per-handler auth
   (P23) are all enforced at each call site by discipline rather than at a single
   structural chokepoint. `assertDataContextDb` is omitted in memory and structured-state
   repos (P12/P17); `metadataOnly` manifest flag is read by nothing (P21); the jobs
   boundary has only a marker interface (P19).

2. **Dead "workspace" / "resource_grants" scaffolding survives the house-model migration.**
   Slice 1f removed `workspaceId` from `AccessContext`, but workspaces CRUD, memberships,
   `resource_grants`, and `workspace-toggleable` lifecycle persist across settings
   (P18), auth seed (P6/P18), shared contracts (P22), web UI (P24), and tests (P26/P16).
   The resource-grants admin path is a security-relevant silent no-op (P18).

3. **No rate limiting on token-spending / cost-amplification surfaces.** AI, chat, and the
   MCP gateway are entirely unthrottled (P3/P23); only better-auth and the OAuth route
   opt in. The composition root registers the limiter `global: false` (P23).

4. **`handleRouteError` collapses all errors to 401, masking 500s.** Identical
   swallow-to-`"Session is missing or expired"` handlers in calendar (P13), email (P14),
   and notifications (P16) hide real server faults from monitoring and mislead clients —
   diverging from the canonical tasks handler. A prime code-judo consolidation target.

5. **Cast-heavy / unvalidated boundaries.** `as unknown as Record` at the payload
   boundary (P28), open `Record<string,unknown>`/`unknown` SDK contracts narrowed by hand
   in every consumer (P21/P22), unvalidated decrypt envelope casts (P29), and
   trust-the-cast tool-result extraction in briefings (P15). The pattern recurs across
   secrets, payloads, and tool I/O.

### 5. Highest-risk module/area

**The `settings` module (Phase 18) — the platform admin surface.** It is the only
data-touching module that holds a **raw root `Kysely` handle and bypasses
`withDataContext`/RLS entirely** (3 HIGH findings — the most of any module). Its four
admin tables (`workspaces`, `workspace_memberships`, `instance_settings`,
`resource_grants`) have **no RLS at all**, so the *only* thing protecting cross-user data
(including `/api/me`, available to every user) is a hand-written `requireAdmin` check and a
WHERE clause — zero database-level safety net. It also ships a `resource_grants` admin
path that silently no-ops (operators believe they granted/revoked access that has no
effect). This combination — privileged surface, no RLS backstop, dead-but-live security
machinery — is the single area where one missed app-layer check becomes a cross-user leak,
directly contradicting the project's RLS-everywhere invariant. (Runner-up: the
vault path-containment / symlink-escape cluster in P7.)

### 6. Quick wins (trivially-fixable, high value)

1. **Remove `test:notes` script** pointing at a deleted file (P26, `package.json:42`).
2. **Delete dead `itemBWorkspaceShared` fixture** seeded but never asserted (P26,
   `tests/integration/test-database.ts`).
3. **Delete the no-op pluralization** `tool.itemCount === 1 ? "visible" : "visible"`
   (P15, `packages/briefings/src/repository.ts:386`).
4. **Drop the redundant `await`** on the synchronous `createEmbeddingProvider` (P25,
   `apps/worker/src/worker.ts:21`).
5. **Add `@jarv1s/memory` to `apps/worker/package.json` deps** (undeclared, P25).
6. **Delete ~9 dead web client API functions + `MemoryFact` type** with zero callers
   (P24, `apps/web/src/api/client.ts`).
7. **Type payload-guard params as `(payload: unknown)`** to delete `as unknown as Record`
   casts at 4 sites (P28, `packages/tasks/src/jobs.ts:73` et al.).
8. **Extract `errorResponseSchema`/`jsonObjectSchema`/`nullableStringSchema`** into one
   `schema-fragments.ts` — deletes ~7 byte-identical copies (P22).
9. **Add `readonly` to the 4 Google connector request/response interfaces** to match
   package convention (P22, `packages/shared/src/connectors-api.ts:242-257`).

### 7. Recommended fix order

1. **HIGH security first (data exposure / auth):**
   - Settings raw-Kysely + missing RLS on `workspaces`/`workspace_memberships`, and
     `/api/me` cross-user reads (P18 ×3) — enable+FORCE RLS, route through `withDataContext`.
   - Bearer-token backdoor / parallel auth path (P2/P6).
   - Tasks cross-user write-escalation: view-sharee activity writes, sub-task reparenting,
     missing `list_id`/`parent_task_id` ownership checks (P10 ×3).
   - Memory: add `assertDataContextDb` + explicit owner predicate on `vectorSearch`
     (P12 ×2). Vault path-containment / symlink escape + `actorUserId` validation (P7 ×2).
   - Structured-state: narrow manifest to `view` (or implement+test write-share RLS) (P17).

2. **HIGH cost / availability:**
   - Global rate-limit default at the composition root + per-route limits on chat/AI/MCP
     (P23/P3 ×3). OAuth authorize rate limit + stop echoing token error bodies (P11 ×2).

3. **HIGH correctness / invariant hardening:**
   - Jobs metadata-only chokepoint (`sendJob` wrapper + bounded payload type) (P19).
   - Briefings blank `ToolContext` → thread real `actorUserId` (P15).
   - Chat: incognito immutability + remove dead worker UPDATE grant (P9 ×2).
   - AI REST route gateway-identity bypass (P8). Migration cross-dir collision guard (P5).

4. **HIGH data-portability / tests:**
   - `export:user` add memory + structured-state tables, drive from canonical registry
     (P29). Foundation test `app.shares` contamination → per-test cleanup (P26).

5. **Systemic consolidations (code-judo):**
   - Single shared `handleRouteError` for calendar/email/notifications (P13/P14/P16).
   - Remove dead workspace / resource_grants subsystem in one pass (P18/P22/P24/P6).
   - Auth `preHandler` to make private-by-default structural (P23).

6. **Quick wins** (Section 6) — batch alongside the consolidations.

### 8. Hard-invariant status

| # | Invariant | Status | Note | Phase |
| - | --------- | ------ | ---- | ----- |
| 1 | No admin private-data bypass | ⚠️ partial | NOBYPASSRLS verified everywhere; but `app.users` is ENABLE-not-FORCE (documented carve-out) and settings admin tables have no RLS at all | P27/P18/P28 |
| 2 | Private by default | ⚠️ partial | RLS broad and tested; but settings raw-Kysely + no-RLS admin tables and dead resource-grants path are gaps | P18/P26 |
| 3 | DataContextDb only / VaultContext for all vault I/O | ⚠️ partial | Held in most modules; settings holds a raw root `Kysely`; memory/structured-state omit `assertDataContextDb` | P18/P12/P17 |
| 4 | AccessContext shape `{actorUserId, requestId}` only | ✅ compliant | No field added at the db boundary; `ToolContext` adds `chatSessionId` but is dropped before `withDataContext` | P21/P25 |
| 5 | Secrets never escape | ✅ compliant | Encrypted-at-rest, proven absent from responses/payloads/exports; minor proximity risk in worker `String(err)` logging | P27/P26/P25 |
| 6 | Metadata-only job payloads | ⚠️ partial | Upheld in practice and tested per-queue; but unenforced structurally — marker interface + dead `metadataOnly` flag, no chokepoint | P19/P21/P25 |
| 7 | Provider-agnostic AI | ✅ compliant | No hardcoded provider/model; capability router respected; briefings does no AI call | P3/P15 |
| 8 | Spec before build | ✅ compliant | No new feature/module observed shipping without spec; unwired modules flagged as staged foundation, not unspecced features | P17 |
| 9 | Module isolation | ✅ compliant | Zero cross-module internal imports (mechanical sweep clean); registry validates nothing but no violation exists; briefings string-keys other modules' tool names (smell, not import) | P28/P20/P15 |
| 10 | pgvector image | ✅ compliant | `pgvector/pgvector:pg17`; extension installed once in bootstrap, never reverted | P27/P1 |
| 11 | Never edit applied migrations | ✅ compliant | Hash-checked numbered migrations; no edits; bootstrap/grants use idempotent `runSqlFiles` (documented split, not a violation) | P27/P5 |

### 9. Total counts (summed across Phases 1–29)

| Severity | Count |
| -------- | ----- |
| CRIT     | 0 |
| HIGH     | 35 |
| MED      | 117 |
| LOW      | 109 |
| INFO     | 76 |
| **Total findings** | **337** |
