# Audit Slice D — Settings to DataContextDb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw `Kysely<JarvisDatabase>` handle in `SettingsRepository` with the `DataContextDb` per-method parameter pattern so every settings write runs inside a `withDataContext` transaction with the GUC set — closing the RLS bypass identified in audit issues #95 and #155.

**Architecture:** `SettingsRepository` currently holds a raw `Kysely<JarvisDatabase>` in its constructor (`SettingsDb` type alias, line 16 of `packages/settings/src/repository.ts`) and `setUserStatus`/`setUserAdmin` open inner `transaction().execute()` wrappers with manual `set_config` calls; both constructs bypass the GUC path. The fix deletes the `SettingsDb` alias, removes the constructor's db field, adds `scopedDb: DataContextDb` as the first parameter of every public method with `assertDataContextDb` as the first line of each body, removes the two inner transaction wrappers and their `set_config` calls, and carves `countUsers` into a narrow `BootstrapHelper` in `packages/settings/src/bootstrap.ts` that accepts the root `Kysely` handle directly (the only documented `Kysely<` exemption in the module). Routes gain `dataContext: DataContextRunner` in `SettingsRoutesDependencies` and wrap every repository call with `withDataContext`; `appDb` stays only to pass `rootDb` into `BootstrapHelper`.

**Tech Stack:** TypeScript, Kysely, Fastify, Postgres/RLS, Vitest integration tests (Docker Postgres), `@jarv1s/db` (`assertDataContextDb`, `DataContextDb`, `DataContextRunner`), pnpm workspaces.

---

## Dependency note

This PR must land **after Slice B** is on `origin/main`. Slice B deletes the workspace/membership/grant methods; this plan does not touch those methods at all — if Slice B has not landed, the compiler will surface many extra usages of the deleted workspace methods that are not this plan's responsibility.

---

## Task 1: Create `packages/settings/src/bootstrap.ts` — the `countUsers` exemption

**Files:**

- Create: `packages/settings/src/bootstrap.ts`
- Modify: `packages/settings/src/index.ts` (re-export `BootstrapHelper`)
- Test: `tests/integration/auth-settings.test.ts` (bootstrap status test at lines 68–97)

### Steps

1. - [ ] Write the failing typecheck by verifying the new file does not yet exist:

   ```bash
   ls packages/settings/src/bootstrap.ts 2>&1
   ```

   Expected: `No such file or directory`

2. - [ ] Create `packages/settings/src/bootstrap.ts`:

   ```typescript
   import { sql, type Kysely } from "kysely";

   import type { JarvisDatabase } from "@jarv1s/db";

   /**
    * Bootstrap helper — uses the raw root Kysely handle intentionally.
    *
    * `GET /api/bootstrap/status` is called before any user session exists, so
    * `withDataContext` cannot be used here (it requires an actorUserId). The
    * function `app.count_all_users()` is a SECURITY DEFINER function with no
    * private data — raw access is safe and intentional.
    *
    * This is the SOLE documented exemption for `Kysely<` in packages/settings/src/.
    */
   export class BootstrapHelper {
     constructor(private readonly rootDb: Kysely<JarvisDatabase>) {}

     async countUsers(): Promise<number> {
       const result = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(
         this.rootDb
       );
       return Number(result.rows[0]?.count ?? 0);
     }
   }
   ```

3. - [ ] Add `BootstrapHelper` to `packages/settings/src/index.ts`:

   ```typescript
   export * from "./manifest.js";
   export * from "./repository.js";
   export * from "./routes.js";
   export * from "./bootstrap.js";
   ```

   (Current `index.ts` content is three export lines; append the fourth.)

4. - [ ] Run typecheck to confirm new file compiles:

   ```bash
   pnpm typecheck
   ```

   Expected: zero errors (the file is standalone and does not yet have any callers with type conflicts).

5. - [ ] Commit:
   ```bash
   git add packages/settings/src/bootstrap.ts packages/settings/src/index.ts
   git commit -m "feat(settings): add BootstrapHelper — documented Kysely< exemption for countUsers"
   ```

---

## Task 2: Convert `SettingsRepository` — delete `SettingsDb`, add `DataContextDb` per-method params

**Files:**

- Modify: `packages/settings/src/repository.ts` (lines 1–669, full rewrite of the class)
- Test: `tests/integration/auth-settings.test.ts`, `tests/integration/multi-user-isolation.test.ts`

### Steps

1. - [ ] Confirm current `SettingsDb` type alias is at line 16 of `packages/settings/src/repository.ts`:

   ```bash
   grep -n "type SettingsDb\|SettingsDb" packages/settings/src/repository.ts | head -5
   ```

   Expected output includes `type SettingsDb = Kysely<JarvisDatabase> | Transaction<JarvisDatabase>;` (line number may vary post-Slice-B rebase — match on content, not line)

2. - [ ] Write the failing compile test — confirm that `pnpm typecheck` currently passes and will be used as the regression gate after changes:

   ```bash
   pnpm typecheck 2>&1 | tail -5
   ```

   Expected: `Found 0 errors.`

3. - [ ] Replace the full repository file. The changes are:
   - Remove `import type { Kysely, Transaction } from "kysely"` (or narrow to only what is still needed — `sql` is still needed)
   - Add `import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";`
   - Delete the `SettingsDb` type alias (line 16)
   - Delete `constructor(private readonly db: Kysely<JarvisDatabase>) {}` (line 93)
   - Remove `countUsers` entirely (moved to `BootstrapHelper`)
   - Add `scopedDb: DataContextDb` as first param and `assertDataContextDb(scopedDb)` as first line to each public method
   - Replace `this.db` with `scopedDb.db` throughout
   - Remove inner `transaction().execute()` wrappers from `setUserStatus` and `setUserAdmin`
   - Remove `set_config` calls from `setUserStatus` and `setUserAdmin`
   - Update private helpers to accept `scopedDb: DataContextDb` (not the old `SettingsDb` default-param pattern)
   - Update `assertNotLastActiveAdmin` to accept `scopedDb: DataContextDb`

   The converted file (post-Slice-B, meaning workspace/membership/grant methods are already gone by Slice B; this plan converts only the surviving methods):

   ```typescript
   import { randomUUID } from "node:crypto";

   import { sql } from "kysely";

   import type { AdminAuditEvent, InstanceSetting, User } from "@jarv1s/db";
   import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

   export interface UpsertInstanceSettingInput {
     readonly key: string;
     readonly value: Record<string, unknown>;
     readonly updatedByUserId: string;
     readonly requestId: string;
   }

   export interface SetUserStatusInput {
     readonly targetUserId: string;
     readonly status: "pending" | "active" | "deactivated";
     readonly action: string;
     readonly actorUserId: string;
     readonly requestId: string;
   }

   export interface SetUserAdminInput {
     readonly targetUserId: string;
     readonly isInstanceAdmin: boolean;
     readonly actorUserId: string;
     readonly requestId: string;
   }

   export interface RegistrationSettings {
     readonly registrationEnabled: boolean;
     readonly requiresApproval: boolean;
   }

   export class HttpRepositoryError extends Error {
     constructor(
       readonly statusCode: number,
       message: string
     ) {
       super(message);
     }
   }

   export class SettingsRepository {
     // No db in constructor — DataContextDb is passed per method via withDataContext.

     async getUserById(scopedDb: DataContextDb, userId: string): Promise<User | undefined> {
       assertDataContextDb(scopedDb);
       const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
         scopedDb.db
       );
       return result.rows[0];
     }

     async listUsers(scopedDb: DataContextDb): Promise<User[]> {
       assertDataContextDb(scopedDb);
       const result = await sql<User>`SELECT * FROM app.list_all_users()`.execute(scopedDb.db);
       return result.rows;
     }

     async listInstanceSettings(scopedDb: DataContextDb): Promise<InstanceSetting[]> {
       assertDataContextDb(scopedDb);
       return scopedDb.db.selectFrom("app.instance_settings").selectAll().orderBy("key").execute();
     }

     async upsertInstanceSetting(
       scopedDb: DataContextDb,
       input: UpsertInstanceSettingInput
     ): Promise<InstanceSetting> {
       assertDataContextDb(scopedDb);
       const setting = await scopedDb.db
         .insertInto("app.instance_settings")
         .values({
           key: input.key,
           value: input.value,
           updated_by_user_id: input.updatedByUserId,
           created_at: new Date(),
           updated_at: new Date()
         })
         .onConflict((oc) =>
           oc.column("key").doUpdateSet({
             value: input.value,
             updated_by_user_id: input.updatedByUserId,
             updated_at: new Date()
           })
         )
         .returningAll()
         .executeTakeFirstOrThrow();

       await this.insertAuditEvent(scopedDb, {
         actorUserId: input.updatedByUserId,
         action: "instance_setting.upsert",
         targetType: "instance_setting",
         targetId: input.key,
         requestId: input.requestId,
         metadata: { key: input.key }
       });

       return setting;
     }

     async setUserStatus(scopedDb: DataContextDb, input: SetUserStatusInput): Promise<User> {
       assertDataContextDb(scopedDb);
       // GUC already set by withDataContext. No inner transaction. No set_config.
       const target = await this.requireUserRow(scopedDb, input.targetUserId);

       if (target.is_bootstrap_owner && input.status === "deactivated") {
         throw new HttpRepositoryError(409, "The bootstrap owner cannot be deactivated");
       }
       if (input.status === "deactivated" && input.targetUserId === input.actorUserId) {
         throw new HttpRepositoryError(422, "You cannot deactivate your own account");
       }
       if (input.status === "deactivated" && target.is_instance_admin) {
         await this.assertAnotherActiveAdmin(scopedDb, input.targetUserId);
       }

       const updated = await scopedDb.db
         .updateTable("app.users")
         .set({ status: input.status, updated_at: new Date() })
         .where("id", "=", input.targetUserId)
         .returningAll()
         .executeTakeFirstOrThrow();

       await this.insertAuditEvent(scopedDb, {
         actorUserId: input.actorUserId,
         action: input.action,
         targetType: "user",
         targetId: input.targetUserId,
         metadata: { status: input.status },
         requestId: input.requestId
       });

       return updated;
     }

     async setUserAdmin(scopedDb: DataContextDb, input: SetUserAdminInput): Promise<User> {
       assertDataContextDb(scopedDb);
       // GUC already set by withDataContext. No inner transaction. No set_config.
       const target = await this.requireUserRow(scopedDb, input.targetUserId);

       if (!input.isInstanceAdmin) {
         if (target.is_bootstrap_owner) {
           throw new HttpRepositoryError(409, "The bootstrap owner cannot be demoted");
         }
         if (target.is_instance_admin) {
           await this.assertAnotherActiveAdmin(scopedDb, input.targetUserId);
         }
       }

       const updated = await scopedDb.db
         .updateTable("app.users")
         .set({ is_instance_admin: input.isInstanceAdmin, updated_at: new Date() })
         .where("id", "=", input.targetUserId)
         .returningAll()
         .executeTakeFirstOrThrow();

       await this.insertAuditEvent(scopedDb, {
         actorUserId: input.actorUserId,
         action: input.isInstanceAdmin ? "user.promote" : "user.demote",
         targetType: "user",
         targetId: input.targetUserId,
         metadata: { isInstanceAdmin: input.isInstanceAdmin },
         requestId: input.requestId
       });

       return updated;
     }

     async getRegistrationSettings(scopedDb: DataContextDb): Promise<RegistrationSettings> {
       assertDataContextDb(scopedDb);
       const rows = await scopedDb.db
         .selectFrom("app.instance_settings")
         .select(["key", "value"])
         .where("key", "in", ["registration.enabled", "registration.requires_approval"])
         .execute();
       const read = (key: string, fallback: boolean): boolean => {
         const val = (rows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)
           ?.value;
         return typeof val === "boolean" ? val : fallback;
       };
       return {
         registrationEnabled: read("registration.enabled", true),
         requiresApproval: read("registration.requires_approval", true)
       };
     }

     async setRegistrationSettings(
       scopedDb: DataContextDb,
       input: RegistrationSettings & { actorUserId: string; requestId: string }
     ): Promise<RegistrationSettings> {
       assertDataContextDb(scopedDb);
       await this.upsertInstanceSetting(scopedDb, {
         key: "registration.enabled",
         value: { value: input.registrationEnabled },
         updatedByUserId: input.actorUserId,
         requestId: input.requestId
       });
       await this.upsertInstanceSetting(scopedDb, {
         key: "registration.requires_approval",
         value: { value: input.requiresApproval },
         updatedByUserId: input.actorUserId,
         requestId: input.requestId
       });
       return {
         registrationEnabled: input.registrationEnabled,
         requiresApproval: input.requiresApproval
       };
     }

     async listAdminAuditEvents(scopedDb: DataContextDb): Promise<AdminAuditEvent[]> {
       assertDataContextDb(scopedDb);
       return scopedDb.db
         .selectFrom("app.admin_audit_events")
         .selectAll()
         .orderBy("created_at", "desc")
         .orderBy("id", "desc")
         .limit(50)
         .execute();
     }

     async assertNotLastActiveAdmin(
       scopedDb: DataContextDb,
       excludingUserId: string
     ): Promise<void> {
       assertDataContextDb(scopedDb);
       await this.assertAnotherActiveAdmin(scopedDb, excludingUserId);
     }

     private async requireUserRow(scopedDb: DataContextDb, userId: string): Promise<User> {
       const result = await sql<User>`SELECT * FROM app.get_user_by_id(${userId}::uuid)`.execute(
         scopedDb.db
       );
       const user = result.rows[0];
       if (!user) {
         throw new HttpRepositoryError(404, "User not found");
       }
       return user;
     }

     private async assertAnotherActiveAdmin(
       scopedDb: DataContextDb,
       excludingUserId: string
     ): Promise<void> {
       const result = await sql<{ id: string }>`
         SELECT id FROM app.list_all_users()
         WHERE is_instance_admin = true AND status = 'active' AND id != ${excludingUserId}::uuid
         LIMIT 1
       `.execute(scopedDb.db);
       if (!result.rows[0]) {
         throw new HttpRepositoryError(409, "Cannot remove the last active admin");
       }
     }

     private async insertAuditEvent(
       scopedDb: DataContextDb,
       input: {
         readonly actorUserId: string;
         readonly action: string;
         readonly targetType: string;
         readonly targetId: string | null;
         readonly metadata: Record<string, unknown>;
         readonly requestId: string;
       }
     ): Promise<void> {
       await scopedDb.db
         .insertInto("app.admin_audit_events")
         .values({
           id: randomUUID(),
           actor_user_id: input.actorUserId,
           action: input.action,
           target_type: input.targetType,
           target_id: input.targetId,
           metadata: input.metadata,
           request_id: input.requestId,
           created_at: new Date()
         })
         .execute();
     }
   }
   ```

   > **Note:** The `WorkspaceMembership`, `Workspace`, `ResourceGrant`, and related types/interfaces/methods (`listWorkspaces`, `listMembershipsForUser`, `listMembershipsForWorkspace`, `listWorkspacesForUser`, `createWorkspace`, `upsertWorkspaceMembership`, `deleteWorkspaceMembership`, `listResourceGrants`, `upsertResourceGrant`, `deleteResourceGrant`, `requireUser`, `requireWorkspace`, `assertCanChangeWorkspaceMembershipRole`, `assertCanRemoveWorkspaceMembership`, `assertWorkspaceHasAnotherOwner`, `getWorkspaceMembership`) are **already deleted by Slice B** before this PR lands. This plan only converts the surviving methods.

4. - [ ] Run typecheck to see compile errors driven by the `SettingsDb` alias deletion:

   ```bash
   pnpm typecheck 2>&1 | head -40
   ```

   Expected: errors in `routes.ts` and the two integration test files — no errors inside `repository.ts` itself.

5. - [ ] Commit the repository conversion alone:
   ```bash
   git add packages/settings/src/repository.ts
   git commit -m "refactor(settings): convert SettingsRepository to DataContextDb per-method pattern — delete SettingsDb alias"
   ```

---

## Task 3: Update `packages/settings/src/routes.ts` — wire `DataContextRunner` and `BootstrapHelper`

**Files:**

- Modify: `packages/settings/src/routes.ts` (full file — dependency interface, constructor, all route handlers)
- Test: `tests/integration/auth-settings.test.ts` (HTTP-level tests at lines 68–505)

### Steps

1. - [ ] Confirm the current `SettingsRoutesDependencies` interface exists with `appDb`:

   ```bash
   grep -n "SettingsRoutesDependencies\|appDb\|DataContextRunner" packages/settings/src/routes.ts | head -10
   ```

   Expected output includes `export interface SettingsRoutesDependencies {` and `readonly appDb: Kysely<JarvisDatabase>;` (line numbers may vary post-Slice-B rebase — match on content, not line)

2. - [ ] Update `packages/settings/src/routes.ts`. Full changes:
   - Add `import type { DataContextRunner, DataContextDb } from "@jarv1s/db";` alongside existing `@jarv1s/db` type imports
   - **Keep** `import type { Kysely } from "kysely"` — it is still required for the `rootDb: Kysely<JarvisDatabase>` field on `SettingsRoutesDependencies` (the documented bootstrap exemption). Only the `appDb` field is removed, not the `Kysely` import.
   - Import `BootstrapHelper` from `./bootstrap.js`
   - Replace `SettingsRoutesDependencies`:
     ```typescript
     export interface SettingsRoutesDependencies {
       // Documented Kysely< exemption: rootDb exists ONLY to construct BootstrapHelper
       // (countUsers — runs before any session/actor exists, so withDataContext cannot be used).
       // See the SOLE-exemption comment in packages/settings/src/bootstrap.ts.
       readonly rootDb: Kysely<JarvisDatabase>;
       readonly dataContext: DataContextRunner;
       readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
       readonly listConfiguredAuthProviders?: () => readonly AuthProviderStatusDto[];
       readonly repository?: SettingsRepository;
       readonly revokeUserSessions?: (userId: string) => Promise<number>;
       readonly bootstrapConnectionString?: string;
     }
     ```
   - Change constructor line (line 83) from:
     ```typescript
     const repository = dependencies.repository ?? new SettingsRepository(dependencies.appDb);
     ```
     to:
     ```typescript
     const repository = dependencies.repository ?? new SettingsRepository();
     const bootstrapHelper = new BootstrapHelper(dependencies.rootDb);
     ```
   - Replace the `GET /api/bootstrap/status` handler:
     ```typescript
     server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
       const userCount = await bootstrapHelper.countUsers();
       return {
         needsBootstrap: userCount === 0,
         userCount
       };
     });
     ```
   - For every route handler that calls a repository method, wrap all repository calls in a **single** `withDataContext` — admin check and actual operation in one transaction (matching the tasks pattern). The updated `requireAdmin` and `requireKnownUser` helpers now accept `scopedDb` from the caller's transaction, eliminating any nested `withDataContext`:

     ```typescript
     // The admin check happens INSIDE the route's withDataContext so the admin check and the
     // actual operation share one transaction. assertAdminUser/requireKnownUser take scopedDb
     // from that transaction — there is no nested withDataContext and no DB-holding helper.
     async function assertAdminUser(
       repository: SettingsRepository,
       scopedDb: DataContextDb,
       userId: string
     ): Promise<User> {
       const user = await requireKnownUser(repository, scopedDb, userId);
       if (!user.is_instance_admin) {
         throw new HttpError(403, "Instance admin permission is required");
       }
       return user;
     }

     async function requireKnownUser(
       repository: SettingsRepository,
       scopedDb: DataContextDb,
       userId: string
     ): Promise<User> {
       const user = await repository.getUserById(scopedDb, userId);
       if (!user) {
         throw new HttpError(401, "Session is missing or expired");
       }
       return user;
     }
     ```

   - Example route using the single-transaction pattern:
     ```typescript
     server.get(
       "/api/admin/settings",
       { schema: listInstanceSettingsRouteSchema },
       async (request, reply) => {
         try {
           const accessContext = await dependencies.resolveAccessContext(request);
           const settings = await dependencies.dataContext.withDataContext(
             accessContext,
             async (scopedDb) => {
               await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
               return repository.listInstanceSettings(scopedDb);
             }
           );
           return { settings: settings.map(serializeInstanceSetting) };
         } catch (error) {
           return handleRouteError(error, reply);
         }
       }
     );
     ```
   - **Remove the old `requireAdmin(request, dependencies, repository)` helper entirely.** It
     resolved the access context AND did the admin DB check outside any caller transaction — that
     pattern is replaced by `dependencies.resolveAccessContext(request)` (session resolution, no DB)
     followed by `assertAdminUser(repository, scopedDb, accessContext.actorUserId)` **inside** the
     route's `withDataContext` block. Every surviving `requireAdmin(...)` call site moves inside its
     route's `withDataContext` block and becomes the `resolveAccessContext` + `assertAdminUser` pair
     shown in the example route above.
     > Do not enumerate the pre-Slice-B call-site line numbers: Slice B deletes the
     > workspace/membership/grant routes (and their `requireAdmin` calls) before this PR starts, so
     > any hard-coded list is stale at execution time. Convert each **surviving** `requireAdmin` call
     > site found by `grep -n "requireAdmin" packages/settings/src/routes.ts` after Slice B has landed.
   - Wrap ALL repository calls. Complete list of routes that need wrapping (confirmed from `routes.ts` lines 94–500):
     - `GET /api/me` — `getUserById` (Slice B removes membership/workspace calls; after Slice B only `getUserById` survives)
     - `GET /api/admin/auth/providers` — `assertAdminUser` only (no extra DB call)
     - `GET /api/admin/users` — `assertAdminUser` + `listUsers`
     - `GET /api/admin/settings` — `assertAdminUser` + `listInstanceSettings`
     - `PATCH /api/admin/settings/:key` — `assertAdminUser` + `upsertInstanceSetting`
     - `POST /api/admin/users/:id/approve` — `assertAdminUser` + `getUserById` + `setUserStatus`
     - `POST /api/admin/users/:id/reactivate` — `assertAdminUser` + `setUserStatus`
     - `POST /api/admin/users/:id/deactivate` — `assertAdminUser` + `setUserStatus`
     - `POST /api/admin/users/:id/promote` — `assertAdminUser` + `setUserAdmin`
     - `POST /api/admin/users/:id/demote` — `assertAdminUser` + `setUserAdmin`
     - `POST /api/admin/users/:id/reject` — all guards + `assertNotLastActiveAdmin` (via `tearDownAccount`)
     - `DELETE /api/admin/users/:id` — all guards + `assertNotLastActiveAdmin` (via `tearDownAccount`)
     - `GET /api/admin/registration` — `assertAdminUser` + `getRegistrationSettings`
     - `PUT /api/admin/registration` — `assertAdminUser` + `setRegistrationSettings`
     - `GET /api/admin/audit-events` — `assertAdminUser` + `listAdminAuditEvents`
   - For `tearDownAccount`, wrap all DB work in a single `withDataContext`; `deleteUserData` runs outside it (no DB access via repository):
     ```typescript
     // tearDownAccount stays a nested function inside registerSettingsRoutes, so `dependencies`
     // and `repository` remain in closure scope — the call sites stay
     // `tearDownAccount(request, id, true)` / `(request, id, false)` unchanged.
     async function tearDownAccount(
       request: FastifyRequest,
       id: string,
       requirePending: boolean
     ): Promise<string> {
       const accessContext = await dependencies.resolveAccessContext(request);
       await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
         // Guard order preserved from the original routes.ts:405-415 (404 → pending-409 → self-422
         // → bootstrap-409 → last-admin-409). Do not reorder.
         await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
         const existing = await repository.getUserById(scopedDb, id);
         if (!existing) throw new HttpError(404, "User not found");
         if (requirePending && existing.status !== "pending") {
           throw new HttpError(409, "Only pending accounts can be rejected");
         }
         if (id === accessContext.actorUserId)
           throw new HttpError(422, "You cannot delete your own account");
         if (existing.is_bootstrap_owner)
           throw new HttpError(409, "The bootstrap owner cannot be deleted");
         if (existing.is_instance_admin) await repository.assertNotLastActiveAdmin(scopedDb, id);
       });
       await deleteUserData({
         userId: id,
         confirmUserId: id,
         actorUserId: accessContext.actorUserId,
         requestId: requireRequestId(accessContext),
         bootstrapConnectionString: dependencies.bootstrapConnectionString,
         dryRun: false
       });
       return id;
     }
     ```
     > Guard order preserved from the current `routes.ts:406-415`: `getUserById` 404 → pending-only
     > 409 → self-delete 422 → bootstrap-owner 409 → last-active-admin 409. The self-delete 422 check
     > stays AFTER the 404/409-pending checks (do not reorder it earlier — that would flip
     > "reject your own pending account" from 409 to 422).

3. - [ ] Run typecheck. Note that adding a **required** `rootDb` to `SettingsRoutesDependencies`
         makes `packages/module-registry/src/index.ts:102` (`registerRoutes: registerSettingsRoutes`)
         fail assignability — settings routes are registered by passing the full
         `BuiltInRouteDependencies` object through `module.registerRoutes?.(server, dependencies)` (the
         line-200 pass-through), and `BuiltInRouteDependencies` does not gain `rootDb` until Task 4:

   ```bash
   pnpm typecheck 2>&1 | head -40
   ```

   Expected at this point: (a) the module-registry error at `index.ts:102` re: missing `rootDb`
   (**resolved by Task 4**, which adds `rootDb` to `BuiltInRouteDependencies` and threads it from
   `server.ts`); and (b) errors in the two integration test files (they still construct
   `new SettingsRepository(appDb)`). No errors inside `routes.ts` itself.

   > These intermediate errors are expected and are cleared by Task 4 (module-registry/server) and
   > Task 5 (tests). The tree is not green again until after Task 5.

4. - [ ] Commit:
   ```bash
   git add packages/settings/src/routes.ts
   git commit -m "refactor(settings/routes): wire DataContextRunner + BootstrapHelper — remove appDb from SettingsRoutesDependencies"
   ```

---

## Task 4: Update `apps/api/src/server.ts` — pass `rootDb` to `registerSettingsRoutes`

**Files:**

- Modify: `apps/api/src/server.ts` (line 129 area — `registerBuiltInApiRoutes` call)
- Modify: `packages/module-registry/src/index.ts` (line 65 — `BuiltInRouteDependencies` interface, ensure `rootDb` is present)

### Steps

1. - [ ] Verify current `registerBuiltInApiRoutes` call in `server.ts` at line 129:

   ```bash
   grep -n "registerBuiltInApiRoutes\|appDb\|dataContext\|rootDb" apps/api/src/server.ts | head -15
   ```

   Expected: `129: registerBuiltInApiRoutes(server, {`, with `appDb` and `dataContext` in the options object.

2. - [ ] Verify `BuiltInRouteDependencies` in `packages/module-registry/src/index.ts` already has both `appDb` and `dataContext` (lines 65–76):

   ```bash
   grep -n "appDb\|rootDb\|dataContext" packages/module-registry/src/index.ts | head -10
   ```

   Expected: line 66 shows `readonly appDb: Kysely<JarvisDatabase>;`.

3. - [ ] In `packages/module-registry/src/index.ts`, add a `rootDb` field to `BuiltInRouteDependencies` alongside `appDb`:

   ```typescript
   export interface BuiltInRouteDependencies {
     readonly appDb: Kysely<JarvisDatabase>;
     readonly rootDb: Kysely<JarvisDatabase>; // forwarded to SettingsRoutesDependencies for BootstrapHelper
     readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
     readonly listConfiguredAuthProviders: () => readonly AuthProviderStatusDto[];
     readonly listModuleManifests: () => readonly JarvisModuleManifest[];
     readonly dataContext: DataContextRunner;
     readonly boss: PgBoss;
     readonly chatEngineFactory?: ChatEngineFactory;
     readonly revokeUserSessions?: (userId: string) => Promise<number>;
     readonly bootstrapConnectionString?: string;
   }
   ```

   (The `appDb` field is kept because other modules may still reference it; `rootDb` carries the same value for settings.)

4. - [ ] In `apps/api/src/server.ts`, add `rootDb: appDb` to the `registerBuiltInApiRoutes` call (line 129 area):

   ```typescript
   registerBuiltInApiRoutes(server, {
     appDb,
     rootDb: appDb,
     resolveAccessContext: authRuntime.resolveAccessContext,
     listConfiguredAuthProviders: authRuntime.listConfiguredProviders,
     listModuleManifests: getBuiltInModuleManifests,
     dataContext,
     boss,
     chatEngineFactory: options.chatEngineFactory,
     revokeUserSessions: authRuntime.revokeUserSessions,
     bootstrapConnectionString: ownsAppDb ? getJarvisDatabaseUrls().bootstrap : undefined
   });
   ```

5. - [ ] Confirm `registerSettingsRoutes` in the module registry now passes `rootDb` and `dataContext` to `SettingsRoutesDependencies`. In `packages/module-registry/src/index.ts`, verify the loop at line 199 passes `deps` directly — since `SettingsRoutesDependencies` uses `rootDb` and `dataContext` and `BuiltInRouteDependencies` now has both, the pass-through works as-is. Confirm with:

   ```bash
   grep -n "registerSettingsRoutes\|module.registerRoutes" packages/module-registry/src/index.ts | head -5
   ```

   Expected: `registerRoutes: registerSettingsRoutes` — routes are registered by passing the full `dependencies` object.

6. - [ ] Run typecheck:

   ```bash
   pnpm typecheck 2>&1 | head -40
   ```

   Expected: errors now only in the two integration test files.

7. - [ ] Commit:
   ```bash
   git add apps/api/src/server.ts packages/module-registry/src/index.ts
   git commit -m "refactor(api/registry): thread rootDb into BuiltInRouteDependencies for BootstrapHelper"
   ```

---

## Task 5: Update integration tests — remove `new SettingsRepository(appDb)` usages

**Files:**

- Modify: `tests/integration/auth-settings.test.ts` (import at top, direct repo instantiation — line ~552 post-Slice-B rebase)
- Modify: `tests/integration/multi-user-isolation.test.ts` (line 9 import, line 305 direct repo instantiation)

### Steps

1. - [ ] Confirm the exact lines that construct `SettingsRepository` directly:

   ```bash
   grep -n "new SettingsRepository\|SettingsRepository\|new DataContextRunner" tests/integration/auth-settings.test.ts tests/integration/multi-user-isolation.test.ts
   ```

   Expected output includes (line numbers may vary post-Slice-B rebase — match on content, not line):
   - `auth-settings.test.ts:…:import { SettingsRepository } from "../../packages/settings/src/repository.js";`
   - `auth-settings.test.ts:…:    const repo = new SettingsRepository(appDb);`
   - `multi-user-isolation.test.ts:…:import { SettingsRepository } from "../../packages/settings/src/repository.js";`
   - `multi-user-isolation.test.ts:…:    const repo = new SettingsRepository(appDb);`

2. - [ ] Update `tests/integration/auth-settings.test.ts`:
   - Replace import at line 11:
     ```typescript
     import { DataContextRunner } from "@jarv1s/db";
     import { SettingsRepository } from "../../packages/settings/src/repository.js";
     ```
   - Replace lines 768–776 (the `new SettingsRepository(appDb)` block). The test checks that `setUserAdmin` throws when the user is the last active admin. Convert to use `withDataContext`:
     ```typescript
     const repo = new SettingsRepository();
     const dataCtx = new DataContextRunner(appDb);
     await expect(
       dataCtx.withDataContext({ actorUserId: memberId, requestId: "r1" }, (scopedDb) =>
         repo.setUserAdmin(scopedDb, {
           targetUserId: memberId,
           isInstanceAdmin: false,
           actorUserId: memberId,
           requestId: "r1"
         })
       )
     ).rejects.toThrow(/last.*admin/i);
     ```

3. - [ ] Update `tests/integration/multi-user-isolation.test.ts`:
   - Replace import at line 9:
     ```typescript
     import { DataContextRunner } from "@jarv1s/db";
     import { SettingsRepository } from "../../packages/settings/src/repository.js";
     ```
   - Replace lines 305–318 (the `new SettingsRepository(appDb)` block). The test checks `assertNotLastActiveAdmin` throws and then does not throw:

     ```typescript
     // second is now the sole active admin. The repository guard must throw 409.
     const repo = new SettingsRepository();
     const dataCtx = new DataContextRunner(appDb);
     await expect(
       dataCtx.withDataContext({ actorUserId: second.id, requestId: "t1" }, (scopedDb) =>
         repo.assertNotLastActiveAdmin(scopedDb, second.id)
       )
     ).rejects.toMatchObject({ statusCode: 409 });

     // Sanity: with two active admins, the guard must NOT fire.
     const client2 = new pg.Client({ connectionString: connectionStrings.bootstrap });
     await client2.connect();
     await client2.query(
       `UPDATE app.users SET is_instance_admin = true, updated_at = now() WHERE id = $1`,
       [admin.id]
     );
     await client2.end();
     await expect(
       dataCtx.withDataContext({ actorUserId: second.id, requestId: "t2" }, (scopedDb) =>
         repo.assertNotLastActiveAdmin(scopedDb, second.id)
       )
     ).resolves.toBeUndefined();
     ```

4. - [ ] Run typecheck:

   ```bash
   pnpm typecheck 2>&1 | head -20
   ```

   Expected: `Found 0 errors.`

5. - [ ] Commit:
   ```bash
   git add tests/integration/auth-settings.test.ts tests/integration/multi-user-isolation.test.ts
   git commit -m "test(settings): update integration tests to DataContextDb constructor-less pattern"
   ```

---

## Task 6: Add `assertDataContextDb` rejection test

**Files:**

- Modify: `tests/integration/auth-settings.test.ts` (add a new `describe` block at the end)

### Steps

1. - [ ] Add the following test block at the end of `tests/integration/auth-settings.test.ts`, after all existing `describe` blocks but before the final closing of the file. The guard itself throws before any DB call, but the **file** still requires a running Postgres to execute at all — other `describe` blocks in this file call `resetEmptyFoundationDatabase` in `beforeAll`. So run `pnpm db:up && pnpm db:migrate` first:

   ```typescript
   describe("SettingsRepository assertDataContextDb guard", () => {
     it("throws 'Repository access requires withDataContext' when passed an unbranded handle", async () => {
       const repo = new SettingsRepository();
       const fakeDb = {} as Parameters<typeof repo.getUserById>[0];
       await expect(repo.getUserById(fakeDb, "any-id")).rejects.toThrow(
         "Repository access requires withDataContext"
       );
       await expect(repo.listUsers(fakeDb)).rejects.toThrow(
         "Repository access requires withDataContext"
       );
       await expect(repo.listInstanceSettings(fakeDb)).rejects.toThrow(
         "Repository access requires withDataContext"
       );
       await expect(repo.listAdminAuditEvents(fakeDb)).rejects.toThrow(
         "Repository access requires withDataContext"
       );
     });
   });
   ```

2. - [ ] Run the guard test in isolation (Postgres must be up — the file's other blocks reset the DB in `beforeAll`):

   ```bash
   pnpm db:up && pnpm db:migrate
   vitest run tests/integration/auth-settings.test.ts -t "assertDataContextDb guard" --reporter=verbose 2>&1 | grep -A 5 "assertDataContextDb guard"
   ```

   Expected: `✓ throws 'Repository access requires withDataContext' when passed an unbranded handle`

3. - [ ] Commit:
   ```bash
   git add tests/integration/auth-settings.test.ts
   git commit -m "test(settings): add assertDataContextDb rejection guard test"
   ```

---

## Task 6b: Add `withDataContext` regression tests for 0055 trigger (success + deny paths)

**Why this task exists (spec §4 / Tests):** The spec requires both the "promote succeeds" AND
"self-escalation blocked" paths tested through `withDataContext`, not just the DB-level trigger. The
converted Task 5 tests only hit 409 app-layer failures (before any DB UPDATE). The two
`users_guard_admin_flag trigger (#97)` tests (auth-settings.test.ts:798, :813) use a **raw
`pg.Client` with manual `SET LOCAL`** — they bypass `withDataContext` entirely.

Critically, the 0055 trigger **fails OPEN** when `app.current_actor_user_id()` is `NULL`
(`0055_users_guard_admin_flag_v2.sql:38`). The **deny path** is the regression-catching test: a
non-admin actor calling `setUserAdmin` through `withDataContext` must be **REJECTED** by the trigger
(42501). If the GUC plumbing silently regresses (GUC unset → NULL), the trigger fails open and the
promotion **succeeds** — making this test go red. The success-path test (step 1 below) does NOT
catch a GUC regression because both "GUC set + trigger allows" and "GUC NULL + trigger fails open"
produce the same promoted result; only the deny-path test distinguishes them.

**Files:**

- Modify: `tests/integration/auth-settings.test.ts` — add this `it(...)` **inside the same
  `describe("multi-user registration + lifecycle (Phase 2 Slice A)")` block** that holds the Task 5
  last-admin test ("repository blocks demoting the last active admin"). That block's `beforeEach`
  resets the DB and assigns `appDb` (`Kysely<JarvisDatabase>`) and defines the `signUp(opts)` helper;
  `connectionStrings` is imported at file top. `DataContextRunner` and `SettingsRepository` are
  imported by Task 5's edit.

### Steps

1. - [ ] Add the following repository-level regression test inside the
         `describe("multi-user registration + lifecycle (Phase 2 Slice A)")` block (it reuses that block's
         `signUp`, `appDb`, and `connectionStrings`, exactly like the adjacent last-admin test). It promotes
         a non-admin target while a second active admin already exists (so neither the last-admin guard nor
         self-escalation blocks), and asserts the returned row has `is_instance_admin === true` — proving the
         UPDATE passed the 0055 trigger under the `withDataContext`-set GUC:

   ```typescript
   it("setUserAdmin promote succeeds under withDataContext (0055 trigger passes)", async () => {
     // First sign-up is the bootstrap owner + active admin (the actor that performs the promote).
     const actorRes = await signUp({
       name: "Promote Actor",
       email: "promote-actor@example.com",
       password: "password12345"
     });
     const actorId = actorRes.json<{ user: { id: string } }>().user.id;

     // Disable approval so the second sign-up lands active, then create the non-admin target.
     await appDb
       .updateTable("app.instance_settings")
       .set({ value: { value: false }, updated_at: new Date() })
       .where("key", "=", "registration.requires_approval")
       .execute();
     const targetRes = await signUp({
       name: "Promote Target",
       email: "promote-target@example.com",
       password: "password12345"
     });
     const targetId = targetRes.json<{ user: { id: string } }>().user.id;

     // Ensure target is an active non-admin (actor is already an active admin as bootstrap owner).
     const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
     await seed.connect();
     await seed.query(
       `UPDATE app.users SET is_instance_admin = false, status = 'active', updated_at = now() WHERE id = $1`,
       [targetId]
     );
     await seed.end();

     const repo = new SettingsRepository();
     const dataCtx = new DataContextRunner(appDb);
     const promoted = await dataCtx.withDataContext(
       { actorUserId: actorId, requestId: "promote-1" },
       (scopedDb) =>
         repo.setUserAdmin(scopedDb, {
           targetUserId: targetId,
           isInstanceAdmin: true,
           actorUserId: actorId,
           requestId: "promote-1"
         })
     );

     // The UPDATE must have passed the 0055 trigger under the GUC set by withDataContext.
     expect(promoted.is_instance_admin).toBe(true);
     expect(promoted.id).toBe(targetId);

     // Confirm the row was actually persisted (defends against a silent GUC fail-open regression).
     const verify = new pg.Client({ connectionString: connectionStrings.bootstrap });
     await verify.connect();
     const row = await verify.query(`SELECT is_instance_admin FROM app.users WHERE id = $1`, [
       targetId
     ]);
     await verify.end();
     expect(row.rows[0]?.is_instance_admin).toBe(true);
   });
   ```

2. - [ ] Add the following **deny-path** regression test inside the same
         `describe("multi-user registration + lifecycle (Phase 2 Slice A)")` block, immediately after
         the step-1 success-path test. This is the **regression-catching test**: a non-admin actor
         calling `setUserAdmin` through `withDataContext` must be REJECTED by the 0055 trigger (42501).
         If the GUC plumbing silently regresses (GUC NULL → trigger fails open → promotion succeeds),
         this assertion goes RED — catching the regression. The success-path test from step 1 does NOT
         catch a GUC regression (both "GUC set + trigger allows" and "GUC NULL + trigger fails open"
         produce the same promoted result; only the deny path distinguishes them):

   ```typescript
   it("setUserAdmin self-escalation rejected by 0055 trigger when actor is non-admin (deny path)", async () => {
     // Bootstrap owner is the active admin. Sign up a second non-admin user as the escalation actor.
     const actorRes = await signUp({
       name: "Non-Admin Actor",
       email: "non-admin-escalation@example.com",
       password: "password12345"
     });
     const nonAdminId = actorRes.json<{ user: { id: string } }>().user.id;

     // Ensure the second user is non-admin and active.
     const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
     await seed.connect();
     await seed.query(
       `UPDATE app.users SET is_instance_admin = false, status = 'active', updated_at = now() WHERE id = $1`,
       [nonAdminId]
     );
     await seed.end();

     const repo = new SettingsRepository();
     const dataCtx = new DataContextRunner(appDb);

     // A non-admin actor tries to promote themselves — the 0055 trigger rejects with 42501.
     // If GUC regresses to NULL, trigger fails open and the promotion succeeds instead of throwing,
     // making this assertion go RED and catching the regression.
     await expect(
       dataCtx.withDataContext({ actorUserId: nonAdminId, requestId: "deny-1" }, (scopedDb) =>
         repo.setUserAdmin(scopedDb, {
           targetUserId: nonAdminId,
           isInstanceAdmin: true,
           actorUserId: nonAdminId,
           requestId: "deny-1"
         })
       )
     ).rejects.toThrow(/42501|permission denied/i);
   });
   ```

3. - [ ] Run both new regression tests in isolation (Postgres required):

   ```bash
   pnpm db:up && pnpm db:migrate
   vitest run tests/integration/auth-settings.test.ts -t "setUserAdmin promote succeeds under withDataContext|setUserAdmin self-escalation rejected" 2>&1 | tail -20
   ```

   Expected:
   - `✓ setUserAdmin promote succeeds under withDataContext (0055 trigger passes)`
   - `✓ setUserAdmin self-escalation rejected by 0055 trigger when actor is non-admin (deny path)`

4. - [ ] Commit:
   ```bash
   git add tests/integration/auth-settings.test.ts
   git commit -m "test(settings): regression — 0055 trigger success+deny paths via withDataContext"
   ```

---

## Task 7: Run the full settings integration test suite and verify the 0055 trigger regression

**Files:**

- Test: `tests/integration/auth-settings.test.ts`
- Test: `tests/integration/multi-user-isolation.test.ts`

### Steps

1. - [ ] Ensure Postgres is running:

   ```bash
   pnpm db:up && pnpm db:migrate
   ```

   Expected: Postgres starts and all migrations apply cleanly.

2. - [ ] Run the settings integration tests:

   ```bash
   vitest run tests/integration/auth-settings.test.ts tests/integration/multi-user-isolation.test.ts 2>&1 | tail -30
   ```

   Expected: all tests pass. In particular, the following **real** named tests must appear as passing (verified against the current test files — do not invent test names):
   - `bootstraps the first Better Auth user as instance owner` (auth-settings.test.ts:68) — confirms `GET /api/bootstrap/status` works via `BootstrapHelper`
   - `DELETE last active admin is rejected (409 from assertNotLastActiveAdmin)` (multi-user-isolation.test.ts:282) — confirms the `assertNotLastActiveAdmin` guard still fires via `withDataContext` (converted in Task 5)
   - `users_guard_admin_flag trigger (#97) — rejects non-admin self-escalation` (auth-settings.test.ts:798) — note: this test uses a **raw `pg.Client` with manual `SET LOCAL`**, so it does NOT exercise the `withDataContext` GUC path; it only confirms the DB-level trigger itself
   - `users_guard_admin_flag trigger (#97) — allows an active admin to change is_instance_admin on another user` (auth-settings.test.ts:813) — also uses a **raw `pg.Client` with manual `SET LOCAL`**, NOT `withDataContext`; it does not catch a GUC-plumbing regression
   - `setUserAdmin promote succeeds under withDataContext (0055 trigger passes)` — the **new** regression test added in Task 6b (this is the only test that catches a silent GUC regression through `withDataContext` — see the Task 6b rationale)
   - `SettingsRepository assertDataContextDb guard` — new guard test passes (Task 6)

3. - [ ] If the Task 6b deny-path test (`setUserAdmin self-escalation rejected by 0055 trigger`) fails with an unexpected **success** (no error thrown), confirm that `withDataContext` is calling `setLocal` with `app.actor_user_id` before the UPDATE. The trigger fires on UPDATE of `is_instance_admin` and checks `app.current_actor_user_id()`; the trigger fails **OPEN** when that GUC is `NULL` (`0055_users_guard_admin_flag_v2.sql:38`), so a silent GUC regression would NOT surface a permission error on the success path — it is precisely the **Task 6b deny-path test** (non-admin self-escalation must be rejected) that catches the regression: if GUC regresses to NULL, the trigger fails open and the promotion succeeds instead of throwing, making the deny-path assertion go red. Verify the GUC plumbing with:

   ```bash
   grep -n "set_config\|actor_user_id\|setLocal" packages/db/src/data-context.ts
   ```

   Expected: line 31 shows `await setLocal(transaction, "app.actor_user_id", accessContext.actorUserId);`

4. - [ ] Commit (no code changes here; this is a verification step — if fixes were needed they were committed above):
         No commit in this step.

---

## Task 8: Acceptance grep verification — zero `Kysely<` in `packages/settings/src/` (except bootstrap.ts)

**Files:**

- Verify: `packages/settings/src/` (all `.ts` files)

### Steps

1. - [ ] Run the acceptance grep:

   ```bash
   grep -rn "Kysely<" packages/settings/src/
   ```

   Expected output: **exactly four matches** — two per file, all documented exemptions:
   - `packages/settings/src/bootstrap.ts` — docstring line: `This is the SOLE documented exemption for \`Kysely<\` in packages/settings/src/.`
   - `packages/settings/src/bootstrap.ts` — constructor line: `constructor(private readonly rootDb: Kysely<JarvisDatabase>) {}`
   - `packages/settings/src/routes.ts` — interface comment: `// Documented Kysely< exemption: rootDb exists ONLY to construct BootstrapHelper`
   - `packages/settings/src/routes.ts` — interface field: `readonly rootDb: Kysely<JarvisDatabase>;`

   Confirm zero matches in `repository.ts` specifically:

   ```bash
   grep -n "Kysely<\|Transaction<\|SettingsDb" packages/settings/src/repository.ts
   ```

   Expected: **zero output** (empty).

2. - [ ] Run the `SettingsDb` alias deletion check:

   ```bash
   grep -rn "SettingsDb" packages/settings/src/ packages/module-registry/src/ apps/api/src/
   ```

   Expected: **zero output** — the `SettingsDb` type alias has been deleted and all references removed.

3. - [ ] Verify `assertDataContextDb` is invoked at the first line of every public method. Use the
         call-form pattern so the `import { assertDataContextDb, type DataContextDb }` line is NOT counted:

   ```bash
   grep -c "assertDataContextDb(scopedDb)" packages/settings/src/repository.ts
   ```

   Expected: `10` — one call per public method (`getUserById`, `listUsers`, `listInstanceSettings`, `upsertInstanceSetting`, `setUserStatus`, `setUserAdmin`, `getRegistrationSettings`, `setRegistrationSettings`, `listAdminAuditEvents`, `assertNotLastActiveAdmin`).

   > Note: a bare `grep -c "assertDataContextDb"` returns `11` because it also matches the import line.

4. - [ ] Verify no inner `transaction().execute()` calls and no manual GUC `set_config` in
         `setUserStatus` or `setUserAdmin`:

   ```bash
   grep -n "transaction()\|set_config" packages/settings/src/repository.ts
   ```

   Expected: **zero output**.

   > **Do not** add `actor_user_id` to this grep: `insertAuditEvent` legitimately writes the
   > `actor_user_id` _column_ (`actor_user_id: input.actorUserId`), which is a normal audit row
   > field, not a GUC manipulation. Grepping for it would fail against this plan's own correct code.

5. - [ ] No commit needed for this step — it is pure verification.

---

## Task 9: Run `pnpm verify:foundation` — full gate

**Files:**

- All modified files above.

### Steps

1. - [ ] Run the full foundation gate:

   ```bash
   pnpm verify:foundation 2>&1 | tail -20
   ```

   Expected: green — `lint`, `format:check`, `check:file-size`, `typecheck`, `db:migrate`, `test:integration` all pass.

2. - [ ] If `check:file-size` fails for `repository.ts` (post-Slice-B the file should be well under 1000 lines), confirm:

   ```bash
   wc -l packages/settings/src/repository.ts
   ```

   Expected: under 200 lines.

3. - [ ] If `format:check` fails, do NOT run `pnpm format` — the coordinator formats centrally. Flag the failure for the coordinator.

4. - [ ] If any integration test fails, run the failing suite in isolation:

   ```bash
   vitest run tests/integration/auth-settings.test.ts 2>&1 | grep -E "FAIL|Error|✓|✗" | head -30
   vitest run tests/integration/multi-user-isolation.test.ts 2>&1 | grep -E "FAIL|Error|✓|✗" | head -30
   ```

5. - [ ] Final acceptance summary — confirm all invariants:
         | Invariant | Verification command | Expected result |
         |-----------|----------------------|-----------------|
         | No `Kysely<` in `repository.ts` | `grep -n "Kysely<" packages/settings/src/repository.ts` | zero output |
         | No `SettingsDb` type alias anywhere | `grep -rn "SettingsDb" packages/settings/src/ apps/ packages/module-registry/` | zero output |
         | `assertDataContextDb` at every public entry | `grep -c "assertDataContextDb(scopedDb)" packages/settings/src/repository.ts` | `10` (bare `assertDataContextDb` returns `11` — counts the import line) |
         | No inner `transaction()` in repo | `grep -n "transaction()" packages/settings/src/repository.ts` | zero output |
         | No manual `set_config` in repo | `grep -n "set_config" packages/settings/src/repository.ts` | zero output (do NOT grep `actor_user_id` — it is a legit audit-row column write) |
         | Bootstrap exemption documented | `grep -n "SOLE documented exemption" packages/settings/src/bootstrap.ts` | one match |
         | `pnpm verify:foundation` | `pnpm verify:foundation` | exit 0 |
