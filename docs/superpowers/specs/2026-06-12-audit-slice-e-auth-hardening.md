# Spec: Audit Slice E — Auth Bootstrap Hardening

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #101, #127, #141
**Tier:** `security` (auth module, bootstrap path, cross-module table write)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)
**Dependency:** Must land after Slice D. Slice E's `recordAuditEvent` delegates to
`insertAuditEvent`, which Slice D has converted to accept `DataContextDb`. E must not start
until D is on `origin/main`. Build agent must rebase on `origin/main` after both B and D merge
before opening the PR.

**Excluded:** #113 (bearer-token opaque API-key path) is intentionally excluded — tracked in
GitHub issue #183 as a proper API-key feature milestone.

---

## Context

Three independent hardening gaps in `packages/auth/`:

- **#101 — module isolation:** `packages/auth/src/index.ts` writes directly to
  `app.admin_audit_events` (≈ line 379), which is owned by the settings module. The auth module
  has no business performing direct DML on settings-owned tables. This is a hard module-isolation
  violation.
- **#127 — bootstrap GUC bypass:**
  `bootstrapFirstJarvisUser` (≈ lines 306–394) performs DML using a raw `appDb` handle **outside**
  a `DataContextRunner.withDataContext` call, without the GUC `app.current_actor_user_id()` set.
  After Slice B removes the workspace inserts, the only remaining bootstrap DML is an audit event
  write (via `app.admin_audit_events` — see #101). Both violations must be fixed together:
  the audit insert is replaced with a settings module call, and that call happens inside
  `withDataContext`.
- **#141 — session IDs in revoke-sessions response and OAuth error body leak:**
  `POST /api/admin/users/:id/revoke-sessions` must not include session IDs, session tokens, or
  any `better_auth_sessions` column value in the HTTP response body.
  Also `packages/connectors/src/oauth.ts:103-112` includes the raw Google token-endpoint response
  body in a thrown `Error`, which can reach both logs AND HTTP response bodies.

---

## Fix design

### #101 + #127 — Wrap `bootstrapFirstJarvisUser` in `withDataContext`; replace direct audit insert

**Location:** `packages/auth/src/index.ts`.

**Transaction nesting: replace, never wrap.** The existing function opens a
`appDb.transaction().execute(...)` block that wraps the advisory lock, user-count check,
`is_bootstrap_owner`/`is_instance_admin` flag sets, and the audit insert.
`DataContextRunner.withDataContext` is an **instance method** (not static) that opens its own
Kysely transaction. This inner `transaction().execute()` block must be **replaced** by
`withDataContext`, never nested inside it — Kysely does not support calling `.transaction()` on
a handle that is already inside a transaction.

**The correct API call:**

```typescript
// DataContextRunner is passed in from server.ts — it is an instance, not a static class.
// withDataContext is an instance method:
await runner.withDataContext(
  { actorUserId: user.id, requestId: `bootstrap:${user.id}` },
  async (scopedDb) => {
    // Preserve ALL existing bootstrap logic here:
    // 1. Advisory xact lock: pg_try_advisory_xact_lock / pg_advisory_xact_lock
    // 2. isFirstUser check: app.count_all_users() — count, not count() = 1 literal
    // 3. UPDATE app.users SET is_bootstrap_owner = true WHERE id = user.id
    // 4. UPDATE app.users SET is_instance_admin = true WHERE id = user.id
    // 5. Pending-approval check and status update (if applicable to this code path)
    //
    // Replace the direct admin_audit_events insert with:
    await dependencies.settings.recordAuditEvent(scopedDb, {
      actorUserId: user.id,
      action: "bootstrap_owner_created",
      targetType: "user", // NOT NULL in schema — always supply
      targetId: user.id,
      metadata: {}, // was { workspaceId } — Slice B changed it to {}
      requestId: `bootstrap:${user.id}`
    });
  }
);
```

**Acceptance check:** `grep -n "appDb\." packages/auth/src/index.ts` — must return zero DML
calls (`insertInto`, `updateTable`, `deleteFrom`, `transaction().execute`) inside
`bootstrapFirstJarvisUser`. Read calls using `appDb` (e.g., a pre-flight count) are acceptable,
but there should be none — all reads happen inside `withDataContext` via `scopedDb`.

### #101 + #127 — `recordAuditEvent` public API (settings module)

Slice D converts `SettingsRepository` to the DataContextDb pattern, including the private
`insertAuditEvent` method. This slice adds a **public** `recordAuditEvent` function exported
from `packages/settings/src/index.ts`:

```typescript
// packages/settings/src/index.ts
export async function recordAuditEvent(
  scopedDb: DataContextDb,
  event: {
    actorUserId: string;
    action: string;
    targetType: string; // NOT NULL in app.admin_audit_events schema — always required
    targetId: string;
    metadata: Record<string, unknown>;
    requestId: string;
  }
): Promise<void> {
  assertDataContextDb(scopedDb);
  await new SettingsRepository().insertAuditEvent(scopedDb, event);
}
```

`targetType` is NOT NULL in the schema — callers must always supply it. `recordAuditEvent`
calls `assertDataContextDb(scopedDb)` before any work.

**Module isolation:** the auth module calls `recordAuditEvent` via `@jarv1s/settings` (the
package public API), NOT by importing `SettingsRepository` directly or querying
`app.admin_audit_events` directly. Add `@jarv1s/settings` to auth's `package.json` dependencies.

### #101 + #127 — Dependency wiring

`packages/auth/src/index.ts` currently receives `appDb`. After this change it must also receive:

- A `DataContextRunner` instance (`runner`) — instance method, not static
- A `settings.recordAuditEvent` reference (or a `settings` dependency object)

**Options — pick one and specify in the PR:**

1. Extend the auth init function signature: `initAuth({ appDb, runner, settings: { recordAuditEvent } })`
2. Add fields to the existing auth deps object

`apps/api/src/server.ts` (≈ line 54) must be updated to pass both. The `DataContextRunner`
instance already exists there — thread it through, do NOT create a new one in auth.

### #127 — 0055 trigger semantics

The `0055_users_guard_admin_flag_v2.sql` trigger checks `app.any_admin_exists()` (NOT the
superseded `count_all_users() = 1` check — that was 0053's trigger, which 0055 replaces).
Under `withDataContext`, the bootstrap `is_instance_admin = true` update fires the trigger.
The trigger's `any_admin_exists()` check evaluates against the in-progress transaction state —
verify that bootstrap's flow still satisfies it after the update. The bootstrap path that runs
this code is the first-user path where no admin exists yet. Confirm the logic is correct for
this path.

### #141 — Revoke sessions: don't expose session identifiers

**Location:** `packages/settings/src/routes.ts` — `POST /api/admin/users/:id/revoke-sessions`.

The HTTP response must contain no session IDs, session tokens, or any `better_auth_sessions`
column value. Acceptable responses: `{ success: true, count: N }` or `204 No Content`.

**grep check:** `grep -n "session" packages/settings/src/routes.ts` — review every field in the
route's response serialization.

**Scope of `revokeUserSessions`:** the repository method's WHERE clause must target
`user_id = targetUserId` only (NOT the calling admin's user ID). Verify the method does not
accidentally revoke the admin's own sessions.

### #141 — OAuth error body: sanitize to logs only

**Location:** `packages/connectors/src/oauth.ts:103-112`.

```typescript
// BEFORE:
const detail = await response.text();
throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);

// AFTER:
const detail = await response.text();
logger.error({ statusCode: response.status, detail }, "Google token exchange failed");
throw new Error(`Google token endpoint returned ${response.status}`);
```

Log `detail` server-side for debugging but do NOT include it in the thrown `Error` message.
`handleRouteError` passes the Error message to the HTTP response — `detail` must not reach
either logs via the Error path or HTTP response bodies.

---

## Hard invariants

- **`withDataContext` replaces, never nests.** The existing `appDb.transaction().execute()` block
  is deleted. `withDataContext` is the single transaction boundary.
- **No raw `appDb` DML in `bootstrapFirstJarvisUser`.** Zero `insertInto`/`updateTable`/
  `deleteFrom`/`transaction` calls on `appDb` in that function after this PR.
- **No direct `app.admin_audit_events` INSERT in auth.** Auth calls `settings.recordAuditEvent`
  via the public API — it does not import `SettingsRepository` or write the table directly.
- **`withDataContext` is an instance method.** `runner.withDataContext(...)` — not
  `DataContextRunner.withDataContext(...)` (that would fail at runtime: no static method).
- **Session IDs/tokens never in HTTP responses.** The revoke-sessions endpoint returns count
  only; OAuth error detail goes to server logs only.
- **Slice D must land first.** `insertAuditEvent` must already accept `DataContextDb`.

---

## Tests

- **`pnpm verify:foundation`** green.
- **Bootstrap regression:** `bootstrapFirstJarvisUser` completes without error; the user has
  `is_bootstrap_owner = true` and `is_instance_admin = true` in DB after the call.
- **0055 trigger:** the admin flag set during bootstrap passes the 0055 trigger under
  `withDataContext`. Confirm in `tests/integration/auth-settings.test.ts`.
- **Audit event written:** after bootstrap, `app.admin_audit_events` has a row with
  `action = 'bootstrap_owner_created'` and the correct `actor_user_id`.
- **No raw appDb DML:** `grep -n "appDb\." packages/auth/src/index.ts` — zero DML calls in
  `bootstrapFirstJarvisUser`.
- **Module isolation grep:** `grep -rn "admin_audit_events" packages/auth/src/ --include="*.ts"`
  must return zero matches after this PR.
- **Revoke sessions:** HTTP response body contains no session ID, token, or
  `better_auth_sessions` column. Only the calling admin's target-user sessions are revoked;
  the admin's own session survives.
- **OAuth sanitization:** triggering a token-exchange failure must not include the raw error
  body in the HTTP response or in the `Error` object that propagates.

---

## Out of scope

- **#113 bearer-token API-key path** — tracked in GitHub issue #183.
- Full better-auth integration test rewrites.
- Any new audit event schema.
- Multi-session token rotation beyond simple deletion.
