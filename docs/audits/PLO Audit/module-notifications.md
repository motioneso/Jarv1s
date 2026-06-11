# PLO Thermo-Nuclear Audit — packages/notifications

**Audited:** 2026-06-10
**Scope:** `packages/notifications/src/`, `packages/notifications/sql/`, integration tests, shared API types, and cross-module surface

---

## Summary

The notifications module is small (435 source lines across five files) and architecturally sound for its current scope (in-app, recipient-only, read-state tracking). RLS, DataContextDb, and AccessContext invariants are broadly correct. Several issues need attention: a dead `if`-branch in the error handler that masks all internal errors as 401, a missing test for actor-spoofing via the `create()` API, a stale comment referencing dropped columns, and a security-relevant gap — the RLS INSERT policy hard-blocks any worker-side or cross-user notification delivery with no documented escape hatch, which is partially covered by the DB/RLS audit but deserves a module-level call.

---

## Findings

### [HIGH] handleRouteError both branches are identical — all errors reported as 401

- **File:** `packages/notifications/src/routes.ts:111-117`
- **Category:** Error Handling
- **Finding:** The `handleRouteError` function has an `if` branch that checks for a session-related error message, then both the `if` body and the `else` return the exact same `reply.code(401).send({ error: "Session is missing or expired" })`. This means any repository error — DB connection failure, constraint violation, unexpected null, pg driver error — is indistinguishable from an auth failure and returns 401 to the client. Internal errors are silently swallowed and misreported.
- **Evidence:**
  ```ts
  // packages/notifications/src/routes.ts:111-117
  function handleRouteError(error: unknown, reply: FastifyReply) {
    if (error instanceof Error && error.message.includes("Session")) {
      return reply.code(401).send({ error: "Session is missing or expired" });
    }

    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  ```
- **Impact:** (1) DB errors (e.g., connection pool exhausted, constraint violations during `markRead`) surface to the client as auth failures, making them impossible to diagnose from client-side telemetry or logs. (2) An attacker probing for errors gets a uniform 401 response even when the session is valid and the failure is internal — this is a minor information hiding win, but it comes at the cost of completely obscuring legitimate infrastructure failures. (3) Other route modules (`tasks`, `ai`, `briefings`, `connectors`) do distinguish the two cases with a 500 fallback; the notifications handler is the only one that collapsed both branches into 401. This appears to be a copy-paste regression.
- **Recommendation:** Match the pattern used by `tasks/src/routes.ts:598-607`:
  ```ts
  function handleRouteError(error: unknown, reply: FastifyReply) {
    if (error instanceof Error && error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: "Session is missing or expired" });
    }
    return reply.code(500).send({ error: "An unexpected error occurred" });
  }
  ```
  Also tighten the `includes("Session")` substring check to an exact match to avoid false positives from error messages that happen to contain the word "Session".

---

### [MEDIUM] INSERT policy permanently blocks all cross-user and worker notification delivery — no documented escape hatch

- **File:** `packages/notifications/sql/0029_fix_notifications_insert_policy.sql`
- **Category:** Security / Architecture
- **Finding:** The final `notifications_insert` policy (migration 0029, which re-introduced the constraint accidentally dropped in 0024) requires `recipient_user_id = app.current_actor_user_id()`. The worker runtime (`jarvis_worker_runtime`) has no `GRANT` on `app.notifications` at all. Together these mean: (a) a user cannot create a notification for another user, and (b) the worker cannot deliver system-generated notifications (e.g., "briefing is ready", "connector sync complete", "memory indexed") to any user. There is no SECURITY DEFINER escape hatch and none is documented.

  The `create()` method in `repository.ts` accepts an optional `recipientUserId` parameter, but when any value other than `undefined` is passed, the DB will reject it if it differs from `current_actor_user_id()`. The interface silently invites callers to attempt cross-user delivery, which will fail at runtime with an opaque DB error.
- **Evidence:**
  ```sql
  -- 0029_fix_notifications_insert_policy.sql
  CREATE POLICY notifications_insert
  ON app.notifications
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND (actor_user_id IS NULL OR actor_user_id = app.current_actor_user_id())
    AND recipient_user_id = app.current_actor_user_id()   -- hard blocks cross-user delivery
  );
  -- jarvis_worker_runtime: no GRANT, no policy
  ```
  ```ts
  // packages/notifications/src/repository.ts:51-79
  export interface CreateNotificationInput {
    readonly actorUserId?: string | null;
    readonly recipientUserId?: string | null;  // ← invites cross-user use; will fail silently at DB
    ...
  }
  ```
- **Impact:** Any future feature that needs to notify a user about a background operation (briefing completion, memory indexing, connector sync) cannot do so through the DB layer. The `recipientUserId` parameter on `CreateNotificationInput` creates a misleading API surface — callers can pass a different user's ID, the TS compiler will accept it, but the DB will reject the INSERT. The failure propagates as a generic DB error swallowed by the current `handleRouteError` as 401. The constraint is also not covered by any test that explicitly verifies the rejection.
- **Recommendation:** One of two paths:
  1. **If cross-user delivery is out of scope for now:** Remove `recipientUserId` from `CreateNotificationInput` (it currently does nothing useful — `undefined` maps to `current_actor_user_id()` and anything else is rejected). Add a comment to the interface and policy documenting the deliberate self-only constraint.
  2. **If cross-user/worker delivery is needed in a future milestone:** Create `app.deliver_notification(recipient_id uuid, actor_id uuid, title text, body text, metadata jsonb)` as a `SECURITY DEFINER` function owned by `jarvis_migration_owner` and grant `EXECUTE` to `jarvis_worker_runtime`. The function performs the INSERT with the policy check bypassed, preserving the no-direct-cross-user-table-write invariant.

---

### [MEDIUM] Missing test: actor-ID spoofing attempt via explicit `actorUserId` is not verified to fail

- **File:** `tests/integration/notifications.test.ts`
- **Category:** Tests / Security
- **Finding:** The INSERT RLS policy blocks insertion when `actor_user_id` is not `NULL` and not equal to `current_actor_user_id()`. The `create()` method's `actorUserId` parameter is the vehicle for this. There is no integration test that explicitly calls `repository.create(scopedDb, { actorUserId: ids.userB, ... })` while the scoped context is `userA`, and asserts that the INSERT is rejected. Without this test, the actor-spoofing protection provided by the DB policy is untested at the repository level.
- **Evidence:**
  ```ts
  // tests/integration/notifications.test.ts — no test that verifies:
  await expect(
    dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        actorUserId: ids.userB,   // spoofing another actor
        title: "Spoofed notification"
      })
    )
  ).rejects.toThrow();
  ```
  The seed data in `seedNotificationData()` does insert cross-user records via the bootstrap connection (which bypasses RLS), but that does not exercise the RLS policy for the app runtime.
- **Impact:** If the policy is accidentally dropped or weakened in a future migration, no test will catch actor-ID spoofing at the repository boundary. The security invariant is implemented but not regression-tested.
- **Recommendation:** Add a test case: "user cannot create a notification with a different actor_user_id" that calls `repository.create()` with an explicit `actorUserId` of a different user and asserts it throws (or returns no result). Mirror the existing "does not let another user or admin role read private notifications" test structure.

---

### [LOW] Stale comment references workspace_id/visibility columns that never existed in 0008

- **File:** `packages/notifications/sql/0024_notifications_owner_only.sql:2-3`
- **Category:** Quality
- **Finding:** The comment reads "workspace_id/visibility columns remain inert (dropped in Slice 1f)". The `0008_notifications_module.sql` migration never added `workspace_id` or `visibility` columns to `app.notifications`. Those columns appear to have been added and then dropped by an earlier version of migrations that was rewritten before the current codebase state. Migration `0028_workspace_teardown.sql` drops them with `DROP COLUMN IF EXISTS` (idempotent), confirming they may or may not exist. The comment in 0024 is misleading because it implies the columns exist but are inert, which confuses future readers.
- **Evidence:**
  ```sql
  -- 0024_notifications_owner_only.sql:1-4
  -- Slice 1c-1d: convert Notifications to recipient-only access. Notifications are
  -- personal messages and are NOT shareable. workspace_id/visibility columns remain
  -- inert (dropped in Slice 1f). notification_reads policies are unchanged...
  ```
  ```sql
  -- 0008_notifications_module.sql: no workspace_id or visibility column defined
  ```
- **Impact:** Misleads future developers into believing the notifications table has live `workspace_id`/`visibility` columns, potentially causing confusion when auditing the table schema or adding new policies.
- **Recommendation:** Update the comment to: "Notifications are personal messages and are NOT shareable. Any workspace_id/visibility columns from earlier schema iterations were dropped by migration 0028."

---

### [LOW] Test seed variable "aWorkspaceSeed" carries stale workspace-era naming and metadata

- **File:** `tests/integration/notifications.test.ts:27, 354`
- **Category:** Quality / Tests
- **Finding:** The seed notification identified as `aWorkspaceSeed` stores `{ source: "seed", workspaceScoped: true }` in its metadata and is explicitly tested to confirm that workspace context makes no difference to visibility (because the workspace concept was removed). The variable name `aWorkspaceSeed` and the `workspaceScoped: true` metadata field are historical artifacts of the workspace era. While the test comments explain the history, the metadata field itself is semantically incorrect — the notification is not and never was workspace-scoped.
- **Evidence:**
  ```ts
  // tests/integration/notifications.test.ts:354
  JSON.stringify({ source: "seed", workspaceScoped: true })
  // The comment at line 292 says: "visibility column is now inert"
  ```
- **Impact:** Low risk — seed metadata has no runtime effect. However, it leaves confusing historical vocabulary in the integration test suite, which the "no stale concepts" standard (MEMORY.md) explicitly flags as a maintainability concern.
- **Recommendation:** Rename `aWorkspaceSeed` to `aRecipientOnly` (or similar) and update its metadata to `{ source: "seed", recipientOnly: true }`. Update the test comments to refer to the current recipient-only design rather than the old workspace model.

---

### [LOW] `toIsoString` accepts non-Date string values without validation — silently passes arbitrary strings

- **File:** `packages/notifications/src/routes.ts:103-109`
- **Category:** TypeScript / Quality
- **Finding:** The `toIsoString` helper accepts `Date | string | null`. The `string` branch returns the value as-is without validating that it is a valid ISO 8601 timestamp. DB drivers typically return timestamps as `Date` objects from Kysely, but if any column type change, raw SQL result, or test fixture were to produce a non-ISO string, it would silently pass through as the `createdAt` or `readAt` value in the API response, violating the DTO contract.
- **Evidence:**
  ```ts
  // packages/notifications/src/routes.ts:103-109
  function toIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }
    return value instanceof Date ? value.toISOString() : value;  // string passes through unvalidated
  }
  ```
- **Impact:** Low. Kysely with Postgres consistently returns timestamp columns as `Date` objects, so the string branch is unlikely to be exercised in practice. The type signature is broader than necessary and the fallback is a silent passthrough.
- **Recommendation:** Narrow the signature to `Date | null` since DB columns will always yield `Date`. If the `string` branch is needed for legacy reasons, add a runtime assertion: `if (typeof value === 'string' && !isIsoDateString(value)) throw new Error(...)`.

---

### [LOW] `serializeNotification` is exported from routes.ts and imported by tools.ts — thin coupling across route/tool layers

- **File:** `packages/notifications/src/tools.ts:6`, `packages/notifications/src/routes.ts:90`
- **Category:** Architecture / Quality
- **Finding:** `serializeNotification` is a route-layer concern (it converts the DB row to a wire DTO). It is defined in `routes.ts` and then imported by `tools.ts`. This creates a dependency from the tool layer into the route layer — the opposite of the expected dependency direction. If serialization logic ever diverges between REST and AI tool responses, this coupling will need to be broken, and the fix will require a refactor.
- **Evidence:**
  ```ts
  // packages/notifications/src/tools.ts:6
  import { serializeNotification } from "./routes.js";
  ```
- **Impact:** Low for the current single-user notification DTO. Becomes a maintainability issue if the REST DTO and AI tool DTO diverge (e.g., if the tool response should omit `body` for prompt-safety reasons).
- **Recommendation:** Move `serializeNotification` (or a shared `toNotificationDto`) into `repository.ts` or a dedicated `serializer.ts` / inline it in each consumer. Both `routes.ts` and `tools.ts` then import from the canonical location.

---

### [INFO] No route or tool for creating notifications on behalf of another user — correct for current scope

- **File:** `packages/notifications/src/routes.ts`, `packages/notifications/src/manifest.ts`
- **Category:** Security (positive observation)
- **Finding:** There is no `POST /api/notifications` route, no `notifications.create` assistant tool, and no public API for creating notifications targeting another user. The only way notifications enter the system is via: (a) `repository.create()` called internally (always self-targets due to the RLS policy), or (b) bootstrap SQL seeding. This is correct for the current "self-notification only" design. Cross-user delivery is blocked at multiple layers: missing route, missing tool, and RLS policy.
- **Recommendation:** Document this constraint explicitly in the manifest's module description or a comment in `repository.ts`. As the system grows (worker jobs, system alerts), the absence of a delivery mechanism should be a deliberate design decision, not an accidental omission.

---

### [INFO] `notification_reads` SELECT policy depends on parent notifications SELECT policy via EXISTS subquery — correct but implicit

- **File:** `packages/notifications/sql/0008_notifications_module.sql:61-110`
- **Category:** Security (positive observation)
- **Finding:** The `notification_reads` SELECT, INSERT, and UPDATE policies all use `EXISTS (SELECT 1 FROM app.notifications WHERE id = notification_id)` to ensure a user can only interact with read-state for notifications they can see. Since the `notifications` SELECT policy enforces `recipient_user_id = current_actor_user_id()`, this EXISTS subquery correctly inherits that restriction. The dependency is implicit and relies on policy-layer composition.
- **Recommendation:** Add a comment in the SQL policy noting this dependency: "EXISTS relies on app.notifications SELECT policy filtering to recipient_user_id = current_actor". This makes the security composition explicit for future policy reviewers.

---

### [INFO] Worker has no SELECT, INSERT, or UPDATE grant on notifications tables — correct for current design

- **File:** `packages/notifications/sql/0008_notifications_module.sql:24-25`
- **Category:** Security (positive observation)
- **Finding:** Only `jarvis_app_runtime` holds grants (`SELECT, INSERT` on notifications; `SELECT, INSERT, UPDATE` on notification_reads). The worker runtime has no access. The integration test at line 84-113 explicitly asserts `worker_can_select: false` for both tables. This is the correct least-privilege posture for the current design where notifications are created only in the context of an authenticated user session.
- **Recommendation:** No action required for the current design. If a future milestone adds worker-driven notification delivery, this grant audit test should be updated alongside the delivery mechanism.

---

## Cross-Module Observations

- **Briefings integration (safe):** `packages/briefings/src/repository.ts` invokes `notifications.listVisible` as a tool, receives the full serialized DTO (including `body` and `metadata`), but the `summarizeToolResult` function only extracts `title` and `readAt` into the `ToolSummary.excerpts` — the full DTO data is not stored in `briefing_runs.source_metadata`. The briefing pipeline does not leak notification body content into AI prompts.
- **Export script cross-user read (intentional operator privilege):** `scripts/export-user-data.ts` reads notifications via `scopedDb.db` with a raw `sql` template that includes `WHERE recipient_user_id = $userId OR actor_user_id = $userId`. This runs inside a `withDataContext` call scoped to the target user's ID, meaning it goes through RLS. The query's explicit WHERE clause is redundant (RLS would filter anyway for `recipient_user_id`) but not harmful. The `OR actor_user_id = $userId` clause exports notifications where the user was the actor — correct for a full data export.
- **Delete script (correct):** `scripts/delete-user-data.ts` deletes from `app.notifications WHERE recipient_user_id = $1 OR actor_user_id = $1` — this uses the bootstrap connection (bypasses RLS) and correctly covers both owner relationships.
- **Module isolation (clean):** No package outside `@jarv1s/notifications`, `@jarv1s/module-registry`, and test files imports from or queries `app.notifications` via Kysely.
