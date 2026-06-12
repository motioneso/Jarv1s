# Spec: Audit Slice B — Dead Subsystem Deletion

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #120, #153, #115, #116, #152 (direct); advances #155, #127, #101
**Tier:** `security` (schema migration with DROP TABLE + dead auth writes)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 1 (DROP migration; number assigned at build time — do not pre-assign)
**Dependency:** First on migration spine after Slice A. Slice D must not start until B merges.
Slice E must rebase on top of B.

---

## Context

The workspace/resource-grant subsystem was designed in an early phase and was subsequently
de-scoped. No access-control decision in the live codebase uses it:

- `app.has_resource_grant` was removed from all active RLS policies as of `0019_tasks_owner_or_share.sql:8-10` ("no longer consulted").
- `app.workspace_memberships` gates no data access decision.
- `app.resource_grants` has live CRUD code but the grants affect nothing.

Despite being functionally dead, the tables carry full DML grants (`0004:87`, `0005:20`) with
**no RLS** (issues #115, #116) — so they are live surfaces for metadata enumeration that serve
no purpose. The correct fix is deletion, not patching dead code.

**Table provenance (verified):**

- `app.workspace_memberships` and `app.resource_grants`: created in `infra/postgres/migrations/0001_app_schema.sql:33,41`
- `app.workspaces`: created in `0004_auth_workspaces_settings.sql:47`
- `0002_app_rls.sql` created functions only; `0005` added grants

**FK facts:** `resource_grants`'s FKs point at `app.users` (not workspaces). `workspace_memberships.workspace_id` has **no FK** to `app.workspaces`. There are no inter-table FKs among the three tables. `CASCADE` is belt-and-braces only; **it will NOT remove `$$`-body SQL functions** (Postgres tracks no dependency for string-body functions). Functions must be dropped explicitly.

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

### 1 — Migration: DROP tables + DROP functions

New file: `infra/postgres/migrations/<NNNN>_drop_dead_workspace_subsystem.sql`

```sql
-- Drop workspace subsystem tables and the dead grant-consuming functions.
-- Tables are functionally unused since 0019; deleting eliminates the no-RLS
-- metadata-enumeration surface (#120, #115, #116, #153).
--
-- CASCADE is belt-and-braces ordering only. It does NOT remove $$-body SQL functions
-- (no tracked Postgres dependency). Functions are dropped explicitly below.

DROP TABLE IF EXISTS app.resource_grants CASCADE;
DROP TABLE IF EXISTS app.workspace_memberships CASCADE;
DROP TABLE IF EXISTS app.workspaces CASCADE;

-- has_resource_grant: SECURITY DEFINER function, de-referenced from live policies at 0019.
-- Actual signature is (text, uuid, uuid) — confirmed at 0002_app_rls.sql:43-47.
DROP FUNCTION IF EXISTS app.has_resource_grant(text, uuid, uuid);

-- has_resource_grant_level: created in packages/tasks/sql/0003_tasks_module.sql:45-90,
-- also queries resource_grants, still EXECUTE-granted to both runtime roles.
-- Placed here (infra/ DROP migration) because it references infra-owned tables.
-- The "module SQL lives in module sql/" rule applies to creation, not to dropping
-- tables/functions whose backing data no longer exists.
DROP FUNCTION IF EXISTS app.has_resource_grant_level(text, uuid, uuid, text[]);
```

**Post-migration verification (required as PR evidence):**

```sql
-- Must return 0 rows:
SELECT proname FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'app'
    AND proname LIKE 'has_resource_grant%';
```

This covers all overloads, not just `\d app.workspaces`.

### 2 — `scripts/delete-user-data.ts` and `scripts/export-user-data.ts` cleanup

**Critical:** these scripts are NOT operator-only. `scripts/delete-user-data.ts` is imported by
`packages/settings/src/routes.ts:48` and invoked at runtime by
`POST /api/admin/users/:id/reject` and `DELETE /api/admin/users/:id` via `tearDownAccount`
(routes.ts:416). After the DROP migration, without this fix, every admin user deletion/rejection
500s with a missing-table error.

**`scripts/delete-user-data.ts`:**

- Remove the `DELETE FROM app.workspace_memberships` entry (≈ line 34)
- Remove the `DELETE FROM app.resource_grants` entry (≈ line 35)

**`scripts/export-user-data.ts`:**

- Remove `workspaceMembershipsQuery` (≈ lines 197–206) and its entry in the table list (≈ line 114)
- Remove the `resource_grants` query (≈ line 220) and its field references
- Remove any serialization/field references to `workspaces`, `memberships`, `activeWorkspaceId`

**Test required:** add an integration test assertion that `DELETE /api/admin/users/:id` succeeds
after the migration (the admin delete path is the attack-adjacent regression vector).

### 3 — `packages/settings/src/repository.ts` code deletion

Delete all workspace/membership/grant methods and their private helpers. Verify names against
the actual file before editing. Known methods to delete (lines are approximate — verify):

- `listWorkspacesForUser` (≈ line 145)
- `listMembershipsForUser` (≈ line 131)
- `listMembershipsForWorkspace` (≈ line 146)
- `createWorkspace` (≈ line 161)
- `upsertWorkspaceMembership` (≈ line 180)
- `deleteWorkspaceMembership` (≈ line 220)
- `listWorkspaces` / `getOrCreateDefaultWorkspace` (≈ line 114–121)
- `assertWorkspaceHasAnotherOwner` (≈ line 589–605)
- `listResourceGrants` and all resource-grant CRUD (≈ lines 290–361)
- Private helpers: `requireWorkspace`, `assertCanChangeWorkspaceMembershipRole`,
  `assertCanRemoveWorkspaceMembership`, `getWorkspaceMembership`, all related input interfaces

**Leave the `SettingsDb` type alias in place.** Slice D is the sole owner of its deletion.
The remaining methods (`countUsers`, `setUserStatus`, `setUserAdmin`, `listInstanceSettings`,
etc.) still use `SettingsDb` until Slice D converts them. If Slice B deletes the alias, those
methods break prematurely.

### 4 — `packages/settings/src/routes.ts` code deletion

- Remove `memberships` and `workspaces` fields from the `/api/me` response (≈ lines 98–104).
  Keep all other fields intact.
- Delete the entire workspace admin route block (≈ lines 140–285): `/api/admin/workspaces`,
  `/api/admin/workspaces/:id`, `/api/admin/workspaces/:id/memberships/*`, `/api/admin/resource-grants/*`.
- Delete `serializeWorkspace`, `serializeWorkspaceMembership`, `serializeResourceGrant`
  (≈ lines 630–659), and parse helpers: `parseCreateWorkspaceBody`,
  `parseWorkspaceMembershipBody`, `parseResourceGrantBody` (≈ lines 536–562), plus
  `requiredGrantLevel`/`requiredWorkspaceRole` (≈ lines 599–615) and workspace-specific
  Params interfaces (≈ lines 60–73).
- Delete route declarations in `packages/settings/src/manifest.ts:74-109` (the six
  workspace/resource-grant routes) and any workspace wording in permission descriptions (≈ lines 40, 47).
- Remove dead workspace error-handler branches (`"Workspace context is unavailable"` strings)
  from `packages/settings/src/routes.ts:708-717` and **also from**
  `packages/ai/src/routes.ts:826` and `packages/connectors/src/routes.ts:407`.

### 5 — `packages/shared/` DTO cleanup

Remove workspace/membership/resource-grant DTOs, JSON schemas, and route schemas from
`packages/shared/src/platform-api.ts`:

- `Workspace`/`ResourceGrant` DTO types (≈ lines 12–149)
- `workspace*`/`resourceGrant*` route schemas (≈ lines 265–310, 427–580)
- The `meRouteSchema.required` array (≈ line 400) must have `memberships`, `workspaces`, and
  `activeWorkspaceId` removed — leaving them in the `required` array causes Fastify
  serialization to fail once the `/api/me` response no longer returns those fields.

### 6 — `packages/db/src/types.ts` cleanup

Remove the `Workspaces`, `WorkspaceMemberships`, `ResourceGrants` table interfaces (≈ lines 83–105),
their `JarvisDatabase` keys (≈ lines 482–484), and their `Selectable` exports (≈ lines 518–520).

### 7 — `apps/web/src/` frontend cleanup

The web app is at `apps/web/` (not `packages/web/` — that path does not exist).

Known files with workspace references:

- `apps/web/src/api/client.ts`
- `apps/web/src/api/query-keys.ts`
- `apps/web/src/settings/settings-page.tsx` (17 workspace refs — delete workspace section)

E2e mock files also reference workspace fields:

- `tests/e2e/mock-api.ts` (6 refs)
- `tests/e2e/app-shell.spec.ts` (1 ref)

### 8 — Integration and e2e test cleanup

The shared integration test fixture seeds the dropped tables. These files must be updated:

- `tests/integration/test-database.ts:95-135` — remove workspace, workspace_memberships, and
  resource_grants seed inserts
- `tests/integration/auth-settings.test.ts` (33 refs) — delete workspace/grant test cases
- `tests/integration/foundation.test.ts` (9 refs) — remove workspace seed/assertion lines
- `tests/integration/release-hardening.test.ts:548` — remove direct resource_grants INSERT

After dropping the tables, add an assertion in the integration suite that the three tables no
longer exist (check via `information_schema.tables`).

### 9 — `packages/auth/src/index.ts` bootstrap cleanup

Delete the workspace and workspace-membership INSERT calls in `bootstrapFirstJarvisUser`
(≈ lines 356–376). After deletion, the `const workspaceId = randomUUID()` at ≈ line 356 is
also unused — delete it.

**The `admin_audit_events` INSERT (≈ line 379) is NOT touched here.** However, its metadata
object (`{ workspaceId }` at ≈ lines 386–388) references the now-deleted `workspaceId` variable.
Change the metadata to `{}` (empty object) as a stop-gap — Slice E will replace the entire insert
with a proper public API call. The insert itself stays; only the metadata changes from
`{ workspaceId }` to `{}`.

### 10 — `packages/structured-state/src/manifest.ts` narrowing (#152)

**BOTH `shareableResources` entries must be narrowed** (commitment at ≈ line 29, entity at ≈ line 30):

**Current:**

```typescript
["view", "contribute", "manage"];
```

**Fix (both entries):**

```typescript
["view"];
```

The `commitments`, `entities`, and `preferences` UPDATE/DELETE policies are strictly
`owner_user_id = current_actor_user_id()` — there is no "contribute" or "manage" pathway in the
DB. Advertising permissions that cannot be granted is misleading.

### 11 — `scripts/audit-release-hardening.ts` allowlist cleanup

The release-hardening audit's RLS exception list contains entries for `workspace_memberships`,
`resource_grants`, and `workspaces` (≈ lines 58–60). Delete these three entries. Their tables are
gone; stale allowlist entries are dead vocabulary and `pnpm audit:release-hardening` must be
green as part of the PR exit criteria.

---

## Hard invariants

- **Never edit applied migrations.** `0001`, `0002`, `0004`, `0005`, `0019`, `0028` are applied
  and hash-checked — do not touch them. The DROP is a new migration file.
- **Migration spine position:** Slice B must land before Slice D and Slice E.
- **No orphaned imports.** After deleting repository/route methods, verify no remaining imports
  of deleted symbols.
- **CASCADE does not remove functions.** The migration explicitly drops both `$$`-body functions.
  The post-migration verification (pg_proc query) is required evidence.
- **SettingsDb alias stays.** Slice D is the sole owner of the SettingsDb type alias deletion.
  Do not delete it in this PR.
- **meRouteSchema `required` array must be patched** to remove `memberships`/`workspaces`/
  `activeWorkspaceId` — otherwise `/api/me` Fastify serialization fails on the fields.
- **`pnpm audit:release-hardening` must be green** as PR exit criterion for this slice.

---

## Tests

- **Migration dry-run:** `pnpm db:migrate` on a fresh test DB must apply cleanly. Post-migration
  verification: the `pg_proc` query above must return 0 rows.
- **Admin delete-user regression:** `DELETE /api/admin/users/:id` must succeed after migration.
- **No regression in settings:** `pnpm verify:foundation` must pass.
- **Bootstrap still works:** `bootstrapFirstJarvisUser` must complete without error.
- **Manifest narrowing:** both `shareableResources` entries in `manifest.ts` export only `["view"]`.
- **Tables gone:** `SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('workspaces','workspace_memberships','resource_grants')` returns 0 rows.
- **`pnpm audit:release-hardening` green.**
- **grep clean:** after the PR, the following must return zero matches:
  ```
  grep -rE "app\.workspaces|app\.workspace_memberships|app\.resource_grants|has_resource_grant" \
    packages/ apps/ tests/ scripts/ --include="*.ts"
  ```
  (Exclude the new DROP migration file itself.)

---

## Out of scope

- `app.admin_audit_events` direct write in `packages/auth/src/index.ts` — Slice E fixes the
  module-isolation violation. This slice only removes the workspace writes and changes the
  metadata arg to `{}`.
- `#127` bootstrap GUC wrapping — Slice E.
- Resource-grant RLS fix — deleted, not patched.
- The `/api/admin/users` admin promotion route — not workspace-scoped, stays.
