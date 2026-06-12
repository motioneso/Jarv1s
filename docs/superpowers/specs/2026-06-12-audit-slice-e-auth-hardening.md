# Spec: Audit Slice E — Auth Module Hardening

**Date:** 2026-06-12
**Audit issues:** #101, #127, #141
**Tier:** `security` (auth, module isolation, bootstrap, credential leak)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)
**Dependency:** Rebases on top of Slice B. The workspace writes at `auth/src/index.ts:356-376`
are gone after B merges; this slice fixes the remaining auth bootstrap issues. Build agent must
rebase on `origin/main` after Slice B lands before opening the PR.

**Excluded:** #113 (bearer-token opaque API-key path) is intentionally excluded — tracked in
GitHub issue #183 as a proper API-key feature milestone. No temporary fix needed: the
escalation path requires a leaked session UUID and expiry is already enforced server-side.

---

## Context

Three independent hardening gaps in `packages/auth/` and `packages/connectors/`:

- **#101 — module isolation:** `packages/auth/src/index.ts` writes directly to
  `app.admin_audit_events` (≈ line 379), which is owned by the settings module. The auth module
  imports no `@jarv1s/settings` dependency and has no business performing direct DML on
  settings-owned tables. This is a hard module-isolation violation.
- **#127 — bootstrap GUC:** `bootstrapFirstJarvisUser` (≈ lines 306–394) calls
  `set_config('app.actor_user_id', user.id, true)` at ≈ line 327, then performs DML on the
  app_runtime pool **outside** a `DataContextRunner.withDataContext` call. After Slice B removes
  the workspace inserts, the remaining bootstrap DML (audit event write) still happens without
  a properly established DataContext.
- **#141 — OAuth error body leak:** `packages/connectors/src/oauth.ts:103-112` includes the
  raw Google token-endpoint response body in a thrown `Error`, which propagates through
  `handleRouteError` to Fastify's default handler and ends up in logs. OAuth error bodies can
  contain partial credentials or structured sensitive data.

---

## Fix design

### #101 — Replace direct `admin_audit_events` insert with settings public API

**Location:** `packages/auth/src/index.ts` ≈ line 379.

**Current:**
```typescript
await db.insertInto("app.admin_audit_events").values({ ... }).execute();
```

**Fix:** Replace the direct insert with a call through the settings module's public API.
`@jarv1s/settings` must be added to auth's dependencies in `package.json`.

The settings module should expose (or already expose via `insertAuditEvent` or a public
function) a way for other modules to record an audit event given an actor, action, and target.
If no public function exists yet, add a minimal one to `packages/settings/src/index.ts`:

```typescript
export async function recordAuditEvent(
  scopedDb: DataContextDb,
  event: { actorUserId: string; action: string; targetUserId?: string }
): Promise<void> { ... }
```

Auth calls this function instead of writing directly to the table.

**Why not a shared event system:** the audit table is settings-domain. Auth recording its own
admin events via the settings public API is the correct module-isolation pattern. A shared
event bus is out of scope.

### #127 — Wrap bootstrap DML in withDataContext

**Location:** `packages/auth/src/index.ts:bootstrapFirstJarvisUser` (≈ lines 306–394).

After Slice B removes the workspace/membership inserts, the bootstrap function does:
1. Create the user record (this may already be in a transaction context from better-auth)
2. Promote to admin (UPDATE users SET is_instance_admin = true)
3. Write an audit event (now via settings public API — see #101 fix)

The raw `set_config` call must be replaced or wrapped. The pattern is:

```typescript
await DataContextRunner.withDataContext(
  { actorUserId: newUser.id, requestId: `bootstrap:${newUser.id}` },
  async (scopedDb) => {
    await db.updateTable("app.users")
      .set({ is_instance_admin: true })
      .where("id", "=", newUser.id)
      .execute();   // scopedDb here, not db
    await recordAuditEvent(scopedDb, { ... });
  }
);
```

**Bootstrap exemption interaction:** The Slice A trigger (`users_guard_admin_flag`) has a
bootstrap exemption: it allows `is_instance_admin = true` when `count_all_users() = 1`. This
means the `withDataContext` wrapping is safe — the GUC is set to the new user's ID, `is_instance_admin`
is being set to `true`, and only 1 user exists. The exemption fires. Verify this in the
integration test.

**Note on better-auth transaction context:** if better-auth's own hook already runs inside a
transaction, the `withDataContext` call must not create a conflicting transaction. Check whether
`DataContextRunner.withDataContext` is transaction-safe when called inside an existing
transaction — if not, thread the existing DB handle. Escalate to Coordinator if the better-auth
hook internals make wrapping non-trivial.

### #141 — Sanitize OAuth error body

**Location:** `packages/connectors/src/oauth.ts:103-112`.

**Current:**
```typescript
const detail = await response.text();
throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
```

**Fix:**
```typescript
const detail = await response.text();
logger.error({ statusCode: response.status, detail }, "Google token exchange failed");
throw new Error(`Google token endpoint returned ${response.status}`);
```

Log `detail` at the server side (so ops can debug OAuth failures) but do **not** include it in
the thrown `Error` message. The `handleRouteError` re-throw path will then only surface the
sanitized message. If no `logger` is available at that call site, use `console.error` and file
a follow-up to wire a proper logger.

---

## Hard invariants

- **Module isolation.** After this PR, `packages/auth/` must not contain any direct
  `insertInto` / `updateTable` calls targeting `app.admin_audit_events`,
  `app.workspaces`, or `app.workspace_memberships`. The only permitted tables for direct
  auth-module DML are auth-owned tables (`app.users`, `app.auth_accounts`,
  `app.better_auth_sessions`).
- **Secrets never in Error messages.** OAuth response bodies must be logged server-side only.
  They must never appear in `Error` objects, HTTP response bodies, or any path that reaches
  the frontend.
- **Bootstrap must keep working end-to-end.** After this PR, a fresh database first-run
  (user creation, admin promotion, audit event) must complete without errors. The Slice A
  trigger bootstrap exemption must fire correctly. Add an integration test or verify manually.
- **Rebase on top of B.** The workspace insert lines at ≈ lines 356–376 are gone after Slice B.
  Build agent must `git rebase origin/main` after B merges before starting this work.

---

## Tests

- **`pnpm verify:foundation`** must be green.
- **Bootstrap flow:** create a fresh DB, run the bootstrap flow, verify the user is promoted to
  admin and an audit event is recorded (via the settings repo, not via direct DML from auth).
- **OAuth error sanitization:** a test or manual curl that triggers a token-exchange failure
  must not return or log the raw response body in any user-visible or structured-log path.
- **Module isolation grep:** after the PR, `grep -r "admin_audit_events\|app.workspaces" packages/auth/src/ --include="*.ts"` must return nothing.

---

## Out of scope

- **#113 bearer-token API-key path** — intentionally excluded; tracked in GitHub issue #183.
- Full better-auth integration test rewrites.
- Logging infrastructure changes (the #141 fix may use `console.error` as a stop-gap).
- Any new audit event schema or new admin-action audit events.
