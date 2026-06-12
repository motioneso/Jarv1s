# Audit Slice E — Auth Bootstrap Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate three security gaps in `packages/auth/`: module-isolation violation (#101), GUC bypass in the bootstrap path (#127), and session-identifier / OAuth-detail leakage in HTTP responses (#141).

**Architecture:** `bootstrapFirstJarvisUser` currently opens a raw `appDb.transaction()` outside of `DataContextRunner.withDataContext`, writing directly to `app.admin_audit_events` (a settings-owned table). This slice replaces that transaction block with `runner.withDataContext`, threads `DataContextRunner` and a `settings.recordAuditEvent` dependency into auth's init signature, and adds a new public `recordAuditEvent` export to `packages/settings/src/index.ts` that auth calls via the package public API. The revoke-sessions deactivate route and OAuth `postToken` method receive targeted fixes to strip session identifiers and raw token-endpoint error bodies from HTTP responses.

**Tech Stack:** TypeScript, Fastify, Kysely, Vitest integration tests against Docker Postgres. Packages touched: `packages/auth`, `packages/settings`, `packages/connectors`, `apps/api`.

**Dependency note:** Slice D must be merged to `origin/main` before this PR is opened. After Slice D, `SettingsRepository.insertAuditEvent` accepts `DataContextDb` and all public repository methods follow the per-method `DataContextDb` parameter pattern. Build agent must `git fetch origin && git rebase origin/main` before opening the PR.

---

## Pre-flight checklist

- [ ] **Confirm Slice D landed (signature check, not commit-message grep).** After `git fetch origin && git rebase origin/main`, verify `getUserById` and `insertAuditEvent` carry the `DataContextDb` per-method parameter: `grep -n "getUserById(scopedDb: DataContextDb\|insertAuditEvent(\s*$\|insertAuditEvent(scopedDb" packages/settings/src/repository.ts`. The repository must show `getUserById(scopedDb: DataContextDb, userId: string)` and `insertAuditEvent` taking `DataContextDb` as its first parameter. If these still take a raw `Kysely`/`SettingsDb`, STOP — Slice D is not on `origin/main` yet.
- [ ] **Confirm Slice B landed (workspace bootstrap removed).** Verify the personal-workspace inserts are gone from auth before rewriting Task 3: `grep -n "app.workspaces\|app.workspace_memberships" packages/auth/src/index.ts` — must return **zero matches** inside `bootstrapFirstJarvisUser`. If the workspace/membership inserts are still present (current lines 356–376), STOP and wait for Slice B: Task 3's rewrite assumes Slice B's post-state (`metadata: {}`, no workspace DML) and would silently delete the personal-workspace bootstrap, breaking the `/api/me` workspaces/memberships assertions at `auth-settings.test.ts:114–118`. The `initialAuditActions` `arrayContaining` assertion (Task 3, ~line 473 of the test) also changes once B removes the `workspace.create` / `workspace_membership.upsert` actions — drop those two strings from the expected array when B has landed.
- [ ] Confirm `pnpm db:up && pnpm db:migrate` exits 0 on the rebased branch.

---

### Task 1: Add `recordAuditEvent` public export to `packages/settings`

**Files:**

- Modify: `packages/settings/src/index.ts` (currently 3 lines — add export)
- Modify: `packages/settings/src/repository.ts` (make `insertAuditEvent` accessible from the new public function — keep it `private` in the class; the public wrapper is a module-level function)
- Test: `tests/integration/auth-settings.test.ts`

**Context after Slice D:** `SettingsRepository.insertAuditEvent` has signature:

```typescript
private async insertAuditEvent(
  db: DataContextDb,
  input: {
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string | null;
    readonly metadata: Record<string, unknown>;
    readonly requestId: string;
  }
): Promise<void>
```

(Slice D renamed the first param from `db: SettingsDb` to `db: DataContextDb` and added `assertDataContextDb` at entry. Verify the actual signature in the file after rebasing on Slice D before editing.)

- [ ] **Write the failing behavioral test.** Add to the `"M3 auth, users, workspaces, settings"` describe block in `tests/integration/auth-settings.test.ts` (after the existing `"bootstraps the first Better Auth user as instance owner"` test). This calls `recordAuditEvent` inside a real `withDataContext` transaction and reads the row back — a real behavioral test, not a `typeof` smoke check:

```typescript
it("recordAuditEvent writes an audit row via the public settings API", async () => {
  // ownerUserId is set by the preceding bootstrap test — use it as the actor so
  // the GUC-scoped insert passes RLS on app.admin_audit_events.
  const { recordAuditEvent } = await import("@jarv1s/settings");
  const runner = new DataContextRunner(appDb);
  await runner.withDataContext(
    { actorUserId: ownerUserId, requestId: "test:record-audit" },
    async (scopedDb) => {
      await recordAuditEvent(scopedDb, {
        actorUserId: ownerUserId,
        action: "test.record_audit_event",
        targetType: "user",
        targetId: ownerUserId,
        metadata: {},
        requestId: "test:record-audit"
      });
    }
  );

  const rows = await sql<{ action: string; actor_user_id: string }>`
    SELECT action, actor_user_id FROM app.admin_audit_events
    WHERE action = 'test.record_audit_event'
  `.execute(appDb);
  expect(rows.rows[0]?.action).toBe("test.record_audit_event");
  expect(rows.rows[0]?.actor_user_id).toBe(ownerUserId);
});
```

(`sql` and `pg` are already imported at the top of `auth-settings.test.ts` (lines 3–4). `DataContextRunner` is NOT yet imported — add it to the existing `@jarv1s/db` import on line 7: `import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";`. This same import is reused by Tasks 2, 4, and 5.)

Run: `vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: test FAILS at the `import { recordAuditEvent } from "@jarv1s/settings"` line — the named export does not exist yet, so `recordAuditEvent` resolves to `undefined` and the call throws `TypeError: recordAuditEvent is not a function`.

- [ ] **Add the `recordAuditEvent` function to `packages/settings/src/index.ts`:**

Current content of `/home/ben/Jarv1s/packages/settings/src/index.ts` (3 lines):

```typescript
export * from "./manifest.js";
export * from "./repository.js";
export * from "./routes.js";
```

After Slice D, `SettingsRepository` no longer takes a db in its constructor. The public wrapper instantiates a repository and calls the private method via a `(repo as any).insertAuditEvent` call — but since TypeScript does not allow calling private methods externally, the correct approach is to add a dedicated public **module-level** function in `packages/settings/src/repository.ts` alongside the class, then export it. Add the following to `packages/settings/src/repository.ts` (after the `SettingsRepository` class closing brace — currently line 669 pre-Slice-D; verify the actual end-of-class line after rebasing on Slice D). `assertDataContextDb` and `DataContextDb` are already imported at the top of `repository.ts` by Slice D (its import block: `import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";`) — no new import needed here:

```typescript
// packages/settings/src/repository.ts — add after the SettingsRepository class

/**
 * Public cross-module API for recording admin audit events.
 * Called by packages/auth via @jarv1s/settings — auth must never import
 * SettingsRepository directly or write app.admin_audit_events directly.
 */
export async function recordAuditEvent(
  scopedDb: DataContextDb,
  event: {
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: string; // NOT NULL in schema — always required
    readonly targetId: string;
    readonly metadata: Record<string, unknown>;
    readonly requestId: string;
  }
): Promise<void> {
  assertDataContextDb(scopedDb);
  await new SettingsRepository().insertAuditEvent(scopedDb, event);
}
```

**Note:** `insertAuditEvent` is `private` — to call it from the module-level function without making it public, change `private async insertAuditEvent` to `async insertAuditEvent` (package-private / remove the `private` modifier). The method is still only exported via `recordAuditEvent`; no external module will import `SettingsRepository` directly from auth. Verify after Slice D that `insertAuditEvent` still works with `DataContextDb` as its first parameter.

Run: `vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: test PASSES (`recordAuditEvent` is now a function).

- [ ] **Baseline isolation grep (informational only — NOT yet zero at this task).**

```bash
grep -rn "admin_audit_events" packages/auth/src/ --include="*.ts"
```

Expected at Task 1: **one match** — the direct insert in `bootstrapFirstJarvisUser` (line ~379) still exists until Task 3 removes it. The zero-match acceptance assertion lives in Task 3 and Task 7, not here. Record the current match count so Task 3 can confirm it dropped to zero.

- [ ] **Commit:**

```bash
git add packages/settings/src/repository.ts packages/settings/src/index.ts tests/integration/auth-settings.test.ts
git commit -m "feat(settings): export recordAuditEvent public API for cross-module audit writes"
```

---

### Task 2: Add `@jarv1s/settings` dependency to auth package and wire into `CreateJarvisAuthRuntimeOptions`

**Files:**

- Modify: `packages/auth/package.json`
- Modify: `packages/auth/src/index.ts` (lines 52–94: `CreateJarvisAuthRuntimeOptions` interface and `createJarvisAuthRuntime` function)
- Test: `tests/integration/auth-settings.test.ts` (typecheck only at this stage; runtime test in Task 3)

**Verified current state:**

`packages/auth/src/index.ts`:

- Line 52–56: `CreateJarvisAuthRuntimeOptions` has fields `appDb`, `connectionString?`, `env?` — no `runner` or `settings`.
- Line 64–94: `createJarvisAuthRuntime` closes over `options.appDb` and constructs `betterAuth(...)`.
- Line 308–394: `bootstrapFirstJarvisUser(appDb, user)` — takes only `appDb` and `user`.

`packages/auth/package.json` dependencies: `@jarv1s/db`, `@jarv1s/shared`, `better-auth`, `pg` — no `@jarv1s/settings`.

- [ ] **Write the failing type test.** Add a comment-only marker in `packages/auth/src/index.ts` to confirm the compilation fails before the change. Actually: run typecheck to establish baseline.

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: passes (baseline clean).

- [ ] **Add `@jarv1s/settings` to auth's dependencies.** Edit `packages/auth/package.json` — add **only this one line** to the existing `dependencies` block (keep every other dependency, including `"pg": "^8.21.0"`, exactly as-is — do NOT paste a full block that regresses the `pg` range):

```json
"@jarv1s/settings": "workspace:*",
```

It belongs alphabetically between `"@jarv1s/db"` and `"@jarv1s/shared"`. Run `pnpm install` to link the workspace dep.

- [ ] **Extend `CreateJarvisAuthRuntimeOptions` to accept `runner` and `settings`.** In `packages/auth/src/index.ts`:

Add the new `@jarv1s/settings` import, and **merge** `DataContextRunner` + `DataContextDb` into the existing `@jarv1s/db` import block (current lines 11–16) — do NOT add a second `from "@jarv1s/db"` statement, which would duplicate the module source and trip `pnpm lint` at `--max-warnings=0`. This is the same merged import block Task 3 uses, so land it once here:

```typescript
import {
  AuthSessionResolver,
  DataContextRunner,
  getJarvisDatabaseUrls,
  type AccessContext,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import { recordAuditEvent as settingsRecordAuditEvent } from "@jarv1s/settings";
```

Extend the interface (current lines 52–56):

```typescript
export interface CreateJarvisAuthRuntimeOptions {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly runner: DataContextRunner;
  readonly connectionString?: string;
  readonly env?: NodeJS.ProcessEnv;
}
```

Update `bootstrapFirstJarvisUser` signature (Task 3 does the body rewrite — this task only adds the parameter pass-through):

```typescript
async function bootstrapFirstJarvisUser(
  runner: DataContextRunner,
  settings: { recordAuditEvent: typeof settingsRecordAuditEvent },
  user: BetterAuthUser
): Promise<void> {
  // body unchanged in this task — Task 3 rewrites it
  // Temporarily keep old body for typecheck only; Task 3 will replace it.
  throw new Error("bootstrapFirstJarvisUser not yet implemented — Task 3 will complete this");
}
```

**Note:** `bootstrapFirstJarvisUser` is invoked from the `databaseHooks.user.create.after` hook in `createBetterAuthOptions` (lines 218–225), currently as `after: (user) => bootstrapFirstJarvisUser(appDb, user)`. Task 3 updates that call site. The stub above does NOT by itself fail `tsc` — a throwing function body still type-checks. The typecheck failure at this task comes entirely from the call sites: the `databaseHooks.user.create.after` hook still passes `(appDb, user)` against the new `(runner, settings, user)` signature, and the test/server call sites still pass `{ appDb }` against the now-required `runner` field. Those are the real compile errors that prove the interface change landed.

- [ ] **Update the two test call sites that construct `createJarvisAuthRuntime` (REQUIRED — `runner` is now mandatory).** `runner` is a required field per the spec, so every caller must pass it. Beyond `apps/api/src/server.ts` (handled below), two integration tests call `createJarvisAuthRuntime({ appDb })` and will fail typecheck (and, at runtime, the `databaseHooks.user.create.after` hook would dereference `options.runner` as `undefined` → `TypeError: Cannot read properties of undefined (reading 'withDataContext')`, breaking every sign-up). Update both:
  - `tests/integration/auth-settings.test.ts:525`
  - `tests/integration/multi-user-isolation.test.ts:51`

  In each file, ensure `DataContextRunner` is imported from `@jarv1s/db`, then change the call:

```typescript
// before:
authRuntime = createJarvisAuthRuntime({ appDb });
// after:
authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
```

(`auth-settings.test.ts` already imports `createDatabase` from `@jarv1s/db`; add `DataContextRunner` to that import. `multi-user-isolation.test.ts` likewise — confirm the import line and add `DataContextRunner` if absent.) Keeping `runner` required is correct per the spec — do NOT make it optional with an internal fallback.

Run:

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: FAILS — but ONLY on the `databaseHooks.user.create.after` call site (`bootstrapFirstJarvisUser(appDb, user)` against the new 3-arg signature). The `runner`-field errors at the three construction call sites (server + two tests) are now resolved. Task 3 fixes the hook call site, after which typecheck passes.

- [ ] **Update `apps/api/src/server.ts` to pass `runner` to `createJarvisAuthRuntime`.**

Current `apps/api/src/server.ts` lines 42–46:

```typescript
const authRuntime =
  options.authRuntime ??
  createJarvisAuthRuntime({
    appDb
  });
```

Verified from reading: `const dataContext = new DataContextRunner(appDb)` is at line 54. But `authRuntime` is constructed before `dataContext`. Reorder so `dataContext` is created first, then passed to auth:

```typescript
// apps/api/src/server.ts — updated construction order
const dataContext = new DataContextRunner(appDb); // was line 54; move before authRuntime
const authRuntime =
  options.authRuntime ??
  createJarvisAuthRuntime({
    appDb,
    runner: dataContext
  });
const ownsAuthRuntime = options.authRuntime === undefined;
```

Remove the original `const dataContext = new DataContextRunner(appDb);` line (now deduplicated).

Run:

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: still FAILS — only on the `databaseHooks.user.create.after` hook call site (`bootstrapFirstJarvisUser(appDb, user)` does not match the new 3-arg signature). Task 3 fixes that call site and the function body, after which typecheck passes.

- [ ] **Do NOT commit yet — squash Tasks 2 and 3 into one commit.** Committing here leaves `origin`-bisectable history in a red-typecheck state, which breaks `git bisect` and CI-per-commit. Stage the Task 2 edits but hold the commit until Task 3 lands the body rewrite + hook call-site fix and `pnpm typecheck` is green; then make a single commit covering both tasks (commit command at the end of Task 3). Until then, keep the working tree dirty.

---

### Task 3: Rewrite `bootstrapFirstJarvisUser` — replace `appDb.transaction()` with `runner.withDataContext`; replace direct audit insert with `settings.recordAuditEvent`

**Files:**

- Modify: `packages/auth/src/index.ts` (lines 308–394: full rewrite of `bootstrapFirstJarvisUser`)
- Modify: `packages/auth/src/index.ts` (the `createBetterAuthOptions` call site that invokes `bootstrapFirstJarvisUser`)
- Test: `tests/integration/auth-settings.test.ts`

**Verified current body of `bootstrapFirstJarvisUser` (lines 308–394):**

- Opens `appDb.transaction().execute(async (transaction) => { ... })`
- Calls `pg_advisory_xact_lock` on `transaction`
- Calls `app.count_all_users()` on `transaction`
- Calls `set_config('app.actor_user_id', user.id, true)` on `transaction` manually
- Updates `app.users` via `transaction.updateTable`
- Inserts into `app.workspaces` via `transaction.insertInto` (removed by Slice B — verify the file after rebasing)
- Inserts into `app.workspace_memberships` via `transaction.insertInto` (removed by Slice B — verify)
- Inserts into `app.admin_audit_events` via `transaction.insertInto` (this is the isolation violation — replaced here)

After Slice B, the workspace and membership inserts are gone. Verify the exact file state after rebase before writing the replacement.

The call site inside `createBetterAuthOptions` is the **`databaseHooks.user.create.after` hook (lines 218–225)** — there is NO `signUp` key anywhere in this file (grepping for `signUp` returns nothing). The real, verified current code:

```typescript
// packages/auth/src/index.ts:218–225 — inside createBetterAuthOptions
databaseHooks: {
  user: {
    create: {
      before: (user) => registrationGate(appDb, user),
      after: (user) => bootstrapFirstJarvisUser(appDb, user)
    }
  }
},
```

Only the `after` line changes — it must pass `runner` and `settings`:

```typescript
after: (user) => bootstrapFirstJarvisUser(runner, settings, user as BetterAuthUser);
```

**Leave `before: (user) => registrationGate(appDb, user)` untouched.** `registrationGate` reads only (via `app.count_all_users()` and `readBooleanSetting` on the raw `appDb`), outside `bootstrapFirstJarvisUser`; reads on `appDb` are acceptable per the spec's `grep -n "appDb\."` acceptance note (only DML inside the bootstrap function is forbidden).

**`withDataContext` semantics reminder:**

- `runner.withDataContext({ actorUserId, requestId }, async (scopedDb) => { ... })` opens ONE Kysely transaction, sets `app.actor_user_id` and `app.request_id` GUCs to local scope, then calls the callback with a branded `DataContextDb`.
- The advisory lock `pg_advisory_xact_lock` must be called inside the callback via `sql\`...\`.execute(scopedDb.db)`.
- `readBooleanSetting` (line 292) takes a raw `Kysely<JarvisDatabase>`. After this change, it must accept `scopedDb.db` (a `Transaction<JarvisDatabase>`). Verify the function signature — if it takes `Kysely<JarvisDatabase>`, it also accepts `Transaction<JarvisDatabase>` because `Transaction` extends `Kysely`. Pass `scopedDb.db` directly.

**0055 trigger semantics:** the `UPDATE app.users SET is_instance_admin = true` fires the `users_guard_admin_flag_v2` trigger. Under `withDataContext`, `app.actor_user_id` is set (to `user.id`) before the update. The trigger calls `app.any_admin_exists()` which evaluates against the in-progress transaction state — on the first-user path, no admin exists yet, so the trigger allows the self-promotion. This is the correct bootstrap path.

- [ ] **Write the failing bootstrap test (action = bootstrap_owner_created).** The existing test `"bootstraps the first Better Auth user as instance owner"` already checks `isInstanceAdmin: true` but does NOT check the audit log action. Extend it:

Open `tests/integration/auth-settings.test.ts`. After line 119 (end of the bootstrap test's assertions), add a check for the new audit action name. Because the test runs in sequence and `initialAuditResponse` in the later test checks `"bootstrap.instance_owner"` (line 475), we must update that assertion too.

Actually, the full flow is: Task 3 changes the action string from `"bootstrap.instance_owner"` to `"bootstrap_owner_created"`. The existing test at line 473 asserts:

```typescript
expect(initialAuditActions).toEqual(
  expect.arrayContaining([
    "bootstrap.instance_owner",   // <-- this will break
    ...
  ])
);
```

Add a new standalone test for the audit action, and update the string in the arrayContaining assertion.

Add after the existing bootstrap test (after line 119):

```typescript
it("bootstrap writes audit event with action bootstrap_owner_created", async () => {
  const auditResponse = await server.inject({
    method: "GET",
    url: "/api/admin/audit-events",
    headers: { cookie: ownerCookie }
  });
  const actions = auditResponse
    .json<ListAdminAuditEventsResponse>()
    .auditEvents.map((e) => e.action);
  expect(actions).toContain("bootstrap_owner_created");
  // The audit event must record the correct actor.
  const bootstrapEvent = auditResponse
    .json<ListAdminAuditEventsResponse>()
    .auditEvents.find((e) => e.action === "bootstrap_owner_created");
  expect(bootstrapEvent?.actorUserId).toBe(ownerUserId);
});
```

Also update the `initialAuditActions` assertion at line ~473:

```typescript
// Change "bootstrap.instance_owner" to "bootstrap_owner_created"
expect(initialAuditActions).toEqual(
  expect.arrayContaining([
    "bootstrap_owner_created",
    "workspace.create",
    "workspace_membership.upsert",
    "instance_setting.upsert",
    "resource_grant.upsert"
  ])
);
```

**Note:** After Slice B, the `workspace.create` and `workspace_membership.upsert` actions may no longer appear in the audit log (those routes/inserts are deleted by Slice B). Verify the file state after rebase and update the `arrayContaining` assertion to only reference actions that still exist.

Run: `vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: FAILS — `"bootstrap_owner_created"` not found (old code writes `"bootstrap.instance_owner"`).

- [ ] **Rewrite `bootstrapFirstJarvisUser`.** Replace lines 308–394 of `packages/auth/src/index.ts`:

```typescript
async function bootstrapFirstJarvisUser(
  runner: DataContextRunner,
  settings: {
    recordAuditEvent: (
      scopedDb: DataContextDb,
      event: {
        actorUserId: string;
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
        requestId: string;
      }
    ) => Promise<void>;
  },
  user: BetterAuthUser
): Promise<void> {
  await runner.withDataContext(
    { actorUserId: user.id, requestId: `bootstrap:${user.id}` },
    async (scopedDb) => {
      // Advisory transaction-level lock — prevents two concurrent sign-ups from
      // both seeing isFirstUser = true. Must run inside the same transaction.
      await sql`SELECT pg_advisory_xact_lock(hashtext('jarv1s:first-user-bootstrap'))`.execute(
        scopedDb.db
      );

      // app.count_all_users() is a SECURITY DEFINER function owned by jarvis_auth_runtime,
      // which has a USING(true) policy on users under FORCE RLS. This gives an accurate
      // total count even though app_runtime's own self-row policy would return count=1.
      const countResult = await sql<{
        count: string;
      }>`SELECT app.count_all_users() AS count`.execute(scopedDb.db);
      const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 1;

      // NOTE: withDataContext already called set_config('app.actor_user_id', user.id, true).
      // Do NOT call set_config again — it is set for the entire transaction by withDataContext.

      let status: "active" | "pending" = "active";
      if (!isFirstUser) {
        const requiresApproval = await readBooleanSetting(
          scopedDb.db,
          "registration.requires_approval",
          true
        );
        if (requiresApproval) status = "pending";
      }

      await scopedDb.db
        .updateTable("app.users")
        .set({
          name: user.name ?? "",
          email: user.email,
          is_instance_admin: isFirstUser,
          is_bootstrap_owner: isFirstUser,
          status,
          updated_at: new Date()
        })
        .where("id", "=", user.id)
        .execute();

      if (!isFirstUser) {
        return;
      }

      // Replace direct app.admin_audit_events INSERT with the settings public API.
      // Auth must not write settings-owned tables directly (#101).
      await settings.recordAuditEvent(scopedDb, {
        actorUserId: user.id,
        action: "bootstrap_owner_created",
        targetType: "user", // NOT NULL in schema
        targetId: user.id,
        metadata: {},
        requestId: `bootstrap:${user.id}`
      });
    }
  );
}
```

**Important:** `DataContextRunner`, `DataContextDb`, and the `@jarv1s/settings` `recordAuditEvent` import were all already added by Task 2's merged import block — no further import edits are needed here. `sql` is already imported from `kysely` (line 8).

- [ ] **Update the `databaseHooks.user.create.after` call site.** This is the `after` hook at lines 218–225 in `createBetterAuthOptions` (NOT a `signUp` hook — no `signUp` key exists in this file). It currently calls:

```typescript
after: (user) => bootstrapFirstJarvisUser(appDb, user);
```

The `createBetterAuthOptions` function signature is:

```typescript
function createBetterAuthOptions(
  pool: pg.Pool,
  appDb: Kysely<JarvisDatabase>,
  env: NodeJS.ProcessEnv
): BetterAuthOptions;
```

This function does not have access to `runner` or `settings`. Two options to thread them in:

**Option A (inline — minimal diff):** Close over `runner` and `settings` from the outer `createJarvisAuthRuntime` scope by extracting the hook callback into `createJarvisAuthRuntime` itself. Pass them as additional parameters to `createBetterAuthOptions`:

Update `createBetterAuthOptions` signature:

```typescript
function createBetterAuthOptions(
  pool: pg.Pool,
  appDb: Kysely<JarvisDatabase>,
  env: NodeJS.ProcessEnv,
  runner: DataContextRunner,
  settings: {
    recordAuditEvent: (
      scopedDb: DataContextDb,
      event: {
        actorUserId: string;
        action: string;
        targetType: string;
        targetId: string;
        metadata: Record<string, unknown>;
        requestId: string;
      }
    ) => Promise<void>;
  }
): BetterAuthOptions;
```

Update the call in `createJarvisAuthRuntime` (lines 73–74):

```typescript
const auth = betterAuth(
  createBetterAuthOptions(pool, options.appDb, env, options.runner, {
    recordAuditEvent: settingsRecordAuditEvent
  })
);
```

Update the hook in `createBetterAuthOptions` (the `databaseHooks.user.create.after` line at 218–225 — only the `after` line changes; `before` stays as `registrationGate(appDb, user)`):

```typescript
databaseHooks: {
  user: {
    create: {
      before: (user) => registrationGate(appDb, user),
      after: (user) => bootstrapFirstJarvisUser(runner, settings, user as BetterAuthUser)
    }
  }
},
```

Run:

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: PASSES (zero type errors).

Run:

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: ALL tests in `auth-settings.test.ts` PASS, including the new `"bootstrap writes audit event with action bootstrap_owner_created"` test.

- [ ] **Run isolation greps:**

```bash
# Must return zero DML calls in bootstrapFirstJarvisUser:
grep -n "appDb\." packages/auth/src/index.ts
```

Expected: any `appDb.` references are inside `createJarvisAuthRuntime` or `createBetterAuthOptions` closure capture — NOT inside `bootstrapFirstJarvisUser`. Verify manually that the function body contains zero `appDb.`, `insertInto`, `updateTable`, `deleteFrom`, or `transaction().execute` calls.

```bash
# Must return zero matches (no direct audit table writes from auth):
grep -rn "admin_audit_events" packages/auth/src/ --include="*.ts"
```

Expected: zero matches.

```bash
# Must return zero matches (auth must not import SettingsRepository):
grep -rn "SettingsRepository" packages/auth/src/ --include="*.ts"
```

Expected: zero matches.

- [ ] **Commit (single squashed commit covering Tasks 2 + 3 — typecheck is green only now).** This is the deferred commit from Task 2; staging both tasks' files together keeps every commit on the branch typecheck-green and bisectable:

```bash
git add packages/auth/package.json packages/auth/src/index.ts apps/api/src/server.ts \
  tests/integration/auth-settings.test.ts tests/integration/multi-user-isolation.test.ts
git commit -m "fix(auth): wrap bootstrapFirstJarvisUser in runner.withDataContext; delegate audit write to settings.recordAuditEvent (#101 #127)"
```

---

### Task 4: Verify 0055 trigger passes under `withDataContext` in the integration test

**Files:**

- Modify: `tests/integration/auth-settings.test.ts` (add explicit trigger verification in `"users_guard_admin_flag bootstrap exemption"` describe block)
- No production code changes.

**Context:** The `users_guard_admin_flag_v2` trigger (migration `0055`) fires on `UPDATE app.users SET is_instance_admin = true`. It calls `app.any_admin_exists()`. On the bootstrap path: the user exists in the DB but no admin exists yet when the update runs — `any_admin_exists()` returns false, so the trigger allows self-promotion. `withDataContext` has already set `app.actor_user_id = user.id` before the update runs.

The existing `"users_guard_admin_flag bootstrap exemption"` describe block at line ~848 already covers this trigger semantics with a raw SQL client. But it does NOT test the path through `withDataContext`. We add a test that exercises the full `withDataContext` + `is_instance_admin` update path.

- [ ] **Write the failing test.** Add to the `"users_guard_admin_flag bootstrap exemption"` describe block (after line ~909):

```typescript
it("withDataContext allows bootstrap owner to set is_instance_admin when no admin exists", async () => {
  // Fresh DB — no users yet.
  await resetEmptyFoundationDatabase();
  const localDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  const dataContext = new DataContextRunner(localDb);

  // Seed a user with no admin status via bootstrap role (superuser bypass).
  const userId = randomUUID();
  const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await seed.connect();
  try {
    await seed.query(
      `INSERT INTO app.users (id, email, name, is_instance_admin)
       VALUES ($1, 'withdc-bootstrap@test.test', 'DC Bootstrap', false)`,
      [userId]
    );
  } finally {
    await seed.end();
  }

  try {
    // withDataContext sets app.actor_user_id to userId. The update fires the 0055 trigger.
    // any_admin_exists() = false (no admins yet) → trigger allows self-promotion.
    await expect(
      dataContext.withDataContext(
        { actorUserId: userId, requestId: "test:bootstrap" },
        async (scopedDb) => {
          await scopedDb.db
            .updateTable("app.users")
            .set({ is_instance_admin: true, updated_at: new Date() })
            .where("id", "=", userId)
            .execute();
        }
      )
    ).resolves.not.toThrow();

    // Verify the flag was actually set.
    const rows = await sql<{
      is_instance_admin: boolean;
    }>`SELECT is_instance_admin FROM app.get_user_by_id(${userId}::uuid)`.execute(localDb);
    expect(rows.rows[0]?.is_instance_admin).toBe(true);
  } finally {
    // finally so a failed assertion never leaks the connection and hangs the suite.
    await localDb.destroy();
  }
});
```

Add needed imports at the top of the test file:

- `import { randomUUID } from "node:crypto";` (if not already present)
- `import { DataContextRunner } from "@jarv1s/db";` (if not already present)
- `import { sql } from "kysely";` (if not already present)

Run:

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose -t "withDataContext allows bootstrap" 2>&1 | tail -20
```

Expected: FAILS with missing import or `is_instance_admin: false` (test not yet configured).

- [ ] **Fix imports (do NOT create duplicate import statements — `pnpm lint` runs at `--max-warnings=0`).** The top of `tests/integration/auth-settings.test.ts` already has: `import { sql, type Kysely } from "kysely";` (line 3), `import pg from "pg";` (line 4), and `import { createDatabase, type JarvisDatabase } from "@jarv1s/db";` (line 7). After Task 1, line 7 also includes `DataContextRunner`. This task only adds `randomUUID` if it is not already imported — add it to the existing `node:crypto` import if one exists, otherwise add a new line: `import { randomUUID } from "node:crypto";`. Do not re-import `sql`, `DataContextRunner`, `createDatabase`, or `JarvisDatabase`.

Run:

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL tests PASS including the new `withDataContext bootstrap` test.

- [ ] **Commit:**

```bash
git add tests/integration/auth-settings.test.ts
git commit -m "test(auth): verify 0055 trigger passes under withDataContext on the bootstrap path (#127)"
```

---

### Task 5: Add `POST /api/admin/users/:id/revoke-sessions` route with count-only response

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (add `adminRevokeSessionsRouteSchema` export)
- Modify: `packages/settings/src/routes.ts` (add dedicated route, verify deactivate inline call returns no session IDs)
- Test: `tests/integration/auth-settings.test.ts`

**Context:** Issue #141 requires that `POST /api/admin/users/:id/revoke-sessions` not include any `better_auth_sessions` column value in the response. The current codebase has no dedicated `/revoke-sessions` route — `revokeUserSessions` is called inline inside the `lifecycleAction("deactivate", ...)` handler (pre-Slice-D: line 363–364 of `routes.ts`, inside `if (verb === "deactivate" && dependencies.revokeUserSessions)`). That handler returns `{ user: serializeUser(user) }`, which does NOT include session data — already safe. But the spec calls for a dedicated endpoint. We add the route with a `{ success: true, count: N }` response. (Slice D rewraps the lifecycle handlers in `withDataContext`, so the exact line numbers shift after rebase — locate the `revokeUserSessions` call by name, not by line.)

Grep check — verify the deactivate route returns no session fields:

```bash
grep -n "session" packages/settings/src/routes.ts
```

Expected: the dependency-interface field `revokeUserSessions` and its call inside the deactivate handler (exact line numbers shift after Slice D's rewrap). The deactivate response is `{ user: serializeUser(user) }` — `serializeUser` maps only `id, email, name, isInstanceAdmin, status, isBootstrapOwner, createdAt, updatedAt`. No session identifiers. Confirm this grep finds no session-column value in any response body.

- [ ] **Write the failing test.** Add to `"multi-user registration + lifecycle (Phase 2 Slice A)"` describe block in `tests/integration/auth-settings.test.ts`:

This is the security point of the slice, so the test asserts the actor-dependent behavior the spec requires (`Only the calling admin's target-user sessions are revoked; the admin's own session survives`), not just the response shape:

```typescript
it("POST /api/admin/users/:id/revoke-sessions revokes target sessions, count only, admin survives", async () => {
  const admin = await signUp({
    name: "Admin",
    email: "admin-revoke@example.com",
    password: "password12345"
  });
  const adminCookie = cookieHeader(admin.headers);

  // Disable approval so the member becomes active and gets a usable session.
  await appDb
    .updateTable("app.instance_settings")
    .set({ value: { value: false }, updated_at: new Date() })
    .where("key", "=", "registration.requires_approval")
    .execute();

  const member = await signUp({
    name: "Member",
    email: "member-revoke@example.com",
    password: "password12345"
  });
  const memberId = member.json<{ user: { id: string } }>().user.id;
  const memberCookie = cookieHeader(member.headers);

  // Sanity: the member's session is live before the revoke.
  const beforeRevoke = await server.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: memberCookie }
  });
  expect(beforeRevoke.statusCode).toBe(200);

  const response = await server.inject({
    method: "POST",
    url: `/api/admin/users/${memberId}/revoke-sessions`,
    headers: { cookie: adminCookie }
  });

  // (1) Response shape: count only, no session identifiers.
  expect(response.statusCode).toBe(200);
  const body = response.json<{ success: boolean; count: number }>();
  expect(body.success).toBe(true);
  expect(typeof body.count).toBe("number");
  expect(body.count).toBeGreaterThanOrEqual(1); // sign-up created at least 1 session
  const raw = response.body;
  expect(raw).not.toContain("session_id");
  expect(raw).not.toContain("token");
  expect(raw).not.toContain("user_id");
  expect(raw).not.toContain("better_auth");

  // (2) Target sessions are actually dead — the member's cookie now fails auth.
  const afterRevoke = await server.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: memberCookie }
  });
  expect(afterRevoke.statusCode).toBe(401);

  // (3) The admin's OWN session survives — revoke is scoped to the target user only.
  const adminStillValid = await server.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: adminCookie }
  });
  expect(adminStillValid.statusCode).toBe(200);

  // (4) DB confirms zero session rows remain for the target user. Use the bootstrap
  // connection (superuser, bypasses RLS) — app_runtime's FORCE RLS would hide other
  // users' session rows from a plain appDb query and make this check meaningless.
  const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await seed.connect();
  try {
    const memberRows = await seed.query(
      "SELECT count(*)::int AS count FROM app.better_auth_sessions WHERE user_id = $1",
      [memberId]
    );
    expect(memberRows.rows[0]?.count).toBe(0);
  } finally {
    await seed.end();
  }
});
```

Run:

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose -t "revoke-sessions revokes target sessions" 2>&1 | tail -20
```

Expected: FAILS with `404` (route does not exist yet).

- [ ] **Add schema to `packages/shared/src/platform-api.ts`.** Add after the `adminUserActionRouteSchema` export, which begins at line 650 and ends at its `} as const;` on line 670 — insert the new schema immediately after line 670:

```typescript
export const adminRevokeSessionsRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["success", "count"],
      properties: {
        success: { type: "boolean" },
        count: { type: "number" }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
```

Export it from `packages/shared/src/index.ts` or wherever platform-api exports are re-exported. (Typically `packages/shared/src/index.ts` has `export * from "./platform-api.js"` — no extra change needed if so. Verify.)

- [ ] **Add the route to `packages/settings/src/routes.ts`.** Import the new schema at the top of the file:

```typescript
import {
  // ... existing imports ...
  adminRevokeSessionsRouteSchema
} from "@jarv1s/shared";
```

Add the route inside `registerSettingsRoutes` after the `lifecycleAction` registrations (after the `lifecycleAction("deactivate", ...)` call — pre-Slice-D this is line 374; Slice D rewraps these handlers but keeps the same registration order, so place it right after the two `lifecycleAction(...)` calls).

**Write this in the post-Slice-D route pattern.** Slice D removes the old `requireAdmin(request, dependencies, repository)` helper entirely and converts `getUserById` to `getUserById(scopedDb, id)`. The admin check and the target lookup must both run **inside one** `dependencies.dataContext.withDataContext(...)` block via `assertAdminUser(repository, scopedDb, accessContext.actorUserId)` (the helper Slice D adds — see `slice-d` plan lines 478–501). `revokeUserSessions` runs on the auth pool, **outside** the data context (it is not a repository call and takes no `scopedDb`):

```typescript
server.post(
  "/api/admin/users/:id/revoke-sessions",
  { schema: adminRevokeSessionsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { id } = request.params as { id: string };
      // Admin check + target existence check share ONE transaction (post-D pattern).
      await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        const target = await repository.getUserById(scopedDb, id);
        if (!target) throw new HttpError(404, "User not found");
      });
      // revokeUserSessions runs on the auth pool (DELETE ... WHERE user_id = id) — outside the
      // data context. It targets the named user's sessions only, never the calling admin's.
      const count = dependencies.revokeUserSessions ? await dependencies.revokeUserSessions(id) : 0;
      return { success: true, count };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

> Match the post-D route pattern in `routes.ts` after rebase: `resolveAccessContext` (session only, no DB) → `withDataContext` wrapping `assertAdminUser` + `getUserById(scopedDb, id)` → repository/auth call. If, after rebasing on Slice D, `assertAdminUser`/`getUserById` carry different names or signatures than above, mirror whatever the sibling lifecycle routes use — do not invent a shape.

**Note:** `revokeUserSessions` in `packages/auth/src/index.ts` (lines 86–90) runs `DELETE FROM app.better_auth_sessions WHERE user_id = $1` with `$1 = userId` (the target user's ID, passed in by the route). It does NOT touch the calling admin's sessions. Verify this by reading lines 86–90 of `packages/auth/src/index.ts`.

- [ ] **Verify the WHERE clause in `revokeUserSessions`:**

```bash
grep -n "DELETE.*better_auth_sessions\|user_id" packages/auth/src/index.ts | head -5
```

Expected: shows `WHERE user_id = $1` with `$1 = userId` (the target). Confirm this does NOT reference the actor's own user ID.

Run:

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL tests PASS including the new revoke-sessions test.

- [ ] **Run response grep:**

```bash
grep -n "session" packages/settings/src/routes.ts
```

Expected: lines with `revokeUserSessions` (dependency call only), the new route path `/revoke-sessions`, and no response serialization that includes `better_auth_sessions` columns.

- [ ] **Commit:**

```bash
git add packages/shared/src/platform-api.ts packages/settings/src/routes.ts tests/integration/auth-settings.test.ts
git commit -m "fix(settings): add POST /api/admin/users/:id/revoke-sessions returning count only — no session identifiers in response (#141)"
```

---

### Task 6: Sanitize OAuth token-endpoint error body in `packages/connectors/src/oauth.ts`

**Files:**

- Modify: `packages/connectors/src/oauth.ts` (lines 103–114: `postToken` method)
- Test: `tests/integration/connectors-google.test.ts`

**Verified current code at lines 103–114 of `packages/connectors/src/oauth.ts`:**

```typescript
private async postToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
  }
  return (await response.json()) as GoogleTokenResponse;
}
```

The problem: `detail` (the raw Google token-endpoint response body, which may contain OAuth error codes, token hints, or debug info) is embedded directly in the `Error` message. `handleRouteError` in `routes.ts` passes unknown errors through, so this Error message reaches the HTTP response body. The fix: log `detail` server-side and strip it from the thrown Error.

`GoogleOAuthClient` has no access to a server/request logger. The class takes `deps: GoogleOAuthClientDeps`. Adding an optional `logger` to deps (with a `console`-compatible default) is the correct pattern for this codebase (consistent with `console.warn` used in `packages/auth/src/index.ts:479`).

- [ ] **Write the failing test.** Add to `describe("GoogleOAuthClient.exchangeCode", ...)` in `tests/integration/connectors-google.test.ts` (after line 97):

```typescript
it("does not include token-endpoint error body in the thrown Error message", async () => {
  const loggedErrors: Array<{ statusCode: number; detail: string }> = [];
  const fakeLogger = {
    error: (data: { statusCode: number; detail: string }, _msg: string) => {
      loggedErrors.push(data);
    }
  };
  const errorBody =
    '{"error":"invalid_client","error_description":"The OAuth client was not found."}';
  const client = new GoogleOAuthClient({
    fetchFn: (async () => ({
      ok: false,
      status: 401,
      text: async () => errorBody,
      json: async () => ({})
    })) as unknown as typeof fetch,
    logger: fakeLogger
  });

  await expect(
    client.exchangeCode({
      clientId: "bad-client",
      clientSecret: "bad-secret",
      code: "bad-code",
      redirectUri: "http://localhost:1"
    })
  ).rejects.toThrow(/Google token endpoint returned 401/);

  // The error message must NOT contain the raw detail.
  const caughtError = await client
    .exchangeCode({
      clientId: "bad-client",
      clientSecret: "bad-secret",
      code: "bad-code",
      redirectUri: "http://localhost:1"
    })
    .catch((e: Error) => e);
  expect((caughtError as Error).message).not.toContain("invalid_client");
  expect((caughtError as Error).message).not.toContain("The OAuth client was not found");

  // The detail must have been logged server-side.
  expect(loggedErrors.length).toBeGreaterThanOrEqual(1);
  expect(loggedErrors[0]?.statusCode).toBe(401);
  expect(loggedErrors[0]?.detail).toContain("invalid_client");
});
```

Run:

```bash
vitest run tests/integration/connectors-google.test.ts --reporter=verbose -t "does not include token-endpoint error body" 2>&1 | tail -20
```

Expected: FAILS because:

1. `GoogleOAuthClientDeps` does not have a `logger` field (type error or ignored at runtime).
2. The thrown error message still contains `detail`.

- [ ] **Update `GoogleOAuthClientDeps` and `postToken` in `packages/connectors/src/oauth.ts`:**

```typescript
// Add a minimal Logger interface — avoids adding a pino/fastify dependency to connectors.
interface OAuthLogger {
  error(data: Record<string, unknown>, message: string): void;
}

export interface GoogleOAuthClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly logger?: OAuthLogger;
}

export class GoogleOAuthClient {
  private readonly fetchFn: typeof fetch;
  private readonly logger: OAuthLogger;

  constructor(deps: GoogleOAuthClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
    // Default to console so no pino dependency is required in the connectors package.
    this.logger = deps.logger ?? {
      error: (data, msg) => console.error(msg, data)
    };
  }

  // ... (all other methods unchanged) ...

  private async postToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString()
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Log detail server-side for debugging. Do NOT embed it in the Error message —
      // handleRouteError propagates Error.message to the HTTP response body (#141).
      this.logger.error({ statusCode: response.status, detail }, "Google token exchange failed");
      throw new Error(`Google token endpoint returned ${response.status}`);
    }
    return (await response.json()) as GoogleTokenResponse;
  }
}
```

Run:

```bash
vitest run tests/integration/connectors-google.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL tests in `connectors-google.test.ts` PASS.

Run typecheck:

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: PASSES.

- [ ] **Verify the fix with grep:**

```bash
grep -n "detail" packages/connectors/src/oauth.ts
```

Expected: `detail` appears in the `const detail = ...` assignment and the `logger.error(...)` call (server-side log) but NOT in the `throw new Error(...)` string.

**PR note (scope limitation):** this test verifies the leak is closed at the `Error.message` level (the actual leak vector, since `handleRouteError` propagates `Error.message` to the HTTP body). The full end-to-end path — token-exchange failure → `connectors` `handleRouteError` → HTTP response body — is not exercised by an integration test here. This is acceptable because the `Error.message` is the only channel through which `detail` could reach the response, and the unit-level test pins it. Call this out in the PR description so reviewers know the e2e path was a deliberate omission, not an oversight.

- [ ] **Commit:**

```bash
git add packages/connectors/src/oauth.ts tests/integration/connectors-google.test.ts
git commit -m "fix(connectors): strip OAuth token-endpoint error body from thrown Error; log detail server-side only (#141)"
```

---

### Task 7: Full verification gate + acceptance greps

**Files:**

- No code changes.

This task runs all required acceptance greps and the full gate.

- [ ] **Acceptance grep 1 — no raw appDb DML in bootstrapFirstJarvisUser:**

```bash
grep -n "appDb\." packages/auth/src/index.ts
```

Inspect output manually. Lines inside `bootstrapFirstJarvisUser` (lines approximately 308–394 after rewrite — verify the actual line numbers after rewrite) must contain ZERO occurrences of `appDb.insertInto`, `appDb.updateTable`, `appDb.deleteFrom`, `appDb.transaction`.

- [ ] **Acceptance grep 2 — no direct admin_audit_events writes in auth:**

```bash
grep -rn "admin_audit_events" packages/auth/src/ --include="*.ts"
```

Expected: **zero matches**.

- [ ] **Acceptance grep 3 — no SettingsRepository import in auth:**

```bash
grep -rn "SettingsRepository" packages/auth/src/ --include="*.ts"
```

Expected: **zero matches**.

- [ ] **Acceptance grep 4 — module isolation (auth uses package API only):**

```bash
grep -rn "from.*packages/settings" packages/auth/src/ --include="*.ts"
```

Expected: **zero matches** (auth imports from `@jarv1s/settings`, not the relative path).

```bash
grep -n "from.*@jarv1s/settings" packages/auth/src/index.ts
```

Expected: one import line for `recordAuditEvent`.

- [ ] **Acceptance grep 5 — no session identifiers in revoke-sessions route response:**

```bash
grep -n "session" packages/settings/src/routes.ts
```

Inspect all lines. Confirm:

- The `/revoke-sessions` route handler returns only `{ success: true, count }`.
- No `serializeUser` call or session column name appears in the route's response path.

- [ ] **Acceptance grep 6 — OAuth detail not in Error message:**

```bash
grep -n "detail" packages/connectors/src/oauth.ts
```

Expected: `detail` appears in the `logger.error` call and in the `const detail = ...` assignment, but NOT in the `throw new Error(...)` string.

- [ ] **Run the auth-settings integration suite:**

```bash
vitest run tests/integration/auth-settings.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: ALL tests PASS (zero failures). Suite covers: bootstrap owner creation, 0055 trigger under `withDataContext`, `bootstrap_owner_created` audit action, revoke-sessions count-only response.

- [ ] **Run the connectors-google integration suite:**

```bash
vitest run tests/integration/connectors-google.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL tests PASS.

- [ ] **Run full foundation gate (capture the REAL exit code — do not pipe to `tail`, which masks it):**

```bash
pnpm verify:foundation; echo "EXIT=$?"
```

Expected: `EXIT=0` and **green** — lint, format:check, typecheck, file-size, db:migrate, test:integration all pass. A non-zero `EXIT` means the gate failed regardless of what the truncated tail showed.

- [ ] **Commit final state (only if Task 7 produced fixups).** Stage explicit paths — never `git add -A` / `git add -p` (interactive flags are unavailable in the build environment, and `-A` would sweep another session's work):

```bash
git add <only the files you actually changed in this fixup>
git commit -m "chore(slice-e): post-gate cleanup — all acceptance greps green"
```

---

## Summary of changes by file

| File                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/settings/src/repository.ts`            | Remove `private` from `insertAuditEvent`; add module-level `recordAuditEvent` public function                                                                                                                                                                                                                                                                                                                        |
| `packages/settings/src/index.ts`                 | Implicitly re-exports `recordAuditEvent` via `export * from "./repository.js"`                                                                                                                                                                                                                                                                                                                                       |
| `packages/auth/package.json`                     | Add `@jarv1s/settings: workspace:*` dependency                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/auth/src/index.ts`                     | Extend `CreateJarvisAuthRuntimeOptions` with `runner`; rewrite `bootstrapFirstJarvisUser` with `withDataContext`; update `createBetterAuthOptions` to accept+pass `runner`+`settings`                                                                                                                                                                                                                                |
| `packages/shared/src/platform-api.ts`            | Add `adminRevokeSessionsRouteSchema`                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/settings/src/routes.ts`                | Import `adminRevokeSessionsRouteSchema`; add `POST /api/admin/users/:id/revoke-sessions` route                                                                                                                                                                                                                                                                                                                       |
| `packages/connectors/src/oauth.ts`               | Add `OAuthLogger` interface + `logger` field to `GoogleOAuthClientDeps`; strip `detail` from thrown Error; log to `this.logger.error`                                                                                                                                                                                                                                                                                |
| `apps/api/src/server.ts`                         | Move `DataContextRunner` construction before `authRuntime`; pass `runner` to `createJarvisAuthRuntime`                                                                                                                                                                                                                                                                                                               |
| `tests/integration/auth-settings.test.ts`        | Import `DataContextRunner`; update `createJarvisAuthRuntime({ appDb })` → `({ appDb, runner: new DataContextRunner(appDb) })`; add `recordAuditEvent` behavioral test; add `bootstrap_owner_created` audit-action test + update `"bootstrap.instance_owner"` → `"bootstrap_owner_created"`; add `withDataContext` 0055-trigger test; add revoke-sessions session-scoping security test (admin survives, target dies) |
| `tests/integration/multi-user-isolation.test.ts` | Import `DataContextRunner`; update `createJarvisAuthRuntime({ appDb })` → `({ appDb, runner: new DataContextRunner(appDb) })` (required `runner` field)                                                                                                                                                                                                                                                              |
| `tests/integration/connectors-google.test.ts`    | Add OAuth error sanitization test                                                                                                                                                                                                                                                                                                                                                                                    |

## Hard invariants verified

- **`withDataContext` replaces, never nests.** The old `appDb.transaction().execute()` block in `bootstrapFirstJarvisUser` is deleted entirely. `withDataContext` is the sole transaction boundary.
- **No raw `appDb` DML in `bootstrapFirstJarvisUser`.** All DML uses `scopedDb.db` inside the `withDataContext` callback. Grep confirms zero `appDb.insertInto` / `appDb.updateTable` etc.
- **No direct `app.admin_audit_events` INSERT in auth.** Replaced with `settings.recordAuditEvent(scopedDb, ...)`. Grep confirms zero matches for `admin_audit_events` in `packages/auth/src/`.
- **`withDataContext` is an instance method.** Call is `runner.withDataContext(...)` — `runner` is the `DataContextRunner` instance from `CreateJarvisAuthRuntimeOptions.runner`.
- **Session IDs/tokens never in HTTP responses.** The revoke-sessions endpoint schema enforces `{ success: boolean; count: number }` only. The response grep confirms no session column references.
- **OAuth error detail logged, never thrown.** `detail` is passed to `this.logger.error` and the `throw new Error` contains only the HTTP status code.
- **Slice D must land first.** `SettingsRepository.insertAuditEvent` must already accept `DataContextDb`. The plan explicitly requires confirming Slice D is on `origin/main` before starting.
