# Spec: Audit Slice D — Settings → DataContextDb

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #95, #155
**Tier:** `security` (DataContextDb bypass = GUC bypass = RLS bypass)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only; a GRANT adjustment may be needed but is not expected)
**Dependency:** Must land after Slice B. #155 evaporates entirely under B's deletion;
#95 scope shrinks dramatically. Do not start this PR until Slice B is on `origin/main`.

---

## Context

`SettingsRepository` accepts a raw `Kysely<JarvisDatabase>` directly from its constructor, via the
`SettingsDb` type alias:

```typescript
// packages/settings/src/repository.ts:16
type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;
```

This bypasses the `DataContextDb` branded handle that all other repositories use. Without
`DataContextDb`, `app.current_actor_user_id()` GUC is not reliably set before queries.

After Slice B lands, the workspace/membership/grant methods are gone. The remaining settings
repository methods cover: user reads (via SECURITY DEFINER helpers), admin user management
(promote/demote), instance settings, and audit event writes. These still use the raw Kysely handle.

**Note on existing manual GUC calls:** `setUserStatus` (≈ lines 416–419) and `setUserAdmin`
(≈ lines 454–457) already call `set_config('app.actor_user_id', input.actorUserId, true)` manually
AND open their own inner `transaction().execute(...)` wrappers to satisfy the Slice A trigger
(`0055_users_guard_admin_flag_v2.sql`). The conversion to DataContextDb **must remove both** the
inner transaction wrappers and the manual `set_config` calls — `withDataContext` provides both.
Failing to remove the inner transaction wrappers causes a runtime error: Kysely does not support
calling `.transaction()` on a handle that is already a `Transaction`.

**The fix is to replace the raw Kysely handle with `DataContextDb` throughout the settings
module**, following the pattern established in `packages/tasks/src/repository.ts`.

---

## Fix design

### 1 — Per-method `DataContextDb` parameter (tasks pattern)

`DataContextDb` only exists inside a `withDataContext` callback — it cannot be held in a
constructor. The `SettingsRepository` constructor must NOT hold a `DataContextDb`. The correct
pattern (verified from `packages/tasks/src/repository.ts`) is:

**Delete the constructor's db parameter.** Every public method takes `scopedDb: DataContextDb`
as its first parameter. Remove `this.db` and all its usages, including the defaulted private
parameter patterns like `db: SettingsDb = this.db` at ≈ lines 539, 549, 620.

```typescript
// WRONG (what the old code does — do not preserve this pattern):
class SettingsRepository {
  constructor(private db: SettingsDb) {}
  async someMethod(...) { ... this.db.selectFrom(...) ... }
}

// CORRECT (tasks pattern):
class SettingsRepository {
  // No db in constructor
  async someMethod(scopedDb: DataContextDb, ...): Promise<...> {
    assertDataContextDb(scopedDb);
    return scopedDb.db.selectFrom(...) ...
  }
}
```

Add `import { assertDataContextDb, type DataContextDb } from "@jarv1s/db"`. Delete the
`SettingsDb` type alias — **Slice D is the sole owner of its deletion.**

### 2 — Bootstrap-status exception: `countUsers`

`GET /api/bootstrap/status` calls `repository.countUsers()` with no session and no actor.
`DataContextRunner.withDataContext` throws when `actorUserId` is absent — so this route cannot
use `withDataContext`.

**Decision:** carve `countUsers` out of `SettingsRepository` into a narrow
`BootstrapHelper` (or a module-level function) in `packages/settings/src/bootstrap.ts` that
accepts the root `Kysely<JarvisDatabase>` handle directly. `countUsers` calls
`app.count_all_users()` (a `SECURITY DEFINER` function with no private data) — raw access is
safe and intentional here.

The routes dependency object keeps a `rootDb: Kysely<JarvisDatabase>` field **only** for this
one use case. The grep invariant (zero `Kysely<` in `packages/settings/src/`) has one documented
exception: `packages/settings/src/bootstrap.ts` and the routes dep that passes `rootDb` to it.
Document this exemption in the spec and in a code comment.

### 3 — Methods requiring conversion (post-Slice-B scope)

Verified method list from `packages/settings/src/repository.ts` — read the file before editing,
do not rely on these line numbers:

**Public methods (all need `scopedDb: DataContextDb` as first param + `assertDataContextDb`
at method entry):**

- `countUsers` — **exception**: moves to `bootstrap.ts` (see §2)
- `getUserById` (was incorrectly named `getUser` in prior drafts — verify actual name)
- `listUsers` (admin user listing — not `listAllUsers`)
- `setUserAdmin` (≈ line 454 — sets `is_instance_admin`; must remove inner transaction AND
  manual `set_config` call)
- `setUserStatus` (≈ line 416 — must remove inner transaction AND manual `set_config` call)
- `listInstanceSettings`
- `upsertInstanceSetting`
- `getRegistrationSettings`
- `setRegistrationSettings`
- `listAdminAuditEvents`
- `assertNotLastActiveAdmin` (≈ line 629 — public, called from `routes.ts:415`; uses `this.db`)

**Private helpers (update to accept `scopedDb` from callers):**

- `requireUserRow`
- `assertAnotherActiveAdmin`
- `insertAuditEvent` (Slice E will expose a public version; keep the private helper for now)

Build agent: compile-error-guided discovery is the primary mechanism. The type alias deletion
surfaces all remaining raw-handle usages as errors.

### 4 — Remove inner transactions and manual `set_config` from `setUserStatus`/`setUserAdmin`

**Critical path — must not be missed:**

Both methods currently do:

```typescript
// ≈ lines 416-419 (setUserStatus) and 454-457 (setUserAdmin):
await this.db.transaction().execute(async (tx) => {
  await tx.executeQuery(sql`SELECT set_config('app.actor_user_id', ${input.actorUserId}, true)`);
  // ... DML ...
});
```

After DataContextDb conversion, `scopedDb` is already a `Transaction` — calling `.transaction()`
on it is a runtime error. The `withDataContext` call in the route already sets the GUC.

**Fix:** delete both `transaction().execute()` wrappers and the `set_config` calls entirely:

```typescript
async setUserAdmin(scopedDb: DataContextDb, input: SetUserAdminInput): Promise<...> {
  assertDataContextDb(scopedDb);
  // GUC already set by withDataContext. No inner transaction. No set_config.
  return scopedDb.db.updateTable("app.users").set({ is_instance_admin: input.isAdmin })
    .where("id", "=", input.userId)
    .execute();
}
```

Add a regression test that `setUserAdmin` still triggers the 0055 trigger correctly under
`withDataContext` (the trigger checks `app.current_actor_user_id()`, which withDataContext sets).

### 5 — Routes wiring update

**`packages/settings/src/routes.ts`:**

1. Add `dataContext: DataContextRunner` to `SettingsRoutesDependencies` (≈ lines 51–58).
2. Update `apps/api/src/server.ts:130` to pass the existing `DataContextRunner` instance
   (already constructed at `server.ts:54`) into `settingsRoutes`.
3. In each route handler, replace raw repository calls with:
   ```typescript
   const accessContext = dependencies.resolveAccessContext(request);
   // (use the existing resolveAccessContext pattern — already used throughout this file)
   await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
     return dependencies.repository.someMethod(scopedDb, ...);
   });
   ```
4. Remove `appDb` from `SettingsRoutesDependencies` (subject to the bootstrap-status exception
   in §2 — keep a `rootDb` field ONLY for `bootstrap.ts`).
5. The route that constructs `SettingsRepository` at registration time
   (`dependencies.repository ?? new SettingsRepository(dependencies.appDb)` at routes.ts:83)
   — the constructor now takes no db argument; remove the argument.

### 6 — `assertDataContextDb` position

The guard must be the **first line** of each public repository method body, before any query.

---

## Hard invariants

- **DataContextDb only.** After this PR, `SettingsRepository` must accept only `DataContextDb`
  as the per-method handle. The `SettingsDb` type alias must be deleted entirely. No
  `| Transaction<JarvisDatabase>` union.
- **`assertDataContextDb` at every public method entry** (except the carved-out bootstrap helper).
- **No inner `transaction()` or manual `set_config` in `setUserStatus`/`setUserAdmin`.**
  `withDataContext` provides both.
- **`countUsers` exception is documented.** The `packages/settings/src/bootstrap.ts` raw-handle
  path has a code comment explaining why it is exempted.
- **Grep invariant:** `grep -rn "Kysely<" packages/settings/src/` must return **zero matches**,
  except for the documented `bootstrap.ts` exemption.
- **Admin promote/demote path must keep working.** The Slice A 0055 trigger checks
  `app.current_actor_user_id()` — `withDataContext` sets this. Verify end-to-end.

---

## Tests

- **`pnpm verify:foundation`** must be green.
- **Auth-settings and multi-user-isolation suites** — these are the settings integration tests,
  NOT `pnpm test:tasks`:
  - `tests/integration/auth-settings.test.ts` (constructs `new SettingsRepository(appDb)` at
    ≈ line 768 — must be updated to the new constructor-less pattern)
  - `tests/integration/multi-user-isolation.test.ts` (≈ line 305 — same issue)
  - Run: `vitest run tests/integration/auth-settings.test.ts tests/integration/multi-user-isolation.test.ts`
- **`assertDataContextDb` rejection test:** assert that passing an unbranded `Kysely` handle
  to any public repository method throws 'Repository access requires withDataContext'.
- **`setUserAdmin` trigger regression:** admin promote under `withDataContext` must pass the
  0055 trigger; verify the test exercises both the "can promote when no other admin blocks"
  and "self-escalation blocked when admin exists" paths.
- **Compile check:** `pnpm typecheck` must pass with zero errors after `SettingsDb` alias is deleted.

---

## Out of scope

- `packages/settings/src/index.ts` public API shape — only the repository internals change.
- Any new settings features or new audit-event schema.
- The `admin_audit_events` direct write from `packages/auth/src/index.ts` — that is Slice E.
- Workspace/membership/grant code — deleted by Slice B, not touched here.
