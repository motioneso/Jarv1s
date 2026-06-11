## Phase 4 — API Surface & Auth Security

Scope: `apps/api/src/`, `apps/worker/src/`, `packages/auth/src/`, and all module
`packages/*/src/routes.ts` (route handlers live in module packages). Reviewed against
review dimensions A–G and the 11 Hard Invariants.

**Headline:** The core auth-enforcement chain is sound and consistent — every handler
calls `resolveAccessContext(request)` (throws 401 on no session) then scopes work through
`withDataContext(accessContext, ...)`. `actorUserId` is *always* taken from the verified
session, never from request input (checked: tasks, briefings, ai, chat, connectors,
settings, calendar, email, notifications). The MCP transport derives identity solely from
a server-minted token, and the worker rejects jobs missing `actorUserId` and runs each job
under RLS scoped to the payload's `actorUserId`. **No IDOR, no actorUserId-from-body, and
no job-forgery vector was found.** The findings below are real but none are CRIT: the
biggest items are a dead access-control subsystem (delete-it code-judo) and an
error-handler bug that mislabels server faults as 401s.

### Severity counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4
- INFO: 1

### Findings

#### [HIGH] Dead `workspaces` subsystem still wired through bootstrap, settings routes, and repository — delete the whole branch
**File:** `packages/auth/src/index.ts:233` (bootstrapFirstJarvisUser), `packages/settings/src/routes.ts` (workspace/membership CRUD), `packages/settings/src/repository.ts` (listWorkspaces, workspace_memberships)  
**Invariant violated / concern:** Hard Invariant #4 (AccessContext shape — workspaceId permanently removed in Slice 1f); "No stale concepts" maintainability rule; dead-code attack surface.  
**Detail:** Migration `0028_workspace_teardown.sql` dropped `workspace_id`/`visibility` from every product table and removed `app.is_workspace_member()` / `app.current_workspace_id()`. Workspaces are a fully dead access-control concept — nothing in the runtime read path consults them. Yet `bootstrapFirstJarvisUser` still creates `app.workspaces` + `app.workspace_memberships` rows for the first user, and `settings` exposes full CRUD over workspaces and memberships (routes + repository methods that return all rows). This is the single largest code-judo opportunity in Phase 4: an entire authorization-shaped subsystem that grants nothing and is purely confusing surface area. A future reader could reasonably believe membership gates access and build on it.  
**Suggested fix:** Delete the workspace/membership creation from `bootstrapFirstJarvisUser`, the workspace + membership routes from `settings/routes.ts`, and the corresponding repository methods. Add a migration to drop the now-unused `app.workspaces` / `app.workspace_memberships` tables (and the dead `resource_grants`/membership scaffolding if equally unreferenced). Prefer deleting the branch over keeping it "just in case."

#### [MED] `handleRouteError` returns 401 for *every* error in calendar, email, and notifications — masks 500s as auth failures
**File:** `packages/calendar/src/routes.ts:89`, `packages/email/src/routes.ts:89`, `packages/notifications/src/routes.ts:111`  
**Invariant violated / concern:** Dimension E (error handling — responses must not mislead; server faults must surface as 5xx and be logged).  
**Detail:** All three thin route files funnel every caught error to a `handleRouteError` that unconditionally replies `401 "Session is missing or expired"`. A genuine DB error, validation throw, or repository bug is reported to the client as an expired session — the client retries auth pointlessly, the real fault is never logged, and no 500 is ever emitted. The notifications variant is worse: it has an `if (message.includes("Session"))` branch and an `else` branch that both `return reply.code(401).send({ error: "Session is missing or expired" })` — dead-code that signals the bug was half-noticed. (Contrast the correct pattern in `ai/routes.ts` `handleRouteError` and `chat/live-routes.ts` `handleLiveRouteError`, which map known errors to 4xx and unknown errors to a logged generic 500.)  
**Suggested fix:** Replace the three handlers with the established pattern: 401 only when the error is actually a session/bearer error, 400 for validation/FK/dup/RLS-denial, otherwise `request.log.error({ err })` and `reply.code(500).send({ error: "Internal error" })`. Factor a single shared `handleRouteError` (e.g. in `@jarv1s/shared`) so thin route files can't diverge again.

#### [MED] `SettingsRepository` takes a raw root Kysely instead of a `DataContextDb` — bypasses the RLS-scoping seam
**File:** `packages/settings/src/repository.ts:` constructor (`constructor(private readonly db: Kysely<JarvisDatabase>)`); instantiated at `packages/settings/src/routes.ts:75` as `new SettingsRepository(dependencies.appDb)`  
**Invariant violated / concern:** Hard Invariant #3 (DataContextDb only — repositories accept only the branded handle, never a root Kysely).  
**Detail:** Every other module repository accepts the branded `DataContextDb` and is driven through `withDataContext`, so the actor GUC is set and RLS applies. `SettingsRepository` instead holds the root `appDb` and runs `listUsers` / `listWorkspaces` / `listResourceGrants` / `listAdminAuditEvents` with no actor GUC — they return *all* rows. Access is gated only by the app-layer `requireAdmin` check, not by the database. This is the literal violation of "DataContextDb only" and removes the defense-in-depth the invariant exists to guarantee. (Note: a prior Fable audit filed the related missing-RLS item as Issue #95 and downgraded it because `requireAdmin` gates the routes and the bootstrap path is a documented exception — hence MED, not HIGH. But the *seam* violation stands independent of that downgrade: the repo should still flow through the branded handle.)  
**Suggested fix:** Change the constructor to accept `DataContextDb` and route all reads through `dataContext.withDataContext(...)` like every other module. Where genuine admin-wide reads are required, do them under an explicit, named admin data-context path rather than a raw root handle, so the bypass is auditable rather than ambient.

#### [MED] Admin/settings tables have no `ENABLE ROW LEVEL SECURITY` — admin power is enforced only in app code
**File:** `infra/postgres/migrations/0004_*.sql` / `0005_*.sql` (workspaces, instance_settings, resource_grants, admin_audit_events, workspace_memberships)  
**Invariant violated / concern:** Hard Invariant #1 (RLS applies to all actors) and the project's stated DB-level defense-in-depth posture (RLS + least-privilege roles, not conventions).  
**Detail:** A grep across all migrations confirms these five tables are granted to `app_runtime` but never get `ENABLE ROW LEVEL SECURITY` (only `users` gains RLS, in `0045`). So the *only* thing standing between a non-admin session and these rows is the `requireAdmin` application check. If any future route forgets `requireAdmin`, or the raw-Kysely repository (finding above) is reused without the gate, there is no database backstop. Given these tables hold instance config and the admin audit trail, that's a meaningful gap in a project whose whole security model is "DB-level, not conventions."  
**Suggested fix:** Add a migration enabling (and `FORCE`-ing) RLS on `instance_settings`, `resource_grants`, and `admin_audit_events` with admin-only policies keyed on `app.is_instance_admin(app.current_actor_user_id())`. Resolve `workspaces`/`workspace_memberships` by deletion per the HIGH finding rather than by adding policies to dead tables.

#### [MED] Chat memory-fact DELETE/PATCH rely solely on RLS with no ownership feedback — silent no-op on someone else's id
**File:** `packages/chat/src/routes.ts:203` (`factsRepo.deleteFact(scopedDb, request.params.id)`), `packages/chat/src/routes.ts:220` (`updateFactImportance(scopedDb, request.params.id, importance)`)  
**Invariant violated / concern:** Dimension A (IDOR-adjacent) — defense-in-depth and correct 404 semantics on cross-owner access.  
**Detail:** Both handlers pass only the path `id` to the repository and depend entirely on RLS to scope the row. RLS does prevent cross-user mutation (so this is *not* an IDOR data leak), but the DELETE returns `204` even when zero rows matched — a caller probing another user's fact id cannot distinguish "deleted yours" from "id exists but isn't yours" from "id doesn't exist," and the PATCH similarly succeeds-silently. There's no app-layer owner check and no affected-row assertion, so a regression in the RLS policy would convert this directly into cross-user mutation with no second line of defense.  
**Suggested fix:** Have the repository return the affected-row count (or the updated/deleted row) and reply `404` when nothing matched. This adds a cheap app-layer ownership signal on top of RLS and makes the endpoints honest about what happened.

#### [LOW] Dead `"Workspace context is unavailable" → 403` mapping in three route error handlers
**File:** `packages/ai/src/routes.ts:` handleRouteError, `packages/settings/src/routes.ts:` handleRouteError, `packages/connectors/src/routes.ts:` handleRouteError  
**Invariant violated / concern:** "No stale concepts" — dead error branch tied to the removed workspace concept.  
**Detail:** Three `handleRouteError` functions still special-case an error message `"Workspace context is unavailable"` and map it to 403. After Slice 1f / migration 0028 nothing throws that string anymore, so the branch is unreachable. It's harmless but reinforces the misconception that a workspace context still exists in the request path.  
**Suggested fix:** Remove the dead branch in all three handlers (folds naturally into the shared-handler refactor suggested in the MED error-handling finding).

#### [LOW] `/api/mcp` JSON-RPC endpoint is not rate-limited
**File:** `packages/chat/src/mcp-transport.ts` (`/api/mcp` POST registration); contrast throttling in `apps/api/src/server.ts:170`  
**Invariant violated / concern:** Dimension E / availability — credential and tool-invocation surfaces should be throttled.  
**Detail:** The auth credential paths get `rateLimit { max: AUTH_MAX }` and the OAuth completion routes get `JARVIS_RL_OAUTH_MAX`, but `/api/mcp` — which accepts a bearer token and dispatches tool calls — has no per-route rate limit. A leaked/guessed session token (these tokens never expire, see next finding) could be hammered for tool execution or token-verification probing without throttle.  
**Suggested fix:** Apply a `rateLimit` config to the `/api/mcp` route (a modest per-IP/per-token max), consistent with the auth/OAuth routes.

#### [LOW] MCP session tokens have no TTL — valid until explicit revoke
**File:** `packages/ai/src/gateway/session-tokens.ts:` SessionTokenRegistry (`mint`/`verify`/`revoke`)  
**Invariant violated / concern:** Dimension A — bearer tokens minted for the MCP gateway are long-lived secrets.  
**Detail:** `SessionTokenRegistry` is an in-memory `Map<token, { actorUserId, chatSessionId }>` with no expiry. A token is valid until `revoke`/`revokeBySessionId` is called. Identity is never taken from request input (good — forgery-resistant), but a token that leaks (logs, proxy, client storage) stays usable indefinitely as long as the process lives and the session isn't explicitly torn down.  
**Suggested fix:** Store a mint timestamp and reject in `verify` past a configurable TTL; refresh on the live-chat heartbeat. Lower urgency because tokens are in-memory (lost on restart) and scoped to a single chat session.

#### [LOW] `bootstrapFirstJarvisUser` writes an `admin_audit_events` row into an RLS-less table during an unauthenticated path
**File:** `packages/auth/src/index.ts:233`–307 (bootstrap insert into `app.admin_audit_events`)  
**Invariant violated / concern:** Dimension A / audit integrity — the audit trail's first entry lands in a table with no RLS (see MED above) on a pre-auth code path.  
**Detail:** First-user bootstrap (advisory-locked, gated by `app.count_all_users()`) inserts the admin-grant audit event. The advisory lock + count guard correctly prevent a second bootstrap, so this is not a privilege-escalation hole. But the audit row is written to a table with no row-level protection, on the one path that runs before any session exists — worth tightening once `admin_audit_events` gains RLS.  
**Suggested fix:** After enabling RLS on `admin_audit_events` (MED finding), write the bootstrap audit row through a narrowly-scoped SECURITY DEFINER function (mirroring `count_all_users`) rather than a direct insert, so the audit trail has DB-level integrity from row one.

#### [INFO] No CORS plugin, security headers, or custom Fastify error handler on the host server
**File:** `apps/api/src/server.ts:31`–124 (createApiServer)  
**Invariant violated / concern:** Dimension E / defense-in-depth — observation, not a confirmed vulnerability.  
**Detail:** `createApiServer` registers `@fastify/rate-limit` but no `@fastify/cors`, no `@fastify/helmet` (or equivalent security headers: HSTS, X-Content-Type-Options, frame-options, CSP), and no `setErrorHandler`. The web shell proxies `/api` from the same origin so CORS may be intentionally omitted, and better-auth manages its own CSRF/cookie posture — so this is informational rather than a defect. But absent a global error handler, any unmapped throw falls through to Fastify's default error response; combined with the per-module handlers above, error behavior is inconsistent across the surface. Worth a deliberate decision (documented in an ADR) rather than an implicit gap.  
**Suggested fix:** Decide and document the CORS posture; if same-origin-only, add a restrictive `@fastify/cors` (or a comment + test asserting cross-origin is rejected). Add baseline security headers via `@fastify/helmet`. Add a single `server.setErrorHandler` that logs and returns a generic 500, so no handler can leak a stack or internal path.

### Dimension F (job forgery) — cleared

`registerDataContextWorker` (`packages/jobs/src/pg-boss.ts:84`) throws `Job <id> is missing
actorUserId` (line 101) and runs every handler under `withDataContext` scoped to
`job.data.actorUserId` (lines 96, 100–108). The only enqueue paths into these queues are
authenticated routes that stamp `actorUserId` from the verified session
(`tasks/routes.ts:258`, `briefings/routes.ts:125`), each guarded by a metadata-only payload
assertion (`isDeferredTaskStatusPayloadMetadataOnly`, `isBriefingRunPayloadMetadataOnly`)
that throws 500 before `boss.send` if any non-metadata field is present. A user cannot set
another user's `actorUserId` and cannot smuggle content/secrets into a payload. No job-forgery
or metadata-leak vector found (Hard Invariants #6 satisfied).
