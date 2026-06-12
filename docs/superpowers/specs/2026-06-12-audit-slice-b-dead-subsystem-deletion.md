# Spec: Audit Slice B — Dead Subsystem Deletion

**Date:** 2026-06-12
**Audit issues:** #120, #153, #115, #116, #152 (direct); advances #155, #127, #101
**Tier:** `security` (schema migration with DROP TABLE + dead auth writes)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 1 (DROP migration; number assigned at build time — do not pre-assign)
**Dependency:** First on migration spine after Slice A. Slice D must not start until B merges.

---

## Context

The workspace/resource-grant subsystem was designed in an early phase and was subsequently
de-scoped. No access-control decision in the live codebase uses it:

- `app.has_resource_grant` was removed from all active RLS policies as of `0019_tasks_owner_or_share.sql:8-10` ("no longer consulted").
- `app.workspace_memberships` gates no data access decision (dropped at `0028`).
- `app.resource_grants` has live CRUD code but the grants affect nothing.

Despite being functionally dead, the tables carry full DML grants (`0004:87`, `0005:20`) with
**no RLS** (issues #115, #116) — so they are live surfaces for metadata enumeration that serve
no purpose. The correct fix is deletion, not patching dead code.

**Keystone fix:** Deleting this subsystem closes or substantially advances seven issues:
- **#120** — workspaces table with no RLS → gone
- **#153** — resource-grants CRUD is no-op → gone
- **#115** — resource_grants no RLS → gone (table gone)
- **#116** — workspace_memberships no RLS → gone (table gone)
- **#152** — manifest advertises unenforceable `["contribute","manage"]` → narrowed to `["view"]`
- **#155** — `/api/me` cross-user reads of workspace/membership → gone (routes gone)
- **#101** (partial) — auth bootstrap writes `app.workspaces` + `app.workspace_memberships` directly → those writes go away (the remaining `admin_audit_events` write is Slice E's job)
- **#127** (partial) — bootstrap workspace inserts are the primary non-GUC-wrapped write → workspace inserts go away; remaining bootstrap hardening is Slice E

---

## Fix design

### 1 — Migration: DROP tables + DROP function

New file: `infra/postgres/migrations/<NNNN>_drop_dead_workspace_subsystem.sql`

```sql
-- Drop workspace subsystem tables, the dead resource-grant function, and their
-- dependent objects. All are functionally unused; deleting eliminates the no-RLS
-- metadata-enumeration surface (#120, #115, #116, #153).

-- resource_grants may have FK referencing workspaces; CASCADE handles ordering.
DROP TABLE IF EXISTS app.resource_grants CASCADE;
DROP TABLE IF EXISTS app.workspace_memberships CASCADE;
DROP TABLE IF EXISTS app.workspaces CASCADE;

-- has_resource_grant was the only consumer of the above tables in RLS context.
-- It was already de-referenced from live policies at 0019. Drop the dead function.
DROP FUNCTION IF EXISTS app.has_resource_grant(text, uuid, text) CASCADE;
```

**Why migration lives in `infra/postgres/migrations/`:** the tables were created there
(`0002_app_rls.sql`, `0004`, `0005`). The DROP goes in the same directory so the migration
spine handles it before module-level migrations.

**CASCADE scope:** `resource_grants` has FKs to `workspaces`; CASCADE drops them in safe order.
No other tables reference `app.workspaces`, `app.workspace_memberships`, or `app.resource_grants`
(verify with `\d+` in a test DB after the migration dry-run; add to PR test evidence).

### 2 — `packages/settings/src/repository.ts` code deletion

Delete all workspace/membership/grant methods and their private helpers. After deletion, the
file must still compile.

**Methods to delete (lines as of the audited ref — verify against working-tree before editing):**
- `listWorkspacesForUser` (≈ line 116)
- `listMembershipsForUser` (≈ line 131)
- `listMembershipsForWorkspace` (≈ line 146)
- `createWorkspace` (≈ line 161)
- `upsertWorkspaceMembership` (≈ line 180)
- `deleteWorkspaceMembership` (≈ line 220)
- `listResourceGrants` and all resource-grant CRUD (≈ lines 290–361)
- Private helpers: `requireWorkspace`, `assertCanChangeWorkspaceMembershipRole`,
  `assertCanRemoveWorkspaceMembership`, `getWorkspaceMembership` (≈ lines 549–617)

Also delete the `SettingsDb` type alias if it referenced workspace-specific unions.

### 3 — `packages/settings/src/routes.ts` code deletion

- Remove `memberships` and `workspaces` fields from the `/api/me` response (≈ lines 98–104).
  Keep all other fields intact.
- Delete the entire workspace admin route block (≈ lines 140–277): `/api/admin/workspaces`,
  `/api/admin/workspaces/:id`, `/api/admin/workspaces/:id/memberships/*`, `/api/admin/resource-grants/*`.
- Delete the `serializeWorkspace` and `serializeWorkspaceMembership` helpers (≈ lines 630–636).

Update the `@jarv1s/shared` API types to remove the `memberships`/`workspaces` fields from the
`/api/me` response DTO, so the frontend's TypeScript stays clean.

### 4 — `packages/auth/src/index.ts` bootstrap cleanup

Delete the workspace and workspace-membership INSERT calls in `bootstrapFirstJarvisUser`
(≈ lines 356–376). The `admin_audit_events` direct write (≈ line 379) is **not** touched here
— Slice E handles that with proper module-isolation via a settings public API call.

After this deletion, `bootstrapFirstJarvisUser` should only: create the user record, promote
them to admin, and write one audit event (which Slice E will fix). No workspace writes remain.

### 5 — `packages/structured-state/src/manifest.ts` narrowing (#152)

**Current (≈ line 29–31):**
```typescript
["view", "contribute", "manage"]
```

**Fix:**
```typescript
["view"]
```

The `commitments`, `entities`, and `preferences` UPDATE/DELETE policies are strictly
`owner_user_id = current_actor_user_id()` — there is no "contribute" or "manage" pathway in the
DB. Advertising permissions that cannot be granted is misleading and causes downstream confusion.

---

## Hard invariants

- **Never edit applied migrations.** The DROP is a new migration file. `0002_app_rls.sql`,
  `0004`, `0005`, `0019`, `0028` are applied and hash-checked — do not touch them.
- **Migration spine position:** Slice B must land before Slice D (which depends on the workspace
  methods being gone) and before Slice E (which rebases its auth bootstrap fix on top of B's
  removal). Do not merge D or E until B is on `origin/main`.
- **No orphaned imports.** After deleting the repository and route methods, verify there are no
  remaining imports of the deleted symbols (grep for `listWorkspacesForUser`, `createWorkspace`,
  `resource_grants`, `serializeWorkspace` etc.).
- **No silent CASCADE surprises.** The migration dry-run must log what CASCADE drops. Include
  this output as PR evidence. If CASCADE unexpectedly drops something live, stop and escalate.
- **Shared DTO types must stay in sync.** If `/api/me` DTO in `packages/shared/` references
  `memberships`/`workspaces`, remove them. Frontend code that reads these fields must be removed
  or updated (grep `memberships` and `workspaces` in `packages/web/src/`).

---

## Tests

- **Migration dry-run:** `pnpm db:migrate` on a fresh test DB must apply cleanly; confirm the
  three tables and the function are gone (`\d app.workspaces` returns "does not exist").
- **No regression in settings:** `pnpm test:tasks` and the full `pnpm verify:foundation` gate
  must pass. The settings suite covers `/api/me` and admin user-management paths.
- **Bootstrap still works:** the first-run bootstrap flow (create user, promote to admin) must
  still function. Add an integration test assertion or verify manually that `bootstrapFirstJarvisUser`
  completes without error.
- **Manifest narrowing:** `packages/structured-state/src/manifest.ts` exports only `["view"]` —
  add a unit assertion or confirm via `pnpm typecheck` (the type is a literal union).
- **grep clean:** after the PR, `grep -r "app.workspaces\|app.workspace_memberships\|app.resource_grants\|has_resource_grant" packages/ --include="*.ts"` must return nothing except migration files and the new DROP migration.

---

## Migration skeleton (reference for build agent)

```
infra/postgres/migrations/<NNNN>_drop_dead_workspace_subsystem.sql
```

One migration file. No module-level SQL changes needed (the tables live in `infra/` migrations).

---

## Out of scope

- `app.admin_audit_events` direct write in `packages/auth/src/index.ts` — that is Slice E's job
  (module-isolation fix, not a workspace write).
- Any workspace-related UI screens in `packages/web/` beyond the API type removals required to
  compile cleanly. If workspace UI components exist, delete them in the same PR (dead code), but
  do not add workspace UI as a reason to defer this slice.
- The `/api/admin/users` admin promotion route — that is not workspace-scoped and stays.
- Resource-grant RLS fix — deleted, not patched.
- `#127` bootstrap GUC wrapping — Slice E; Slice B only removes the workspace writes.
