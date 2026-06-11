## Phase 16 — Module notifications

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 3
- LOW: 3
- INFO: 2

### Findings

#### [HIGH] `handleRouteError` collapses every error to 401 "Session is missing or expired"
**File:** `packages/notifications/src/routes.ts:111-117`  
**Invariant violated / concern:** Quality smell — swallowed/misclassified errors at the boundary (review dimension E); leaked-control-flow / masked internal failures.  
**Detail:** Both branches of `handleRouteError` return `reply.code(401).send({ error: "Session is missing or expired" })`. The `if (error instanceof Error && error.message.includes("Session"))` guard is dead — its body is identical to the fall-through. Any failure inside `listVisible` / `markRead` / `markAllRead` — a DB connection drop, a Kysely query error, an RLS denial surfacing as a Postgres error, a serialization bug — is reported to the client as "Session is missing or expired" with HTTP 401. This is actively misleading: it tells the operator/UI the user is logged out when the real cause is a 500-class server fault, and it guarantees those faults are never surfaced as 5xx (so monitoring/alerting on 5xx will never fire for this module). It also string-matches on `error.message.includes("Session")`, a brittle contract against `withDataContext`'s thrown message. Notably the three handlers each wrap their body in `try/catch` only to route everything here, so genuine 500s are structurally impossible to emit.  
**Suggested fix:** Distinguish auth/session failures (401) from everything else (let it propagate to Fastify's default error handler, or return 500). Match on a typed error class from `@jarv1s/db` (e.g. a `SessionError`) rather than `message.includes("Session")`. Delete the dead `if` branch once the two outcomes actually differ.

#### [MED] No system/worker delivery path — notifications are structurally self-delivery only
**File:** `packages/notifications/sql/0008_notifications_module.sql:24-25` and `sql/0029_fix_notifications_insert_policy.sql:6-14`  
**Invariant violated / concern:** Architecture / "feature cannot meet its own purpose"; cross-user delivery design gap. (Not a security hole — the lockdown is correct — but a real architectural limitation worth surfacing in a whole-codebase audit.)  
**Detail:** The INSERT policy requires `recipient_user_id = app.current_actor_user_id()` (migration 0029) and INSERT is granted only to `jarvis_app_runtime`, never `jarvis_worker_runtime` (the test at `tests/integration/notifications.test.ts:58-109` explicitly asserts `worker_can_select = false`). Combined, this means: (a) a notification can only ever be created for the acting user themself, and (b) no background worker can create one at all. A notifications module exists primarily so the *system* (a job, another module, an admin action) can deliver a message *to* a user. Grep confirms no other package calls `NotificationsRepository.create` — the only inserts that target another user are the test seed, which uses the bootstrap superuser role to bypass RLS (`notifications.test.ts:325-356`). As written, the feature can only let a user notify themself, which is not a use case any caller exercises. Either the delivery model is intentionally deferred (then `create` / the recipient column machinery is premature scaffolding — see the LOW below) or a `system`-context insert path (a dedicated policy keyed to a system actor, or a SECURITY DEFINER delivery function) is missing.  
**Suggested fix:** Decide and document the delivery model. If cross-user delivery is in scope, add an explicit, audited insert path (system actor context or `SECURITY DEFINER` function that validates recipient) plus a `jarvis_worker_runtime` grant scoped to that path. If it is out of scope for now, mark `create`/recipient plumbing as deferred and gate it behind a spec rather than shipping a half-built capability.

#### [MED] `markRead` issues a redundant follow-up SELECT (code-judo: collapse to one round-trip)
**File:** `packages/notifications/src/repository.ts:82-114`  
**Invariant violated / concern:** Incidental complexity / unnecessarily sequential round-trips (DEVELOPMENT_STANDARDS — non-atomic / sequential orchestration).  
**Detail:** `markRead` performs an INSERT…ON CONFLICT into `notification_reads`, then on success throws away the result and calls `this.getById(scopedDb, notificationId)` — a *second* query that re-joins `notifications` to `notification_reads`. Two round-trips where one suffices. The upsert already touches the read row; the parent notification can be returned in the same statement via a CTE (`WITH upsert AS (INSERT … RETURNING …) SELECT n.*, upsert.read_at FROM notifications n …`) or by `RETURNING` and a single follow-up that is unavoidable only if you need the notification columns. At minimum the `read_at` produced by the upsert (`now()`) is discarded and re-fetched. Same shape, fewer queries, no behavior change.  
**Suggested fix:** Return the notification + read state from a single CTE-backed statement; drop the second `getById` call. This also removes the subtle inconsistency where the returned `read_at` comes from a different query than the upsert that set it.

#### [MED] `markRead` returns `undefined` for both "not found" and "not visible" — route maps both to 404, but the repository conflates two cases
**File:** `packages/notifications/src/repository.ts:88-113`, `routes.ts:78-80`  
**Invariant violated / concern:** Quality smell — special-case conflation; the contract obscures the real invariant (review dimension C/D).  
**Detail:** The upsert's `expression` selects from `app.notifications WHERE id = notificationId`; under RLS that returns zero rows both when the id doesn't exist and when it exists but isn't visible to the actor. The `if (!read) return undefined` branch therefore folds "no such notification" and "RLS-denied" into one signal. That happens to be the desired external behavior (don't leak existence — return 404 either way, which the route does at `routes.ts:78-80`), so this is *correct security behavior* but the repository's `Promise<NotificationWithReadState | undefined>` return type documents none of it. A future caller reading the signature could reasonably treat `undefined` as "definitely absent" and act on it.  
**Suggested fix:** Keep the security behavior; make the contract explicit. A named result (e.g. `"not-visible-or-absent"`) or a doc comment on `markRead` stating that `undefined` deliberately conflates absent/denied to avoid existence leakage would prevent a future caller from misreading it.

#### [LOW] Inert recipient/actor plumbing and seed scaffolding referencing dropped `workspace_id`
**File:** `packages/notifications/src/repository.ts:16-22,60-67`; `tests/integration/notifications.test.ts:23-27,249-261`  
**Invariant violated / concern:** No-stale-concepts rule — dead vocabulary/scaffolding left behind after a model change (DEVELOPMENT_STANDARDS).  
**Detail:** `CreateNotificationInput` exposes `actorUserId?` and `recipientUserId?` as overridable, but the INSERT RLS policy forbids any `recipient_user_id` other than the actor (0029), so the `recipientUserId` override can only ever succeed with the actor's own id — the optionality is misleading. The test file still carries `aWorkspaceSeed`, `workspaceScoped: true` metadata, and an `x-jarvis-workspace-id` header (`notifications.test.ts:254-261`) even though migration 0024 notes workspace columns are "inert (dropped in Slice 1f)". These are vestiges of the pre-recipient-only model that no longer carry meaning and invite confusion about whether workspace scoping still applies.  
**Suggested fix:** Drop the `recipientUserId` override from `CreateNotificationInput` (or document it as actor-only) until a real cross-user delivery path exists; remove the `workspace`-named seeds/headers from the test or rename them to reflect recipient-only semantics.

#### [LOW] `metadata` is unbounded `Record<string, unknown>` / `additionalProperties: true` with no size or content guard
**File:** `packages/notifications/src/repository.ts:21,70`; `packages/shared/src/notifications-api.ts:29-32`  
**Invariant violated / concern:** Boundary validation gap (review dimension E); secret-exposure surface (hard invariant 5) — low risk because notifications are self-created.  
**Detail:** `metadata` flows into a `jsonb` column with no schema (`additionalProperties: true`) and is echoed back verbatim in `serializeNotification` (`routes.ts:97`) and in the assistant tool output (`tools.ts:18-20`). Because notifications are currently self-delivery only, the writer and reader are the same user, so cross-user secret leakage is not currently possible — but the moment a system/worker delivery path is added (see the MED above), unbounded metadata becomes a channel for putting private content or secrets into a payload that is rendered in the UI and surfaced to the assistant tool. There is also no upper bound on metadata size, so a client can write arbitrarily large jsonb blobs.  
**Suggested fix:** Constrain `metadata` to a known key set (or at least a documented allowlist + max byte size) before any non-self delivery lands. Treat metadata as untrusted echo at the serialization boundary.

#### [LOW] `notification_reads` SELECT policy `EXISTS` subquery is redundant given the parent SELECT policy
**File:** `packages/notifications/sql/0008_notifications_module.sql:61-110`  
**Invariant violated / concern:** Incidental complexity in RLS predicates (review dimension C).  
**Detail:** Each `notification_reads` policy (select/insert/update) ANDs `user_id = app.current_actor_user_id()` with `EXISTS (SELECT 1 FROM app.notifications WHERE id = notification_id)`. Since `app.notifications` itself enforces recipient-only SELECT under FORCE RLS, the `EXISTS` only matches notifications visible to the same actor — and a read row's `user_id` is already constrained to the actor. The `user_id = current_actor` predicate alone is the load-bearing guard; the `EXISTS` adds a correlated subquery per row that re-derives visibility the parent table already enforces. It is not wrong (defense in depth), but it is the kind of duplicated invariant the standards flag. The FK already guarantees referential integrity, and RLS on the parent guarantees visibility.  
**Suggested fix:** Consider dropping the `EXISTS` subqueries and relying on `user_id = app.current_actor_user_id()` plus the FK + parent-table RLS, after confirming with an integration test that a read row for a notification the actor cannot see is unreachable. If kept for explicit defense-in-depth, add a one-line comment saying so.

#### [INFO] Owner-only / recipient-only RLS is correctly implemented and admin-bypass is tested
**File:** `packages/notifications/sql/0024_notifications_owner_only.sql:9-25`, `tests/integration/notifications.test.ts:193-207`  
**Invariant violated / concern:** None — positive confirmation (hard invariants 1 & 2).  
**Detail:** Both tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`, owned by `jarvis_migration_owner`, with no `BYPASSRLS` on runtime roles. SELECT is strictly `recipient_user_id = app.current_actor_user_id()`, unread counts are computed per-actor via a `current_actor_user_id()`-correlated left join (`repository.ts:148-161`) with no cross-user aggregation, and the test suite verifies a different user *and the admin session* both get `undefined` for another user's notification (`notifications.test.ts:193-207`). The module declares and touches only its own `ownedTables` (`manifest.ts:33`). `assertDataContextDb` is called at the top of every repository method and the "fails loudly without withDataContext" test (`notifications.test.ts:318-322`) confirms it. This is the security model working as intended.

#### [INFO] No pg-boss queues — module is payload-free by construction
**File:** `packages/notifications/src/manifest.ts` (no `queueDefinitions`), `tests/integration/notifications.test.ts:159`  
**Invariant violated / concern:** None — positive confirmation (hard invariants 5 & 6, job/event payload dimension F).  
**Detail:** The notifications module defines no queues and enqueues no jobs (`registration?.queueDefinitions` asserted `[]`). There are no pg-boss payloads to audit for content/secret leakage, and notifications are written synchronously via the app runtime under RLS. Reviewed and clean for dimension F. (The metadata-channel concern noted in the LOW above is a future risk tied to adding a delivery path, not a current payload violation.)
