# Audit Slice B — Dead Subsystem Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the functionally-dead workspace/membership/resource-grant subsystem (tables, functions, routes, types, UI) to eliminate the no-RLS metadata-enumeration surface (issues #120, #115, #116, #153, #152, #155, #101-partial, #127-partial).

**Architecture:** A single DROP migration removes `app.workspaces`, `app.workspace_memberships`, `app.resource_grants`, and both `$$`-body functions (`has_resource_grant`, `has_resource_grant_level`) that query them. Server-side TypeScript — repository, routes, shared DTOs, and DB type map — is updated in a chain so the codebase never compiles against deleted tables. Frontend and test fixture updates follow the same serialization so each build gate passes end-to-end.

**Tech Stack:** PostgreSQL migration (raw SQL), Fastify + Kysely (server), React + React Query (web), Vitest integration tests, pnpm workspaces.

---

## Dependency note

This plan assumes Slice A is already merged. On the `infra/postgres/migrations/` spine the last
two files are `0053_users_guard_admin_flag.sql` and `0055_users_guard_admin_flag_v2.sql` (there is
no `0054` in `infra/` — `0054_worker_memory_rls.sql` is a module migration that lives in its
module's `sql/` dir), so the next infra file is `0056`. The new DROP migration in Task 1 is the
next file on the spine; **Slice D must not start until this PR merges. Slice E must rebase on top
of this PR.** Do not pre-assign a migration number — let the build runner assign it (it will be
`0056` unless another infra migration lands first).

---

### Task 1: Write and verify the DROP migration

**Files:**

- Create: `infra/postgres/migrations/0056_drop_dead_workspace_subsystem.sql` (the last infra
  migration is `0055`; `0056` is the next free prefix. If a concurrent Slice-A migration claimed
  `0056` first, use the next free number and propagate it to the `foundation.test.ts` migration-list
  entry in Task 1b — every reference to `0056` in this plan must match the filename you chose.)
- Test path: `tests/integration/foundation.test.ts` (migration list assertion at line 96)

- [ ] Create the migration file. The spec mandates this exact content:

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

- [ ] Run the migration against a fresh test DB to confirm it applies without error:

```bash
pnpm db:up && pnpm db:migrate
```

Expected: exits 0, no errors. The version recorded is the filename prefix you chose (`0056`); the runner only records it in `app.schema_migrations` — it does not invent a number.

- [ ] Run the pg_proc post-migration verification to confirm both functions are gone:

```bash
pnpm db:up
# Then in psql:
SELECT proname FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'app'
    AND proname LIKE 'has_resource_grant%';
```

Expected: **0 rows**. If any row appears, a function was missed. Save the query output as PR evidence.

- [ ] Verify the three tables are gone:

```bash
# In psql against test DB:
SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'app'
    AND table_name IN ('workspaces','workspace_memberships','resource_grants');
```

Expected: **0 rows**.

- [ ] Stage and commit:

```bash
git add infra/postgres/migrations/0056_drop_dead_workspace_subsystem.sql
git commit -m "feat(migration): drop dead workspace/grant subsystem tables and functions (#120 #115 #116 #153)"
```

---

### Task 1b: Strip workspace/grant seeds from shared fixtures so every suite's `resetEmptyFoundationDatabase`/`resetFoundationDatabase` stays green

**Why this is here and not in Task 13:** `tests/integration/test-database.ts`
`resetEmptyFoundationDatabase` re-runs **all** working-tree migrations, so the Task 1 DROP is live
in every test run from this point on. The shared fixtures still INSERT into the now-dropped tables
in `beforeAll`/`beforeEach`. Until these seeds are removed, `foundation.test.ts` (uses
`resetFoundationDatabase` → `seedProbeData`) and the entire `release-hardening.test.ts` suite (its
`beforeEach` calls `seedLifecycleData`) fail in setup with `relation "app.workspaces" does not
exist`. They must be removed **immediately after** the DROP migration and **before** any later task
asserts a suite is green.

**Files:**

- Modify: `tests/integration/test-database.ts` (lines 22, 93–107, 130–136)
- Modify: `tests/integration/release-hardening.test.ts` (lines 546–558 `seedLifecycleData` resource_grants INSERT)
- Modify: `tests/integration/foundation.test.ts` (migration-list assertion at line 96; new table-absence assertion)

- [ ] In `tests/integration/test-database.ts`, remove the `workspaceAlpha` id (line 22):

**Remove from the `ids` object:**

```typescript
  workspaceAlpha: "20000000-0000-4000-8000-000000000001",
```

- [ ] In `seedProbeData`, remove the workspaces INSERT (lines 93–99) and the workspace_memberships INSERT (lines 101–107):

**Remove these two query blocks:**

```typescript
await client.query(
  `
        INSERT INTO app.workspaces (id, name, created_by_user_id)
        VALUES ($1, 'Alpha Workspace', $2)
      `,
  [ids.workspaceAlpha, ids.userA]
);

await client.query(
  `
        INSERT INTO app.workspace_memberships (user_id, workspace_id, role)
        VALUES ($1, $2, 'member')
      `,
  [ids.userA, ids.workspaceAlpha]
);
```

- [ ] In `seedProbeData`, remove the resource_grants INSERT (lines 130–136):

**Remove:**

```typescript
await client.query(
  `
        INSERT INTO app.resource_grants (resource_type, resource_id, grantee_user_id, grant_level)
        VALUES ('rls_probe_item', $1, $2, 'view')
      `,
  [ids.itemBGrantedToA, ids.userA]
);
```

Note: the `foundation.test.ts` `beforeAll` already replaces this grant with an `app.shares` insert
(lines 52–65), so dropping the `resource_grants` seed does not change the RLS-probe coverage.

- [ ] In `tests/integration/release-hardening.test.ts`, remove the `resource_grants` INSERT in `seedLifecycleData` (lines 546–558):

**Remove:**

```typescript
await client.query(
  `
        INSERT INTO app.resource_grants (
          resource_type,
          resource_id,
          grantee_user_id,
          grant_level,
          granted_by_user_id
        )
        VALUES ('task', $1, $2, 'view', $3)
      `,
  [releaseIds.userBTask, ids.userA, ids.userB]
);
```

The export test (line 76) already asserts `expect(exportedJson).not.toContain("User B private task
granted to A")` by serialization shape, not by this grant, so removing the seed keeps that
assertion valid.

- [ ] Update the migration-list assertion in `tests/integration/foundation.test.ts` (the `toEqual`
      at line 96). Add the new DROP migration entry after the last existing entry
      (`{ version: "0055", name: "0055_users_guard_admin_flag_v2.sql" }`):

```typescript
        { version: "0056", name: "0056_drop_dead_workspace_subsystem.sql" }
```

Adjust the trailing comma on the previous line so the array stays valid. The number must match the
filename you chose in Task 1 (`0056` unless another infra migration landed first — confirm with
`SELECT version, name FROM app.schema_migrations ORDER BY version DESC LIMIT 5`).

- [ ] Add the table-absence assertion. Add a new `it` inside the
      `describe("MVP foundation scaffold")` block in `tests/integration/foundation.test.ts`
      (`Client` is already imported at line 22 via `const { Client } = pg`):

```typescript
it("confirms workspace/grant tables are absent after DROP migration", async () => {
  const client = new Client({ connectionString: connectionStrings.migration });
  await client.connect();
  try {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'app'
         AND table_name IN ('workspaces','workspace_memberships','resource_grants')`
    );
    expect(result.rows).toHaveLength(0);
  } finally {
    await client.end();
  }
});
```

- [ ] Run the two affected suites to confirm setup no longer throws. The `release-hardening` suite's
      new admin-delete test is added in Task 2, so expect only the _pre-existing_ tests here:

```bash
pnpm db:up && vitest run tests/integration/foundation.test.ts tests/integration/release-hardening.test.ts
```

Expected: green (setup seeds the dropped tables no longer; the new foundation table-absence test passes).

- [ ] Stage and commit:

```bash
git add tests/integration/test-database.ts tests/integration/release-hardening.test.ts tests/integration/foundation.test.ts
git commit -m "test(integration): drop workspace/grant fixture seeds; assert tables gone (#120 #115 #116 #153)"
```

---

### Task 2: Update `scripts/delete-user-data.ts` — remove dead table entries

**Files:**

- Modify: `scripts/delete-user-data.ts` (lines 34–35 in `userScopedCountQueries`)
- Test path: `tests/integration/release-hardening.test.ts`

First add the `createApiServer` import to the top of `tests/integration/release-hardening.test.ts`
(it is not currently imported — only `createDatabase`/`AuthSessionResolver` from `@jarv1s/db` are):

```typescript
import { createApiServer } from "../../apps/api/src/server.js";
```

- [ ] Write a failing integration test first. In `tests/integration/release-hardening.test.ts`,
      inside the existing `describe("M7 release hardening lifecycle scripts")` block, add a new `it`
      after the confirmation-mismatch test (the `it` that ends ≈ line 122). The two existing delete
      tests (`deleteUserData` direct, ≈ line 85) exercise the function; this new assertion covers the
      HTTP path that calls it via `tearDownAccount` in `packages/settings/src/routes.ts:400-448`
      (`DELETE /api/admin/users/:id` → `tearDownAccount` → `deleteUserData`).

  **Critical — establish a real admin:** `seedLifecycleData` (run in `beforeEach`) already inserts
  userA/userB into `app.users` with `is_instance_admin=false`, so the owner we sign up below is
  **not** the first user — `bootstrapFirstJarvisUser` will not flag it admin, and migration 0050
  seeds `registration.requires_approval=true`, so it would land `pending` + non-admin and the
  DELETE would 403. We therefore promote the signed-up owner to admin+active directly via the
  bootstrap connection before issuing the DELETE.

```typescript
it("DELETE /api/admin/users/:id succeeds after workspace tables are dropped", async () => {
  const appDb2 = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  const server2 = createApiServer({ appDb: appDb2, logger: false });
  await server2.ready();
  const bootstrapClient = new Client({ connectionString: connectionStrings.bootstrap });
  await bootstrapClient.connect();
  try {
    // Disable approval so newly registered users are active, not pending.
    await appDb2
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.requires_approval")
      .execute();

    // Sign up the owner. seedLifecycleData already inserted userA/userB, so this owner is
    // NOT the first user and is not auto-promoted — we promote it explicitly below.
    const ownerRes = await server2.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Owner", email: "owner-del@example.test", password: "password12345" }
    });
    const ownerCookie = ownerRes.headers["set-cookie"] as string;
    const ownerId = ownerRes.json<{ user: { id: string } }>().user.id;

    // Promote the owner to an active instance admin so the DELETE is authorized.
    await bootstrapClient.query(
      `UPDATE app.users SET is_instance_admin = true, status = 'active' WHERE id = $1`,
      [ownerId]
    );

    // Sign up the deletion target.
    const targetRes = await server2.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Target", email: "target-del@example.test", password: "password12345" }
    });
    const targetId = targetRes.json<{ user: { id: string } }>().user.id;

    const deleteRes = await server2.inject({
      method: "DELETE",
      url: `/api/admin/users/${targetId}`,
      headers: { cookie: ownerCookie }
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json<{ deletedUserId: string }>().deletedUserId).toBe(targetId);
  } finally {
    await bootstrapClient.end();
    await Promise.allSettled([server2.close(), appDb2.destroy()]);
  }
});
```

- [ ] Run the test; it must FAIL because `userScopedCountQueries` still references
      `app.workspace_memberships` and `app.resource_grants` (missing tables after the DROP migration),
      so `deleteUserData` throws relation-does-not-exist when `tearDownAccount` runs:

```bash
pnpm db:up && vitest run tests/integration/release-hardening.test.ts
```

Expected: the new test fails with a relation-does-not-exist error (NOT a 403 — the owner promotion
above guarantees the request is authorized, so the only remaining failure is the dropped tables).

- [ ] Remove the two dead entries from `userScopedCountQueries` (lines 34–35):

**Remove these two lines from the array in `scripts/delete-user-data.ts`:**

```typescript
  ["app.workspace_memberships", "user_id = $1::uuid"],
  ["app.resource_grants", "grantee_user_id = $1::uuid OR granted_by_user_id = $1::uuid"],
```

After the edit, the array runs from the `["app.better_auth_sessions", "user_id = $1::uuid"]` entry
directly to `["app.tasks", "owner_user_id = $1::uuid"]` — the two workspace/grant rows that sat
between them are gone.

- [ ] Run the test again; it must PASS:

```bash
pnpm db:up && vitest run tests/integration/release-hardening.test.ts
```

Expected: all tests pass including the new admin-delete regression test. (The `seedLifecycleData`
`resource_grants` INSERT was already removed in Task 1b, so the suite's `beforeEach` no longer
touches a dropped table.)

- [ ] Stage and commit:

```bash
git add scripts/delete-user-data.ts tests/integration/release-hardening.test.ts
git commit -m "fix(scripts): remove dead workspace/grant table entries from delete-user-data (#153)"
```

---

### Task 3: Update `scripts/export-user-data.ts` — remove workspace/grant queries and types

**Files:**

- Modify: `scripts/export-user-data.ts` (lines 34–53 `UserDataExportTables` interface; lines 110–131 `readExportTables`; lines 197–225 `workspaceMembershipsQuery` and `resourceGrantsQuery` functions)
- Test path: `tests/integration/release-hardening.test.ts` (existing export test at line 32)

- [ ] Run the existing export test first. **It now FAILS** (red): Task 1's DROP migration is already
      live, so `exportUserData` → `readExportTables` → `workspaceMembershipsQuery`/`resourceGrantsQuery`
      throw `relation "app.workspace_memberships" does not exist` against the dropped tables. This is the
      failing baseline the edits below turn green:

```bash
pnpm db:up && vitest run tests/integration/release-hardening.test.ts
```

Expected: the `exports user-owned data ...` test (line 32) fails with a relation-does-not-exist
error from the two dead export queries. (The other release-hardening tests are unaffected — their
seeds were already fixed in Task 1b.)

- [ ] In `scripts/export-user-data.ts`, remove `resourceGrants` and `workspaceMemberships` from the `UserDataExportTables` interface (lines 48–52). The interface shrinks from 19 fields to 17:

**Remove these two lines from `UserDataExportTables`:**

```typescript
  readonly resourceGrants: readonly ExportRow[];
  readonly workspaceMemberships: readonly ExportRow[];
```

- [ ] In the `readExportTables` function (starting at line 109), remove the two call sites that populate `workspaceMemberships` and `resourceGrants` (lines 114–115):

**Remove these two lines from the return object in `readExportTables`:**

```typescript
    workspaceMemberships: await readRows(scopedDb.db, workspaceMembershipsQuery(userId)),
    resourceGrants: await readRows(scopedDb.db, resourceGrantsQuery(userId)),
```

- [ ] Remove the `workspaceMembershipsQuery` function (lines 197–208) and the `resourceGrantsQuery` function (lines 210–225) in full.

- [ ] Run the export test to confirm it passes with the slimmed export shape:

```bash
pnpm db:up && vitest run tests/integration/release-hardening.test.ts
```

Expected: all tests pass (the export test does not assert on `workspaceMemberships` or `resourceGrants` fields).

- [ ] Stage and commit:

```bash
git add scripts/export-user-data.ts
git commit -m "fix(scripts): remove workspace/grant queries from export-user-data (#153)"
```

---

### Task 4: Update `packages/db/src/types.ts` — remove dead table interfaces and Selectable exports

**Files:**

- Modify: `packages/db/src/types.ts` (lines 83–106 interfaces; lines 482–484 `JarvisDatabase` keys; lines 518–520 Selectable exports)
- Test path: typecheck pass (`pnpm typecheck`)

- [ ] Run typecheck to establish the baseline; it should pass before edits:

```bash
pnpm typecheck
```

- [ ] Remove the three table interfaces from `packages/db/src/types.ts` (lines 83–106):

**Remove:**

```typescript
export interface WorkspacesTable {
  id: string;
  name: string;
  created_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkspaceMembershipsTable {
  user_id: string;
  workspace_id: string;
  role: string;
  created_at: TimestampColumn;
}

export interface ResourceGrantsTable {
  resource_type: string;
  resource_id: string;
  grantee_user_id: string;
  grant_level: "view" | "contribute" | "manage";
  granted_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

- [ ] Remove the three `JarvisDatabase` keys (lines 482–484):

**Remove:**

```typescript
  "app.workspaces": WorkspacesTable;
  "app.workspace_memberships": WorkspaceMembershipsTable;
  "app.resource_grants": ResourceGrantsTable;
```

- [ ] Remove the three `Selectable` exports (lines 518–520):

**Remove:**

```typescript
export type Workspace = Selectable<WorkspacesTable>;
export type WorkspaceMembership = Selectable<WorkspaceMembershipsTable>;
export type ResourceGrant = Selectable<ResourceGrantsTable>;
```

- [ ] Run typecheck; it will now fail. **`pnpm typecheck` runs the whole monorepo (root
      `tsconfig.json` includes `tests/**`and`scripts/**`) plus the web typecheck**, so the deleted
      `JarvisDatabase` keys break more than just settings. Expected failures at this point:
  - `packages/settings/src/repository.ts` and `packages/settings/src/routes.ts` (import deleted
    `Workspace`/`WorkspaceMembership`/`ResourceGrant` types) — fixed in Tasks 5 and 6.
  - `packages/auth/src/index.ts` — `insertInto("app.workspaces")` / `insertInto("app.workspace_memberships")`
    (lines 359, 369) reference deleted `JarvisDatabase` keys — fixed in Task 10.
  - `tests/integration/auth-settings.test.ts` — `me.workspaces`/`me.memberships` assertions —
    fixed in Task 10.
  - `tests/e2e/mock-api.ts` and `apps/web/src/api/client.ts` — deleted DTO refs — fixed in Task 14.

  This is expected and intentional — typecheck stays red across these files until the chain
  completes. **Do not treat a non-empty error list as a failure of this task.** The first place the
  plan asserts a clean `pnpm typecheck` is the END of Task 14 (after every consumer is updated).

```bash
pnpm typecheck
```

Expected: errors in `packages/settings/*`, `packages/auth/src/index.ts`, and the three test/web
files above — and nowhere else.

- [ ] Stage and commit (typecheck is intentionally broken — fixed in Tasks 5 and 6):

```bash
git add packages/db/src/types.ts
git commit -m "fix(db): remove WorkspacesTable/WorkspaceMembershipsTable/ResourceGrantsTable types (#120 #115 #116)"
```

---

### Task 5: Clean up `packages/settings/src/repository.ts` — delete all workspace/grant methods

**Files:**

- Modify: `packages/settings/src/repository.ts`
- Test path: `pnpm typecheck`

The `SettingsDb` type alias on line 16 **must remain** — Slice D is the sole owner of its deletion.

- [ ] Delete the six workspace/grant input interfaces (lines 18–54 in the verified file):

**Remove these interfaces entirely:**

```typescript
export interface CreateWorkspaceInput { ... }        // lines 18-23
export interface UpsertWorkspaceMembershipInput { ... } // lines 25-32
export interface DeleteWorkspaceMembershipInput { ... } // lines 34-40
export interface UpsertResourceGrantInput { ... }    // lines 42-49
export interface DeleteResourceGrantInput { ... }    // lines 51-57
```

- [ ] Remove the import of `ResourceGrant`, `Workspace`, `WorkspaceMembership` from `@jarv1s/db` (line 9–14). The imports file should reduce to only the types still used: `AdminAuditEvent`, `InstanceSetting`, `JarvisDatabase`, `User`.

**Current import block to replace (lines 5–14):**

```typescript
import type {
  AdminAuditEvent,
  InstanceSetting,
  JarvisDatabase,
  ResourceGrant,
  User,
  Workspace,
  WorkspaceMembership
} from "@jarv1s/db";
```

**Replace with:**

```typescript
import type { AdminAuditEvent, InstanceSetting, JarvisDatabase, User } from "@jarv1s/db";
```

- [ ] Delete the `listWorkspaces` method (lines 114–121) and `listMembershipsForUser` method (lines 123–131) and `listMembershipsForWorkspace` method (lines 133–143) and `listWorkspacesForUser` method (lines 145–160) and `createWorkspace` method (lines 162–207) and `upsertWorkspaceMembership` method (lines 209–253) and `deleteWorkspaceMembership` method (lines 255–288) from the `SettingsRepository` class.

- [ ] Delete the `listResourceGrants` method (lines 290–299), `upsertResourceGrant` method (lines 301–342), and `deleteResourceGrant` method (lines 344–374) from the `SettingsRepository` class.

- [ ] Delete the four private helper methods: `requireWorkspace` (lines 549–559), `assertCanChangeWorkspaceMembershipRole` (lines 561–572), `assertCanRemoveWorkspaceMembership` (lines 574–587), `assertWorkspaceHasAnotherOwner` (lines 589–605), and `getWorkspaceMembership` (lines 607–618).

- [ ] Run typecheck to confirm the repository file itself no longer errors. Errors remain in
      `packages/settings/src/routes.ts` (Task 6), `packages/auth/src/index.ts` (Task 10), and the
      test/web files noted in Task 4 (Tasks 10/14) — that is still expected at this stage:

```bash
pnpm typecheck
```

Expected: no `packages/settings/src/repository.ts` errors; `routes.ts` + `auth` + the Task-4
test/web files still error. (The clean typecheck gate is deferred to end of Task 14.)

- [ ] Stage and commit:

```bash
git add packages/settings/src/repository.ts
git commit -m "fix(settings): delete workspace/grant repository methods (#120 #153 #115 #116)"
```

---

### Task 6: Clean up `packages/settings/src/routes.ts` — delete workspace/grant routes and helpers

**Files:**

- Modify: `packages/settings/src/routes.ts`
- Test path: `pnpm typecheck` (typecheck only — the integration suite is not green until Task 10)

- [ ] Remove the import of all workspace/grant-related types from `@jarv1s/shared` (lines 16–46). The import block is large; remove only the workspace/grant symbols. The symbols to remove from the imports are:

```typescript
  createWorkspaceRouteSchema,
  deleteResourceGrantRouteSchema,
  deleteWorkspaceMembershipRouteSchema,
  listResourceGrantsRouteSchema,
  listWorkspaceMembershipsRouteSchema,
  listWorkspacesRouteSchema,
  upsertResourceGrantRouteSchema,
  upsertWorkspaceMembershipRouteSchema,
  type CreateWorkspaceRequest,
  type ResourceGrantDto,
  type UpsertResourceGrantRequest,
  type UpsertWorkspaceMembershipRequest,
  type WorkspaceDto,
  type WorkspaceMembershipDto
```

- [ ] Remove the import of `ResourceGrant`, `Workspace`, `WorkspaceMembership` from `@jarv1s/db` (lines 4–13). Reduce to only `AccessContext`, `AdminAuditEvent`, `InstanceSetting`, `JarvisDatabase`, `User`.

- [ ] Remove the three Params interfaces (lines 60–73):

```typescript
interface WorkspaceParams {
  readonly id: string;
}

interface WorkspaceMembershipParams {
  readonly id: string;
  readonly userId: string;
}

interface ResourceGrantParams {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
}
```

- [ ] In the `/api/me` handler (lines 94–110), replace the full body that queries `listMembershipsForUser` and `listWorkspacesForUser` with a lean response returning only `user`:

**Current handler body (lines 94–110):**

```typescript
server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
  try {
    const accessContext = await dependencies.resolveAccessContext(request);
    const user = await requireKnownUser(repository, accessContext.actorUserId);
    const memberships = await repository.listMembershipsForUser(accessContext.actorUserId);
    const workspaces = await repository.listWorkspacesForUser(accessContext.actorUserId);

    return {
      user: serializeUser(user),
      memberships: memberships.map(serializeWorkspaceMembership),
      workspaces: workspaces.map(serializeWorkspace),
      activeWorkspaceId: null
    };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});
```

**Replace with:**

```typescript
server.get("/api/me", { schema: meRouteSchema }, async (request, reply) => {
  try {
    const accessContext = await dependencies.resolveAccessContext(request);
    const user = await requireKnownUser(repository, accessContext.actorUserId);

    return {
      user: serializeUser(user)
    };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});
```

- [ ] Delete the entire workspace admin route block (lines 139–285): the `GET /api/admin/workspaces`, `POST /api/admin/workspaces`, `GET /api/admin/workspaces/:id/memberships`, `POST /api/admin/workspaces/:id/memberships`, `DELETE /api/admin/workspaces/:id/memberships/:userId`, `GET /api/admin/resource-grants`, `POST /api/admin/resource-grants`, and `DELETE /api/admin/resource-grants/:resourceType/:resourceId/:granteeUserId` route registrations.

- [ ] Delete the parse helpers (lines 536–562): `parseCreateWorkspaceBody`, `parseWorkspaceMembershipBody`, `parseResourceGrantBody`.

- [ ] Delete the validator helpers `requiredGrantLevel` (lines 599–605) and `requiredWorkspaceRole` (lines 607–615).

- [ ] Delete the serialize helpers `serializeWorkspace` (lines 630–637), `serializeWorkspaceMembership` (lines 640–647), and `serializeResourceGrant` (lines 649–659).

- [ ] In `handleRouteError` (lines 688–722), remove the dead workspace error-handler branches:

**Remove from the `if (error instanceof Error)` block:**

```typescript
if (error.message === "Workspace context is unavailable") {
  return reply.code(403).send({ error: error.message });
}
```

**and remove from the multi-condition block at lines 711–719:**

```typescript
if (
  error.message === "User not found" ||
  error.message === "Workspace not found" ||
  error.message === "Workspace membership not found" ||
  error.message === "Workspace must keep at least one owner" ||
  error.message === "Resource grant not found"
) {
  return reply.code(400).send({ error: error.message });
}
```

Replace the multi-condition with only the non-workspace case (which in the current file is only `"User not found"`):

```typescript
if (error.message === "User not found") {
  return reply.code(400).send({ error: error.message });
}
```

- [ ] Run typecheck; the `routes.ts` errors should now be gone. (Note: `packages/shared/src/platform-api.ts`
      does **not** depend on the deleted `@jarv1s/db` table types, so it does not start erroring here —
      Task 7 cleans it up to keep the DTOs in sync, not to fix a type error.) Remaining errors are in
      `packages/auth/src/index.ts` (Task 10) and the Task-4 test/web files (Tasks 10/14):

```bash
pnpm typecheck
```

Expected: no `packages/settings/*` errors; `auth` + the Task-4 test/web files still error. (Clean
typecheck gate deferred to end of Task 14.) Do NOT run `pnpm test:integration` here — the
`auth-settings` suite cannot be green until Task 10 lands (its dead workspace test cases call the
routes you just deleted).

- [ ] Stage and commit:

```bash
git add packages/settings/src/routes.ts
git commit -m "fix(settings): delete workspace/grant routes and route helpers (#155 #120 #153)"
```

---

### Task 7: Clean up `packages/shared/src/platform-api.ts` — remove workspace/grant DTOs and route schemas

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Test path: `pnpm typecheck`

- [ ] Remove the `WorkspaceDto` interface (lines 12–18) and `WorkspaceMembershipDto` interface (lines 20–25) and `ResourceGrantDto` interface (lines 27–35).

- [ ] Remove the response interfaces that reference them: `MeResponse` must be replaced to no longer contain `memberships`, `workspaces`, `activeWorkspaceId`. Change line 93–98:

**Current:**

```typescript
export interface MeResponse {
  readonly user: UserDto;
  readonly memberships: readonly WorkspaceMembershipDto[];
  readonly workspaces: readonly WorkspaceDto[];
  readonly activeWorkspaceId: string | null;
}
```

**Replace with:**

```typescript
export interface MeResponse {
  readonly user: UserDto;
}
```

- [ ] Remove the workspace/grant request and response interfaces (lines 104–150): `ListWorkspacesResponse`, `ListWorkspaceMembershipsResponse`, `CreateWorkspaceRequest`, `CreateWorkspaceResponse`, `UpsertWorkspaceMembershipRequest`, `UpsertWorkspaceMembershipResponse`, `DeleteWorkspaceMembershipResponse`, `ListResourceGrantsResponse`, `UpsertResourceGrantRequest`, `UpsertResourceGrantResponse`, `DeleteResourceGrantResponse`.

- [ ] Remove the JSON schema constants: `workspaceSchema` (lines 265–276), `workspaceMembershipSchema` (lines 278–288), `resourceGrantSchema` (lines 290–311).

- [ ] Patch the `meRouteSchema` response 200 shape (lines 395–410). The `required` array must have `memberships`, `workspaces`, and `activeWorkspaceId` removed, and the `properties` block must lose those same three entries. Also remove the `workspaceMembershipSchema` and `workspaceSchema` references from `properties`:

**Current `meRouteSchema` response 200 (lines 396–410):**

```typescript
export const meRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user", "memberships", "workspaces", "activeWorkspaceId"],
      properties: {
        user: userSchema,
        memberships: { type: "array", items: workspaceMembershipSchema },
        workspaces: { type: "array", items: workspaceSchema },
        activeWorkspaceId: { type: ["string", "null"] }
      }
    },
    401: errorResponseSchema
  }
} as const;
```

**Replace with:**

```typescript
export const meRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user"],
      properties: {
        user: userSchema
      }
    },
    401: errorResponseSchema
  }
} as const;
```

- [ ] Remove the six workspace/grant route schemas: `listWorkspacesRouteSchema` (lines 427–440), `listWorkspaceMembershipsRouteSchema` (lines 442–456), `createWorkspaceRouteSchema` (lines 458–480), `upsertWorkspaceMembershipRouteSchema` (lines 482–505), `deleteWorkspaceMembershipRouteSchema` (lines 507–521), `listResourceGrantsRouteSchema` (lines 523–536), `upsertResourceGrantRouteSchema` (lines 538–563), `deleteResourceGrantRouteSchema` (lines 565–579).

- [ ] Run typecheck. Removing `memberships`/`workspaces`/`activeWorkspaceId` from `MeResponse`
      keeps `packages/settings/src/routes.ts` (Task 6's lean `/api/me`) consistent, but the monorepo is
      still NOT clean: `packages/auth/src/index.ts` (Task 10), `tests/integration/auth-settings.test.ts`
      (`me.workspaces`/`me.memberships`, Task 10), `tests/e2e/mock-api.ts` (`MeResponse` excess
      `memberships`/`workspaces`/`activeWorkspaceId`, Task 14), and `apps/web/src/api/client.ts`
      (`ListWorkspacesResponse` import, Task 14) still error:

```bash
pnpm typecheck
```

Expected: errors only in `packages/auth/src/index.ts`, `tests/integration/auth-settings.test.ts`,
`tests/e2e/mock-api.ts`, and `apps/web/src/api/client.ts`. (Clean typecheck gate deferred to end of
Task 14.)

- [ ] Stage and commit:

```bash
git add packages/shared/src/platform-api.ts
git commit -m "fix(shared): remove workspace/grant DTOs and route schemas from platform-api (#155)"
```

---

### Task 8: Clean up `packages/settings/src/manifest.ts` — remove workspace/grant route declarations

**Files:**

- Modify: `packages/settings/src/manifest.ts`
- Test path: `pnpm typecheck`

- [ ] Delete the six workspace and resource-grant route entries from the `routes` array (lines 74–111 in the verified file):

**Remove these six route objects from the `routes` array:**

```typescript
    {
      method: "GET",
      path: "/api/admin/workspaces",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/workspaces",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/workspaces/:id/memberships",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/workspaces/:id/memberships",
      permissionId: "settings.manage"
    },
    {
      method: "DELETE",
      path: "/api/admin/workspaces/:id/memberships/:userId",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/admin/resource-grants",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/resource-grants",
      permissionId: "settings.manage"
    },
    {
      method: "DELETE",
      path: "/api/admin/resource-grants/:resourceType/:resourceId/:granteeUserId",
      permissionId: "settings.manage"
    },
```

- [ ] Update the `description` of the `settings.manage` permission (line 47) to remove the workspace/grants wording:

**Current:**

```typescript
      description: "Manage users, workspaces, grants, and instance-level settings.",
```

**Replace with:**

```typescript
      description: "Manage users and instance-level settings.",
```

- [ ] Similarly update `settings.view` description (line 40) to remove workspace wording:

**Current:**

```typescript
      description: "View personal and workspace settings surfaces.",
```

**Replace with:**

```typescript
      description: "View personal settings surfaces.",
```

- [ ] Run typecheck. `manifest.ts` edits are value-level (route/permission strings) and introduce
      no type changes, so the error set is unchanged from Task 7: `packages/auth/src/index.ts`,
      `tests/integration/auth-settings.test.ts`, `tests/e2e/mock-api.ts`, `apps/web/src/api/client.ts`:

```bash
pnpm typecheck
```

Expected: errors only in those four files (unchanged from Task 7). Clean typecheck gate deferred to
end of Task 14.

- [ ] Stage and commit:

```bash
git add packages/settings/src/manifest.ts
git commit -m "fix(settings): remove workspace/grant route declarations from manifest (#155)"
```

---

### Task 9: Remove dead `"Workspace context is unavailable"` error branches from `packages/ai/src/routes.ts` and `packages/connectors/src/routes.ts`

**Files:**

- Modify: `packages/ai/src/routes.ts` (line 826)
- Modify: `packages/connectors/src/routes.ts` (line 407)
- Test path: `pnpm typecheck`

- [ ] In `packages/ai/src/routes.ts`, remove the dead error branch at line 826:

**Remove:**

```typescript
if (error.message === "Workspace context is unavailable") {
  return reply.code(403).send({ error: error.message });
}
```

- [ ] In `packages/connectors/src/routes.ts`, remove the dead error branch at line 407:

**Remove:**

```typescript
if (error.message === "Workspace context is unavailable") {
  return reply.code(403).send({ error: error.message });
}
```

- [ ] Run typecheck. These edits remove value-level `if` branches and introduce no type changes, so
      the error set is unchanged from Task 7: `packages/auth/src/index.ts`,
      `tests/integration/auth-settings.test.ts`, `tests/e2e/mock-api.ts`, `apps/web/src/api/client.ts`:

```bash
pnpm typecheck
```

Expected: errors only in those four files (unchanged from Task 7). Clean typecheck gate deferred to
end of Task 14.

- [ ] Stage and commit:

```bash
git add packages/ai/src/routes.ts packages/connectors/src/routes.ts
git commit -m "fix(routes): remove dead workspace-context error branches from ai+connectors (#120)"
```

---

### Task 10: Clean up `packages/auth/src/index.ts` bootstrap + finish `auth-settings.test.ts` so the suite is green

**Files:**

- Modify: `packages/auth/src/index.ts` (lines 356–392 in verified file)
- Modify: `tests/integration/auth-settings.test.ts` (describe title line 13; dead vars lines 29–31; bootstrap-test assertions lines 114–118; three workspace/grant test cases lines 254–505)
- Test path: `tests/integration/auth-settings.test.ts`

**Why the auth-settings cleanup is folded into this task:** After Tasks 6–7, three test cases in
`auth-settings.test.ts` (lines 254, 326, 387) call routes that no longer exist (`POST
/api/admin/workspaces`, `/api/admin/resource-grants`, etc. → 404) and reference DTO fields
(`me.activeWorkspaceId`, `me.workspaces`) that were removed from `MeResponse`. The suite **cannot**
be green until those tests are deleted/replaced. The whole `auth-settings.test.ts` cleanup must
land here, in the same commit as the auth bootstrap change, so the suite-green assertion at the end
of this task is real. (Do NOT defer any of it to Task 13.)

- [ ] **Do not run the auth-settings suite yet** — it is already typecheck-broken and route-broken
      coming out of Tasks 4–7. Make the source + test edits below first, then run it once at the end.

- [ ] In `packages/auth/src/index.ts`, delete the `const workspaceId = randomUUID()` (line 356) and the two `insertInto` calls that write to `app.workspaces` (lines 358–367) and `app.workspace_memberships` (lines 368–376):

**Remove (lines 356–376):**

```typescript
const workspaceId = randomUUID();

await transaction
  .insertInto("app.workspaces")
  .values({
    id: workspaceId,
    name: "Personal",
    created_by_user_id: user.id,
    created_at: new Date(),
    updated_at: new Date()
  })
  .execute();
await transaction
  .insertInto("app.workspace_memberships")
  .values({
    user_id: user.id,
    workspace_id: workspaceId,
    role: "owner",
    created_at: new Date()
  })
  .execute();
```

- [ ] Change the `metadata` field in the `admin_audit_events` insert (lines 386–388) from `{ workspaceId }` to `{}`:

**Current metadata object:**

```typescript
        metadata: {
          workspaceId
        },
```

**Replace with:**

```typescript
        metadata: {},
```

- [ ] The `randomUUID` import at line 1 remains if it's used elsewhere in the file. Verify:

```bash
grep -n "randomUUID" /home/ben/Jarv1s/packages/auth/src/index.ts
```

Expected: at least one remaining reference in the `admin_audit_events` INSERT (line ≈ 381) — keep the import. If `randomUUID` now has zero remaining uses, remove the import.

- [ ] Run typecheck to confirm no new errors:

```bash
pnpm typecheck
```

- [ ] In `tests/integration/auth-settings.test.ts`, rename the stale describe title (line 13) to drop "workspaces":

**Current:**

```typescript
describe("M3 auth, users, workspaces, settings", () => {
```

**Replace with:**

```typescript
describe("M3 auth, users, settings", () => {
```

- [ ] Remove the now-dead `let` declarations (lines 29–31). After deleting the three workspace/grant
      tests below, `memberUserId`, `createdWorkspaceId`, and `ownerTaskId` are never read; `eslint
--max-warnings=0` (Task 15) fails on each. `memberCookie` stays (it is still read at line 230).

**Remove these declarations:**

```typescript
let memberUserId: string;
let createdWorkspaceId: string;
let ownerTaskId: string;
```

- [ ] In the "denies non-admin and lists users" test, drop the `memberUserId` assignment (line 224)
      since the variable is gone (the sign-up inject still runs; only the unread capture is removed):

**Current (lines 223–224):**

```typescript
memberCookie = cookieHeader(signUpResponse.headers);
memberUserId = signUpResponse.json<{ user: { id: string } }>().user.id;
```

**Replace with:**

```typescript
memberCookie = cookieHeader(signUpResponse.headers);
```

- [ ] Update the bootstrap test (lines 99–118). Remove the assertions that reference `me.workspaces`
      (line 114) and `me.memberships` (line 115), since the bootstrap no longer creates them:

**Remove from the test:**

```typescript
expect(me.workspaces).toHaveLength(1);
expect(me.memberships[0]).toMatchObject({
  userId: ownerUserId,
  role: "owner"
});
```

- [ ] Replace the test `it("lets admins create workspaces, memberships, and settings", ...)`
      (lines 254–324) with a slim instance-settings-only test — the workspace/membership/`me.workspaces`
      parts call deleted routes/DTOs; the settings PATCH is still valid:

**Replace the entire `it` block (lines 254–324) with:**

```typescript
it("lets admins manage instance settings", async () => {
  const settingResponse = await server.inject({
    method: "PATCH",
    url: "/api/admin/settings/provider-policy",
    headers: { cookie: ownerCookie },
    payload: { value: { maxDataClass: "private" } }
  });
  expect(settingResponse.statusCode).toBe(200);
  expect(settingResponse.json()).toMatchObject({
    setting: {
      key: "provider-policy",
      value: { maxDataClass: "private" },
      updatedByUserId: ownerUserId
    }
  });
});
```

- [ ] Delete the entire `it("creates resource grants without giving admins private-data bypass", ...)`
      block (lines 326–385) — the `POST /api/admin/resource-grants` route is deleted, so the test can
      never pass. Remove it in full (no replacement).

- [ ] Replace the test `it("lists management edges, records audit events, and revokes access", ...)`
      (lines 387–505) — it drives deleted workspace/grant APIs. Replace it with a slim audit-events
      check that still verifies the bootstrap audit trail:

**Replace the entire `it` block (lines 387–505) with:**

```typescript
it("records audit events for settings actions", async () => {
  const auditResponse = await server.inject({
    method: "GET",
    url: "/api/admin/audit-events",
    headers: { cookie: ownerCookie }
  });
  expect(auditResponse.statusCode).toBe(200);
  const auditActions = auditResponse
    .json<ListAdminAuditEventsResponse>()
    .auditEvents.map((event) => event.action);
  expect(auditActions).toContain("bootstrap.instance_owner");
});
```

(`ListAdminAuditEventsResponse` is already imported at line 8.)

- [ ] Run typecheck to confirm `packages/auth/src/index.ts` and `auth-settings.test.ts` are now
      clean (only the Task-14 web/e2e files should still error):

```bash
pnpm typecheck
```

Expected: errors only in `tests/e2e/mock-api.ts` and `apps/web/src/api/client.ts` (fixed in Task 14).

- [ ] Run the auth-settings test suite:

```bash
pnpm db:up && vitest run tests/integration/auth-settings.test.ts
```

Expected: all tests pass. (The `me` response now returns only `{ user: ... }`; the three dead
workspace/grant tests are gone or slimmed.)

- [ ] Stage and commit:

```bash
git add packages/auth/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "fix(auth): remove bootstrap workspace inserts; neutralize audit metadata; prune dead auth-settings tests (#101 #127 #155)"
```

---

### Task 11: Clean up `packages/structured-state/src/manifest.ts` — narrow `shareableResources` grant levels

**Files:**

- Modify: `packages/structured-state/src/manifest.ts` (lines 28–31)
- Modify: `tests/integration/structured-state.test.ts` (new manifest assertion)
- Test path: `pnpm test:structured-state`, grep verification

- [ ] Write a test. The spec requires that BOTH `shareableResources` entries advertise only
      `["view"]`. The structured-state integration suite **already exists** at
      `tests/integration/structured-state.test.ts` (with its own `pnpm test:structured-state` alias) and
      already imports `@jarv1s/structured-state`, so the assertion belongs there. Add a new top-level
      `it` (it needs no DB — it is a pure manifest export check), importing the manifest by name:

```typescript
import { structuredStateModuleManifest } from "@jarv1s/structured-state";

it("structured-state manifest advertises only 'view' grant level", () => {
  for (const resource of structuredStateModuleManifest.shareableResources ?? []) {
    expect(resource.grantLevels).toEqual(["view"]);
  }
});
```

Add `structuredStateModuleManifest` to the existing `@jarv1s/structured-state` import block (the
file already imports `CommitmentsRepository`, `EntitiesRepository`, etc. from that package), and
place the `it` outside the existing DB-bound `describe`/`beforeAll` so it does not depend on
`appDb`.

- [ ] Run the test; it must FAIL because the current manifest has `["view", "contribute", "manage"]`:

```bash
pnpm db:up && vitest run tests/integration/structured-state.test.ts
```

Expected: the new test fails with `Expected ["view"], received ["view", "contribute", "manage"]`.

- [ ] Edit `packages/structured-state/src/manifest.ts` lines 28–31. Change BOTH `shareableResources` entries:

**Current (lines 28–31):**

```typescript
shareableResources: [
  { resourceType: "commitment", grantLevels: ["view", "contribute", "manage"] },
  { resourceType: "entity", grantLevels: ["view", "contribute", "manage"] }
];
```

**Replace with:**

```typescript
shareableResources: [
  { resourceType: "commitment", grantLevels: ["view"] },
  { resourceType: "entity", grantLevels: ["view"] }
];
```

- [ ] Run the suite again; it must PASS:

```bash
pnpm db:up && vitest run tests/integration/structured-state.test.ts
```

- [ ] Stage and commit:

```bash
git add packages/structured-state/src/manifest.ts tests/integration/structured-state.test.ts
git commit -m "fix(structured-state): narrow shareableResources grant levels to view-only (#152)"
```

---

### Task 12: Clean up `scripts/audit-release-hardening.ts` — remove dead allowlist entries

**Files:**

- Modify: `scripts/audit-release-hardening.ts` (lines 58–60 in `forceRlsExemptions` map)
- Test path: `pnpm audit:release-hardening`

- [ ] Run the hardening audit first to confirm the three stale entries are present and the audit passes before removal (the tables are gone but their exemptions still exist):

```bash
pnpm db:up && pnpm audit:release-hardening
```

Expected: passes (empty-table exemptions are harmless at runtime, but they're dead vocabulary).

- [ ] Remove the three stale `forceRlsExemptions` entries (lines 58–60):

**Remove:**

```typescript
  ["workspace_memberships", "access-control infra: no per-user private row data"],
  ["resource_grants", "access-control infra: no per-user private row data"],
  ["workspaces", "instance config: not per-user owner data"],
```

- [ ] Run the hardening audit again; it must still pass:

```bash
pnpm db:up && pnpm audit:release-hardening
```

Expected: exits 0, `passed: true`.

- [ ] Stage and commit:

```bash
git add scripts/audit-release-hardening.ts
git commit -m "fix(audit): remove stale workspace/grant RLS exemption entries (#120 #115 #116)"
```

---

### Task 13: Full integration-suite checkpoint

**Files:** none (verification only)
**Test path:** `pnpm test:integration`

All workspace/grant **fixture and test-case** edits have already landed in earlier tasks, placed
where each suite first runs so no suite is ever asserted green while still red:

- `tests/integration/test-database.ts` (`seedProbeData` workspace/membership/grant seeds + the
  `workspaceAlpha` id) → **Task 1b**
- `tests/integration/foundation.test.ts` (migration-list entry + table-absence assertion) → **Task 1b**
- `tests/integration/release-hardening.test.ts` (`seedLifecycleData` `resource_grants` INSERT +
  the new admin-delete regression test) → **Task 1b / Task 2**
- `tests/integration/auth-settings.test.ts` (describe rename, dead vars, three workspace/grant test
  cases deleted/slimmed, `me.workspaces`/`me.memberships` assertions) → **Task 10**
- `tests/integration/structured-state.test.ts` (manifest view-only assertion) → **Task 11**

This task is the first point at which the **entire** integration suite is expected green end to end.

- [ ] Run the full integration suite:

```bash
pnpm db:up && pnpm test:integration
```

Expected: green. If any suite fails, trace it back to the task that owns its edits (above) — do not
patch fixtures here.

- [ ] No commit needed (verification-only task). If you discover a missed fixture edit, fix it in
      the owning task's file, stage that file explicitly, and commit with a message referencing the
      relevant issue.

---

### Task 14: Frontend cleanup — `apps/web/src/` and e2e mocks

**Files:**

- Modify: `apps/web/src/api/client.ts` (lines 49, 479–481 `listAdminWorkspaces`)
- Modify: `apps/web/src/api/query-keys.ts` (line 9 `workspaces` key)
- Modify: `apps/web/src/settings/settings-page.tsx` (lines 1–143, workspace section)
- Modify: `tests/e2e/mock-api.ts` (lines 60–78 `meResponse`, lines 118–120 `mockApi` workspace route)
- Do **not** modify `tests/e2e/app-shell.spec.ts`: its only `workspace`-matching line is the
  notification-title string `createMockNotification("notification-2", "Workspace notice")` (line 65),
  which is unrelated to the deleted subsystem and must stay.
- Test path: `pnpm typecheck`

- [ ] In `apps/web/src/api/client.ts`:
  - Remove the import of `ListWorkspacesResponse` (line 49).
  - Remove the `listAdminWorkspaces` function (lines 479–481):

```typescript
export async function listAdminWorkspaces(): Promise<ListWorkspacesResponse> {
  return requestJson<ListWorkspacesResponse>("/api/admin/workspaces");
}
```

- [ ] In `apps/web/src/api/query-keys.ts`:
  - Remove the `workspaces` entry (line 9):

```typescript
    workspaces: ["settings", "workspaces"] as const,
```

- [ ] In `apps/web/src/settings/settings-page.tsx`:
  - Remove the import of `listAdminWorkspaces` from `"../api/client"` (line 4).
  - Remove the `workspacesQuery` hook (lines 23–28).
  - Remove the entire `Memberships` panel section (lines 61–80) that renders `props.me.memberships`.
  - Remove the entire `Workspaces` admin panel section (lines 115–133) that renders `workspacesQuery.data`.
  - Remove the `ShieldCheck` import from `"lucide-react"` if it is now unused (line 2 — check if any other `ShieldCheck` usage remains after removing the panels).

- [ ] In `tests/e2e/mock-api.ts`:
  - Update `meResponse` (lines 49–78) to remove `memberships`, `workspaces`, and `activeWorkspaceId`. The `MeResponse` type now only has `user`:

```typescript
const meResponse: MeResponse = {
  user: {
    id: "user-1",
    email: "owner@example.test",
    name: "Owner User",
    isInstanceAdmin: true,
    status: "active" as const,
    isBootstrapOwner: true,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  }
};
```

- Remove the `page.route("**/api/admin/workspaces", ...)` mock (lines 118–120).

- [ ] Run typecheck:

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] Run the e2e suite to confirm no regressions:

```bash
pnpm test:e2e
```

Expected: green (workspace mock route removal does not break any test since no e2e spec asserts on the workspaces panel).

- [ ] Stage and commit:

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-page.tsx tests/e2e/mock-api.ts
git commit -m "fix(web): remove workspace admin section and listAdminWorkspaces from frontend (#155)"
```

---

### Task 15: Acceptance grep — verify zero remaining workspace/grant references in TypeScript sources

**Files:** none (verification only)
**Test path:** grep, `pnpm verify:foundation`, `pnpm audit:release-hardening`

- [ ] Run the acceptance grep specified in the spec. This must return **zero matches**:

```bash
grep -rE "app\.workspaces|app\.workspace_memberships|app\.resource_grants|has_resource_grant" \
  packages/ apps/ tests/ scripts/ --include="*.ts"
```

Expected: zero lines printed and exit code 1 (grep exits 1 when no matches found, which is correct). If any matches appear, trace them and fix them before proceeding.

- [ ] Confirm the DROP migration file itself is excluded from that grep:

```bash
grep -rE "has_resource_grant" \
  infra/postgres/migrations/ --include="*.sql"
```

Expected: only the DROP migration file matches (the one we created in Task 1). All other SQL files that matched previously (0002, 0003) are unmodified applied migrations — that is correct and expected.

- [ ] Run `pnpm lint` to confirm no linting errors:

```bash
pnpm lint
```

Expected: exits 0.

- [ ] Run `pnpm check:file-size` to confirm no source file exceeds 1000 lines:

```bash
pnpm check:file-size
```

Expected: exits 0.

- [ ] Run `pnpm audit:release-hardening` to confirm it is green with the three stale exemptions removed:

```bash
pnpm db:up && pnpm audit:release-hardening
```

Expected: `passed: true`.

- [ ] Run the full foundation gate:

```bash
pnpm db:up && pnpm verify:foundation
```

Expected: lint + format:check + check:file-size + typecheck + db:migrate + test:integration all green.

- [ ] Stage and commit:

```bash
git add -p  # stage any remaining unstaged changes from verification fixes
git commit -m "chore(audit-slice-b): verify foundation gate green — workspace subsystem fully deleted"
```

---

## Summary of committed changes

| Task | Files changed                                                                                                                      | Issues closed/advanced |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | `infra/postgres/migrations/0056_drop_dead_workspace_subsystem.sql`                                                                 | #120 #115 #116 #153    |
| 1b   | `tests/integration/test-database.ts`, `tests/integration/release-hardening.test.ts`, `tests/integration/foundation.test.ts`        | #120 #115 #116 #153    |
| 2    | `scripts/delete-user-data.ts`, `tests/integration/release-hardening.test.ts`                                                       | #153                   |
| 3    | `scripts/export-user-data.ts`                                                                                                      | #153                   |
| 4    | `packages/db/src/types.ts`                                                                                                         | #120 #115 #116         |
| 5    | `packages/settings/src/repository.ts`                                                                                              | #120 #153 #115 #116    |
| 6    | `packages/settings/src/routes.ts`                                                                                                  | #155 #120 #153         |
| 7    | `packages/shared/src/platform-api.ts`                                                                                              | #155                   |
| 8    | `packages/settings/src/manifest.ts`                                                                                                | #155                   |
| 9    | `packages/ai/src/routes.ts`, `packages/connectors/src/routes.ts`                                                                   | #120                   |
| 10   | `packages/auth/src/index.ts`, `tests/integration/auth-settings.test.ts`                                                            | #101 #127              |
| 11   | `packages/structured-state/src/manifest.ts`, `tests/integration/structured-state.test.ts`                                          | #152                   |
| 12   | `scripts/audit-release-hardening.ts`                                                                                               | #120 #115 #116         |
| 13   | none — full integration-suite verification checkpoint (fixture/test edits landed in Tasks 1b, 2, 10)                               | gate                   |
| 14   | `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts`, `apps/web/src/settings/settings-page.tsx`, `tests/e2e/mock-api.ts` | #155                   |
| 15   | verification only                                                                                                                  | gate                   |

## Hard invariant checklist

- `SettingsDb` type alias in `packages/settings/src/repository.ts` line 16 is preserved (Slice D owns its deletion).
- No applied migration (0001–0055) is edited. The DROP is a new file.
- The `admin_audit_events` INSERT in `packages/auth/src/index.ts` is NOT removed — only its `metadata` arg changes from `{ workspaceId }` to `{}`. Slice E owns the full fix.
- `CASCADE` in the DROP migration is belt-and-braces only; both `$$`-body functions are explicitly dropped by name.
- The post-migration pg_proc query (`SELECT proname FROM pg_proc JOIN pg_namespace ... WHERE proname LIKE 'has_resource_grant%'`) must return 0 rows before the PR merges.
- `meRouteSchema.required` no longer contains `memberships`, `workspaces`, or `activeWorkspaceId`.
- `pnpm audit:release-hardening` green is a required PR exit criterion.
