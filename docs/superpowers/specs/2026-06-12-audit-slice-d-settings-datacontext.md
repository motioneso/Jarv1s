# Spec: Audit Slice D — Settings → DataContextDb

**Date:** 2026-06-12
**Audit issues:** #95, #155
**Tier:** `security` (DataContextDb bypass = GUC bypass = RLS bypass)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only; a GRANT adjustment may be needed but is not expected)
**Dependency:** Must land after Slice B. #155 evaporates entirely under B's deletion;
#95 scope shrinks dramatically. Do not start this PR until Slice B is on `origin/main`.

---

## Context

`SettingsRepository` accepts a raw `Kysely<JarvisDatabase>` (or `Transaction<JarvisDatabase>`)
directly from the constructor:

```typescript
// packages/settings/src/repository.ts:16
type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;
```

This bypasses the `DataContextDb` branded handle that all other repositories use. Without
`DataContextDb`, the `app.current_actor_user_id()` GUC is never set before queries, which means
RLS policies that rely on `current_actor_user_id()` do not fire. Reads that were meant to be
owner-scoped become unscoped — the "cross-user read" in issue #155 (`/api/me` returning another
user's workspace/membership rows) was a direct consequence.

After Slice B lands, the workspace/membership/grant methods and the `/api/me` workspace fields
are gone. The remaining settings repository methods cover: user reads (already behind
SECURITY DEFINER helpers in `0047`), admin user management (promote/demote), and audit event
writes. These still use the raw Kysely handle, so the structural gap remains.

**The fix is to replace the raw Kysely handle with `DataContextDb` throughout the settings
module**, following the pattern established in `packages/tasks/src/repository.ts`.

---

## Fix design

### 1 — Replace `SettingsDb` with `DataContextDb`

**`packages/settings/src/repository.ts`:**

```typescript
// Replace:
import type Kysely from "kysely";
// ...
type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;

// With:
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
```

Change the `SettingsRepository` constructor parameter from `SettingsDb` to `DataContextDb`.
Add `assertDataContextDb(scopedDb)` at the entry of every public method that accepts the handle.

**Pattern to follow** (from `packages/tasks/src/repository.ts`):
```typescript
async someMethod(scopedDb: DataContextDb, ...): Promise<...> {
  assertDataContextDb(scopedDb);
  // ... query using scopedDb
}
```

### 2 — Methods requiring the change (post-Slice-B scope)

After Slice B deletes workspace/membership/grant methods, the remaining public methods that
use `scopedDb` are approximately:

- `getUserById` / `getUser` (user lookup — already via SECURITY DEFINER but still uses handle)
- `listAllUsers` (admin)
- `updateUser` (admin promote/demote — the path exercised by `settings/repository.ts:473`)
- `insertAuditEvent` (private helper — called internally; receives scopedDb from callers)
- Any other remaining settings-domain methods

Build agent: grep for all methods accepting `SettingsDb` after Slice B merges, then replace
systematically. The type alias deletion itself will surface them as compile errors — follow the
compile-error chain.

### 3 — Update callers in `packages/settings/src/routes.ts`

Routes create the `SettingsRepository` via `new SettingsRepository(db)` where `db` is the raw
Kysely instance from Fastify's app injection. Update routes to use `DataContextRunner.withDataContext`
(the existing pattern from `packages/tasks/src/routes.ts`) so the handle passed to the repository
is a properly branded `DataContextDb`.

**Pattern:**
```typescript
await DataContextRunner.withDataContext(accessContext, scopedDb =>
  deps.settingsRepo.someMethod(scopedDb, ...)
);
```

The `accessContext` is already available in each route handler from the session resolver
(`request.session.accessContext` or equivalent — check the tasks routes for the exact shape).

### 4 — `assertDataContextDb` position

The guard must be the **first line** of each public repository method body, before any query.
This ensures that passing a raw `Kysely` instance (e.g., from a test or accidental mis-call)
throws a clear error immediately rather than silently bypassing RLS.

---

## Hard invariants

- **DataContextDb only.** After this PR, `SettingsRepository` must accept only `DataContextDb`.
  The `SettingsDb` type alias must be deleted entirely. No `| Transaction<JarvisDatabase>`
  union allowed — transactions are managed at the `DataContextRunner` level.
- **`assertDataContextDb` at every public method entry.** No public method may accept `scopedDb`
  without calling `assertDataContextDb(scopedDb)` as its first statement.
- **Admin promote/demote path must keep working.** `packages/settings/src/repository.ts:473`
  (the `updateUser` method with `is_instance_admin`) must continue to pass the integration test.
  `withDataContext` sets the GUC — the Slice A trigger uses it. Verify end-to-end.
- **No raw Kysely imports in `packages/settings/src/`.** After this PR, `grep -r "Kysely<" packages/settings/src/` must only match imports of `DataContextDb` from `@jarv1s/db`, not raw `Kysely<JarvisDatabase>`.

---

## Tests

- **`pnpm verify:foundation`** must be green. The settings integration tests cover user lookup,
  admin promotion/demotion, and `/api/me` — all of these exercise the changed code paths.
- **Compile check:** `pnpm typecheck` must pass with zero errors after the `SettingsDb` alias
  is removed. The compile-error-guided approach is the primary discovery mechanism.
- **Admin promote/demote regression:** `pnpm test:tasks` (which indirectly covers settings)
  and any settings-specific test in `tests/integration/` must pass.
- **Cross-user guard:** if a test can verify that settings repo methods reject a raw Kysely
  handle (i.e., `assertDataContextDb` throws), add that assertion.

---

## Out of scope

- `packages/settings/src/index.ts` public API shape — only the repository internals change.
- Any new settings features or new audit-event schema.
- The `admin_audit_events` direct write from `packages/auth/src/index.ts` — that is Slice E.
- Workspace/membership/grant code — deleted by Slice B, not touched here.
