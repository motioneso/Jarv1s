# Audit Slice I — Portability + Observability Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four independent hygiene issues: complete the user-data export with five missing personal-data tables, fix the dead-branch `handleRouteError` in notifications (always returns 401), add ownership checks for `listId` and `parentTaskId` in the tasks repository, and eliminate the dangling share in the foundation integration-test suite.

**Architecture:** Each fix is code-only (zero migrations, zero schema changes). The export additions follow the existing `connectorAccountsQuery`/`aiProviderConfigsQuery` redaction pattern in `scripts/export-user-data.ts`. The `handleRouteError` fix in `packages/notifications/src/routes.ts` adopts the exact-match style already used by `packages/chat/src/routes.ts:271`. The ownership checks in `packages/tasks/src/repository.ts` require a new `isOwnedByActor` method on `TaskListsRepository` (in `packages/tasks/src/lists.ts`) and a new `packages/tasks/src/errors.ts` to share `HttpError` between repository and routes without a circular import. The foundation-test fix deletes only the specific dangling share row in a targeted `afterAll`, leaving the `beforeAll`-seeded `itemBGrantedToA` share untouched.

**Tech Stack:** TypeScript, Kysely, Fastify, Vitest integration tests, Postgres with RLS

---

### Task 1: Fix `handleRouteError` in notifications routes (#149)

**Files:**

- Modify: `packages/notifications/src/routes.ts` (lines 111-117)
- Test: `tests/integration/notifications.test.ts`

- [ ] Add the probe imports — at the top of `tests/integration/notifications.test.ts`, add `import Fastify from "fastify";` (after the existing `import pg from "pg";` line) and extend the `@jarv1s/notifications` import (line 18) to also bring in `registerNotificationsRoutes`:

```typescript
import Fastify from "fastify";
```

```typescript
import {
  NotificationsRepository,
  notificationsModuleManifest,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
```

- [ ] Regression-guard test (auth errors still 401) — add to `tests/integration/notifications.test.ts` inside the existing `describe("Notifications module M5")` block, before the closing `}`. This test passes both before and after the fix; it is a regression guard, NOT the failing TDD test:

```typescript
it("returns 401 for no auth header and for an invalid bearer token", async () => {
  // No auth header → resolveAccessContext throws "Session is missing or expired" → 401.
  const noAuthResponse = await server.inject({
    method: "GET",
    url: "/api/notifications"
  });

  // An invalid bearer token → resolveAccessContext throws "Invalid bearer token" → 401.
  const invalidTokenResponse = await server.inject({
    method: "GET",
    url: "/api/notifications",
    headers: { authorization: "Bearer not-a-real-session-id" }
  });

  expect(noAuthResponse.statusCode).toBe(401);
  expect(invalidTokenResponse.statusCode).toBe(401);
  expect(noAuthResponse.json<{ error: string }>().error).toBe("Session is missing or expired");
});
```

- [ ] Write the failing TDD test — add inside the same `describe` block. This is the security/observability property the fix exists for: an unexpected (non-auth) error must surface as a 500, NOT be masked as a 401. It uses the `repository?` DI seam on `NotificationsRoutesDependencies` (verified at `packages/notifications/src/routes.ts:13-17`) to force a non-auth throw, and a standalone Fastify instance so the route's `handleRouteError` is exercised directly. `apps/api/src/server.ts` sets no custom `errorHandler`, so a re-thrown error yields Fastify's default 500:

```typescript
it("returns 500 (not 401) when an unexpected error escapes a notification route", async () => {
  const probe = Fastify({ logger: false });
  registerNotificationsRoutes(probe, {
    resolveAccessContext: async () => ({
      actorUserId: ids.userA,
      requestId: "request:err-probe"
    }),
    dataContext,
    repository: {
      listVisible: async () => {
        throw new Error("boom-stack-details");
      }
    } as unknown as NotificationsRepository
  });
  await probe.ready();

  try {
    const res = await probe.inject({ method: "GET", url: "/api/notifications" });

    // Before the fix the dead-branch handleRouteError masks this as 401; after the fix it re-throws → 500.
    expect(res.statusCode).toBe(500);
    // The internal error message must not leak to the client.
    expect(res.body).not.toContain("boom-stack-details");
  } finally {
    await probe.close();
  }
});
```

Run: `vitest run tests/integration/notifications.test.ts`
Expected: the 500 test FAILS (red) — the current dead-branch `handleRouteError` returns 401 for the forced throw. The 401 regression-guard test PASSES.

- [ ] Implement fix — edit `packages/notifications/src/routes.ts` lines 111-117:

Replace:

```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message.includes("Session")) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }

  return reply.code(401).send({ error: "Session is missing or expired" });
}
```

With:

```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message === "Session is missing or expired") {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  if (error instanceof Error && error.message === "Invalid bearer token") {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  throw error;
}
```

- [ ] Verify the dead-branch is eliminated — run the acceptance grep:

```bash
grep -n 'includes("Session")' packages/notifications/src/routes.ts
```

Expected: zero matches (exit code 1 or empty output).

```bash
grep -c 'reply.code(401)' packages/notifications/src/routes.ts
```

Expected: `2` (exactly two 401 branches remain — one per auth-error message, not a fallthrough catch-all).

- [ ] Review the sibling `handleRouteError` the spec flags — `packages/chat/src/routes.ts` (function starts at line 271). The spec requires this be checked in the same PR. Verified during planning: chat's variant already uses exact-match `===` for both auth messages with no dead-branch fallthrough, so no code change is required — but the check must be executed and recorded:

```bash
grep -n 'includes("Session")' packages/chat/src/routes.ts
```

Expected: zero matches. Record in the PR body: "Reviewed `packages/chat/src/routes.ts:271` per spec — already exact-match (`===`), no dead branch, no change needed."

- [ ] Run the full notifications test suite to confirm no regressions:

```bash
vitest run tests/integration/notifications.test.ts
```

Expected: all existing tests PASS.

- [ ] Commit:

```bash
git add packages/notifications/src/routes.ts tests/integration/notifications.test.ts
git commit -m "fix(notifications): fix dead-branch handleRouteError — unexpected errors re-throw (not 401)

Resolves audit finding #149. The dead else-branch that returned 401 for
all errors regardless of type is removed. Now: exact-match on auth-error
messages returns 401; all other errors are re-thrown to Fastify's default
handler for a proper 500 + server-side logging. Switches from .includes()
to === to match the exact-match style in tasks/chat/briefings routes. (The
client-facing body text 'Session is missing or expired' is the notifications
module's own wording — only the matching style is shared house style, not
the body string.)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Create `packages/tasks/src/errors.ts` and update routes to import from it (#140 prerequisite)

**Files:**

- Create: `packages/tasks/src/errors.ts`
- Modify: `packages/tasks/src/routes.ts` (lines 598-619)
- Test: `tests/integration/tasks.test.ts`

This task extracts `HttpError` from `packages/tasks/src/routes.ts` into a shared module-local file so the repository can throw it without creating a circular dependency.

- [ ] Write failing test — add to `tests/integration/tasks.test.ts` inside the existing `describe("Tasks module M1")` block. This test will fail until `errors.ts` exists and is reachable:

```typescript
it("HttpError from tasks errors module has correct statusCode and message", async () => {
  // Dynamic import using workspace-relative path so the test fails if the file doesn't exist.
  const { HttpError } = await import("../../packages/tasks/src/errors.js");
  const err = new HttpError(404, "not found");
  expect(err.statusCode).toBe(404);
  expect(err.message).toBe("not found");
  expect(err).toBeInstanceOf(Error);
});
```

Run: `vitest run tests/integration/tasks.test.ts`
Expected: FAIL — `../../packages/tasks/src/errors.js` does not exist.

- [ ] Create `packages/tasks/src/errors.ts`:

```typescript
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
```

- [ ] Update `packages/tasks/src/routes.ts` — remove the local `HttpError` class at lines 612-619 and add an import from `./errors.js`:

At the top of the file, after the existing local imports (around line 27-40), add:

```typescript
import { HttpError } from "./errors.js";
```

Remove the class declaration at lines 612-619:

```typescript
class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
```

Note: do NOT add an `errors.js` sub-path to `packages/tasks/package.json` exports. Within-package imports (`import { HttpError } from "./errors.js"`) resolve directly by file path and do not need an exports entry; the repository and routes are both within-package consumers, and the integration test in this task uses a workspace-relative path (`../../packages/tasks/src/errors.js`) that also bypasses the exports map. No external consumer exists, so an exports entry would be dead scaffolding — per the project's no-stale-scaffolding rule, leave `package.json` untouched.

- [ ] Run the test to confirm it now PASSES:

```bash
vitest run tests/integration/tasks.test.ts
```

Expected: the new `HttpError` test PASSES; all prior tests remain green.

- [ ] Commit:

```bash
git add packages/tasks/src/errors.ts packages/tasks/src/routes.ts tests/integration/tasks.test.ts
git commit -m "refactor(tasks): extract HttpError to tasks/errors.ts for shared use by repository and routes

Prerequisite for audit #140 fix. No behaviour change — routes still throw
the same HttpError; the class now lives in a shared module-local file so
the repository can import it without creating a circular dependency.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add `isOwnedByActor` to `TaskListsRepository` and add ownership checks to `TasksRepository` (#140)

**Files:**

- Modify: `packages/tasks/src/lists.ts` (append new method)
- Modify: `packages/tasks/src/repository.ts` (lines 95-127 create path; lines 183-187 update path)
- Modify: `packages/tasks/src/routes.ts` (lines 598-610 `handleRouteError` — add `HttpError` message mapping if needed)
- Test: `tests/integration/tasks.test.ts`

- [ ] Write failing tests — add inside `describe("Tasks module M1")`:

```typescript
it("rejects task create with a listId that belongs to another user (404)", async () => {
  // userB has a Personal list. userA tries to create a task on it.
  const userBList = await dataContext.withDataContext(userBContext(), (db) =>
    new TaskListsRepository().getOrCreateDefault(db)
  );

  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "cross-list task",
        listId: userBList.id
      })
    )
  ).rejects.toThrow("List not found or not accessible");
});

it("rejects task create with a parentTaskId owned by another user (404)", async () => {
  // taskIds.bPrivate is owned by userB; userA should not be able to parent under it.
  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "cross-parent task",
        parentTaskId: taskIds.bPrivate
      })
    )
  ).rejects.toThrow("Parent task not found or not accessible");
});

it("rejects task update with a listId that belongs to another user (404)", async () => {
  const task = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "will be moved to wrong list" })
  );
  const userBList = await dataContext.withDataContext(userBContext(), (db) =>
    new TaskListsRepository().getOrCreateDefault(db)
  );

  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.update(db, task.id, { listId: userBList.id })
    )
  ).rejects.toThrow("List not found or not accessible");
});

it("rejects task update with a parentTaskId owned by another user (404)", async () => {
  const task = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "will be re-parented to wrong task" })
  );

  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.update(db, task.id, { parentTaskId: taskIds.bPrivate })
    )
  ).rejects.toThrow("Parent task not found or not accessible");
});

it("allows task create with own listId and own parentTaskId", async () => {
  const list = await dataContext.withDataContext(userAContext(), (db) =>
    new TaskListsRepository().getOrCreateDefault(db)
  );
  const parent = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "parent task" })
  );
  const child = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, {
      title: "child task",
      listId: list.id,
      parentTaskId: parent.id
    })
  );

  expect(child.list_id).toBe(list.id);
  expect(child.parent_task_id).toBe(parent.id);
});

it("rejects parenting under a task that is only VIEW-SHARED to the actor (ownership, not visibility)", async () => {
  // This is the security point of #140. app.tasks RLS is owner-OR-share
  // (0019_tasks_owner_or_share.sql), so a userB-owned task that is view-shared
  // to userA passes a plain getById/visibility check. A visibility-only parent
  // check would WRONGLY allow userA to parent under it, then maybeAutoCloseParent
  // would write task_activity on userB's foreign parent. The explicit
  // owner_user_id = current_actor_user_id() predicate must reject it.
  const userBTask = await dataContext.withDataContext(userBContext(), (db) =>
    repository.create(db, { title: "userB task, view-shared to A" })
  );
  await dataContext.withDataContext(userBContext(), (db) =>
    sharesRepository.grant(db, {
      resourceType: "task",
      resourceId: userBTask.id,
      ownerUserId: ids.userB,
      granteeUserId: ids.userA,
      level: "view"
    })
  );

  // Sanity: userA CAN see the task (visibility passes) ...
  const visibleToA = await dataContext.withDataContext(userAContext(), (db) =>
    repository.getById(db, userBTask.id)
  );
  expect(visibleToA?.id).toBe(userBTask.id);

  // ... but must NOT be able to parent under it on create.
  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "child under foreign parent", parentTaskId: userBTask.id })
    )
  ).rejects.toThrow("Parent task not found or not accessible");

  // ... and must NOT be able to re-parent an existing own task under it on update.
  const ownTask = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "userA own task" })
  );
  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      repository.update(db, ownTask.id, { parentTaskId: userBTask.id })
    )
  ).rejects.toThrow("Parent task not found or not accessible");
});
```

Run: `vitest run tests/integration/tasks.test.ts`
Expected: the four "rejects" tests plus the view-share ownership-vs-visibility test FAIL (no ownership checks yet — the view-share test's `getById` sanity assertion passes, but the two `rejects.toThrow` assertions fail because the un-fixed create/update accept the view-shared parent); the "allows" test PASSES.

- [ ] Add `isOwnedByActor` to `packages/tasks/src/lists.ts` — append inside `TaskListsRepository` class after line 107 (after `listTags`):

```typescript
  async isOwnedByActor(db: DataContextDb, listId: string): Promise<boolean> {
    assertDataContextDb(db);
    const row = await db.db
      .selectFrom("app.task_lists")
      .select("id")
      .where("id", "=", listId)
      .executeTakeFirst();
    return !!row; // RLS is owner-only (0039_tasks_foundation.sql); row present = actor owns it
  }
```

- [ ] Add `import { HttpError } from "./errors.js";` to `packages/tasks/src/repository.ts` — after the existing imports block (after line 14 `import { TaskListsRepository }...`):

```typescript
import { HttpError } from "./errors.js";
```

- [ ] Add ownership check for `listId` on the create path in `packages/tasks/src/repository.ts` — between line 95 (`const listId = input.listId ?? ...`) and the `const now = new Date()` line. Replace the current line 96:

Replace:

```typescript
// Resolve list_id: use the provided listId or fall back to the actor's Personal list.
const listId = input.listId ?? (await this.listsRepository.getOrCreateDefault(scopedDb)).id;
```

With:

```typescript
// Resolve list_id: use the provided listId or fall back to the actor's Personal list.
// If a listId is provided, verify the actor owns it (RLS on task_lists is owner-only).
if (input.listId) {
  const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
  if (!owned) throw new HttpError(404, "List not found or not accessible");
}
const listId = input.listId ?? (await this.listsRepository.getOrCreateDefault(scopedDb)).id;
```

- [ ] Add ownership check for `parentTaskId` on the create path in `packages/tasks/src/repository.ts` — after the `listId` resolution block and before the `const now = new Date()` line. The current line 127 is `parent_task_id: input.parentTaskId ?? null,`. Add the check before `const now = new Date()`:

```typescript
// Verify ownership (not just visibility) for parentTaskId.
// app.tasks RLS is owner-or-share, so a plain getById would succeed for view-shared tasks.
// We require owner_user_id = current_actor_user_id() explicitly.
if (input.parentTaskId != null) {
  const parentOwned = await scopedDb.db
    .selectFrom("app.tasks")
    .select("id")
    .where("id", "=", input.parentTaskId)
    .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
    .executeTakeFirst();
  if (!parentOwned) throw new HttpError(404, "Parent task not found or not accessible");
}
```

- [ ] Add ownership check for `listId` and `parentTaskId` on the update path in `packages/tasks/src/repository.ts` — add checks before the `const updates: Updateable<TasksTable>` block (currently at line 161). Add immediately after `assertDataContextDb(scopedDb);` (line 159):

```typescript
// Ownership check: if the caller is moving the task to a different list, verify ownership.
if (input.listId !== undefined) {
  const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
  if (!owned) throw new HttpError(404, "List not found or not accessible");
}
// Ownership check: if the caller is reparenting the task, require owner_user_id match.
if (input.parentTaskId != null) {
  const parentOwned = await scopedDb.db
    .selectFrom("app.tasks")
    .select("id")
    .where("id", "=", input.parentTaskId)
    .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
    .executeTakeFirst();
  if (!parentOwned) throw new HttpError(404, "Parent task not found or not accessible");
}
```

- [ ] Update `packages/tasks/src/routes.ts` `handleRouteError` (lines 598-610) to map the new `HttpError` messages to 404 responses. The function already handles `HttpError` via `error instanceof HttpError` at line 599, so 404 responses from the repository will be handled correctly. Verify:

```bash
grep -n 'instanceof HttpError' packages/tasks/src/routes.ts
```

Expected: one match at line 599 (`if (error instanceof HttpError) { return reply.code(error.statusCode)...`). No further change needed.

- [ ] Run the failing tests to confirm they now PASS:

```bash
vitest run tests/integration/tasks.test.ts
```

Expected: all six new ownership tests PASS (the four list/parent rejects, the allow-own case, and the view-share ownership-vs-visibility case); no existing tests regress.

- [ ] Verify the acceptance-level HTTP 404 response — add an HTTP-level test inside the existing API route test or as a new test:

```typescript
it("POST /api/tasks with a foreign listId returns 404", async () => {
  // userB's list id — obtained via bootstrap since we can't leak it from another user's context
  // through the API. Instead use the repository-seeded list from seedTaskData.
  // We need a listId that belongs to userB. Use the repository directly to get it.
  const userBList = await dataContext.withDataContext(userBContext(), (db) =>
    new TaskListsRepository().getOrCreateDefault(db)
  );

  const response = await server.inject({
    method: "POST",
    url: "/api/tasks",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { title: "cross-list via API", listId: userBList.id }
  });

  expect(response.statusCode).toBe(404);
  expect(response.json<{ error: string }>().error).toBe("List not found or not accessible");
});
```

Run: `vitest run tests/integration/tasks.test.ts`
Expected: PASS.

- [ ] Commit:

```bash
git add packages/tasks/src/lists.ts packages/tasks/src/repository.ts tests/integration/tasks.test.ts
git commit -m "fix(tasks): add listId and parentTaskId ownership checks on create and update (#140)

Before assigning list_id or parent_task_id, the repository now verifies
the actor owns the target resource. isOwnedByActor on TaskListsRepository
relies on owner-only RLS (task_lists). The parent-task check uses an
explicit owner_user_id = current_actor_user_id() predicate to prevent a
view-share grantee from parenting their task under another user's task.
Both create and update paths are guarded. Returns 404 via HttpError.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Fix dangling share in foundation integration test (#166)

**Files:**

- Modify: `tests/integration/foundation.test.ts` (around line 217-244)

- [ ] Read the exact test name and share values in `tests/integration/foundation.test.ts` lines 217-244 (already verified above):

The test is: `"allows probe access through a view share"` at line 217.
The share row created is:

- `resource_type`: `'rls_probe_item'`
- `resource_id`: `ids.itemAOwnPrivate` (`"10000000-0000-4000-8000-000000000001"`)
- `owner_user_id`: `ids.userA`
- `grantee_user_id`: `ids.userB`
- `level`: `'view'`

- [ ] Write failing test — confirm the isolation failure exists by checking there is no `afterAll` teardown for this specific share. Run the suite and note that `ids.itemAOwnPrivate` remains shared with `ids.userB` for all subsequent tests. The observable failure is that a later test relying on "userB cannot see itemAOwnPrivate" would be masked, but since no such test currently exists, the failure is the self-incriminating comment. Confirm the current state:

```bash
grep -n "no teardown\|persists for the remainder" tests/integration/foundation.test.ts
```

Expected: one match at line 220. This comment is the acceptance-level indicator of the bug.

- [ ] Implement the fix — add a targeted `afterAll` immediately before the test `"allows probe access through a view share"` (or wrap the test in a `describe` block to scope the `afterAll`). The cleanest approach without restructuring tests is to add an `afterAll` inside the `describe("MVP foundation scaffold")` block, but scoped by placement. Since Vitest `afterAll` is per-`describe` scope, place a `describe` wrapper:

Replace the test block in `tests/integration/foundation.test.ts` at line 217-244:

```typescript
it("allows probe access through a view share", async () => {
  // userA owns a probe row; share 'view' to userB so the new owner-or-share
  // policy grants userB SELECT access.
  // NOTE: this share persists for the remainder of the suite (no teardown); no later test asserts userB cannot see itemAOwnPrivate.
  await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "request:share-setup" },
    async (scopedDb) => {
      await sql`
          insert into app.shares
            (resource_type, resource_id, owner_user_id, grantee_user_id, level)
          values
            ('rls_probe_item', ${ids.itemAOwnPrivate}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, 'view')
        `.execute(scopedDb.db);
    }
  );

  const visibleToB = await dataContext.withDataContext(
    { actorUserId: ids.userB, requestId: "request:user-b" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.rls_probe_items")
        .selectAll()
        .where("id", "=", ids.itemAOwnPrivate)
        .executeTakeFirst()
  );

  expect(visibleToB?.id).toBe(ids.itemAOwnPrivate);
});
```

With:

```typescript
describe("transient view share (isolated)", () => {
  afterAll(async () => {
    // Delete only the specific share created by this test; the beforeAll-seeded
    // share for itemBGrantedToA (resource_id = ids.itemBGrantedToA) is untouched.
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "request:share-teardown" },
      async (scopedDb) => {
        await scopedDb.db
          .deleteFrom("app.shares")
          .where("resource_type", "=", "rls_probe_item")
          .where("resource_id", "=", ids.itemAOwnPrivate)
          .where("grantee_user_id", "=", ids.userB)
          .execute();
      }
    );
  });

  it("allows probe access through a view share", async () => {
    // userA owns a probe row; share 'view' to userB so the new owner-or-share
    // policy grants userB SELECT access.
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "request:share-setup" },
      async (scopedDb) => {
        await sql`
            insert into app.shares
              (resource_type, resource_id, owner_user_id, grantee_user_id, level)
            values
              ('rls_probe_item', ${ids.itemAOwnPrivate}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, 'view')
          `.execute(scopedDb.db);
      }
    );

    const visibleToB = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "request:user-b" },
      (scopedDb) =>
        scopedDb.db
          .selectFrom("app.rls_probe_items")
          .selectAll()
          .where("id", "=", ids.itemAOwnPrivate)
          .executeTakeFirst()
    );

    expect(visibleToB?.id).toBe(ids.itemAOwnPrivate);
  });
});
```

- [ ] Add an isolation-verification test that proves BOTH halves of the fix: (a) the seeded `itemBGrantedToA` share is still intact after the teardown, AND (b) the transient `itemAOwnPrivate` share was actually removed so userB can no longer see it. The second assertion is what catches a silently-failing or drifted teardown — without it this test merely duplicates the downstream `"allows access through an app.shares view grant"` test. Add immediately after the `describe("transient view share (isolated)")` block:

```typescript
it("share isolation: seeded itemBGrantedToA survives and transient itemAOwnPrivate share is gone", async () => {
  // (a) The teardown in the transient-share describe deletes only the itemAOwnPrivate
  // share — the beforeAll-seeded itemBGrantedToA share must remain, so userA still sees it.
  const seededStillVisible = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.getById(scopedDb, ids.itemBGrantedToA)
  );
  expect(seededStillVisible?.id).toBe(ids.itemBGrantedToA);

  // (b) The transient share for itemAOwnPrivate was removed — userB must no longer see it.
  // If the targeted afterAll delete silently fails or its where-clause drifts, this fails.
  const transientGone = await dataContext.withDataContext(
    { actorUserId: ids.userB, requestId: "request:user-b-isolation" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.rls_probe_items")
        .selectAll()
        .where("id", "=", ids.itemAOwnPrivate)
        .executeTakeFirst()
  );
  expect(transientGone).toBeUndefined();
});
```

- [ ] Verify the self-incriminating comment is removed:

```bash
grep -n "no teardown\|persists for the remainder" tests/integration/foundation.test.ts
```

Expected: zero matches.

- [ ] Run the foundation suite to confirm all tests PASS, including the downstream share test:

```bash
vitest run tests/integration/foundation.test.ts
```

Expected: all tests PASS, including `"allows access through an app.shares view grant"` (the test at line 256 that depends on `itemBGrantedToA`).

- [ ] Commit:

```bash
git add tests/integration/foundation.test.ts
git commit -m "fix(tests): eliminate dangling share in foundation integration suite (#166)

The 'allows probe access through a view share' test created a share for
itemAOwnPrivate that persisted for the remainder of the suite. Wrap the
test in a describe block with a targeted afterAll that deletes only this
specific share row. The beforeAll-seeded itemBGrantedToA share is
untouched. Added isolation-verification test to prove the seeded share
survives the teardown.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Add missing tables to user data export (#170)

**Files:**

- Modify: `scripts/export-user-data.ts` (lines 27-53 `UserDataExportTables`; lines 105-131 `readExportTables`; end of file — add five new query functions)
- Test: `tests/integration/release-hardening.test.ts` (extend the existing export test at lines 32-83)

- [ ] Write failing tests — extend the existing `"exports user-owned data..."` test in `tests/integration/release-hardening.test.ts`. Add new assertions after the existing `expect(Object.keys(...)).not.toContain("encryptedCredential")` assertion at line 81, inside the same `it` block:

```typescript
// #170: five missing personal-data tables must now be present.
expect(userExport.tables).toHaveProperty("memoryChunks");
expect(userExport.tables).toHaveProperty("chatMemoryFacts");
expect(userExport.tables).toHaveProperty("commitments");
expect(userExport.tables).toHaveProperty("entities");
expect(userExport.tables).toHaveProperty("preferences");

// Redaction: embedding and content_hash must never appear in the export JSON.
expect(exportedJson).not.toContain('"embedding"');
expect(exportedJson).not.toContain('"content_hash"');
expect(exportedJson).not.toContain('"file_hash"');
```

Also add a new dedicated test to assert per-table structure when rows are present (this requires seeding data in `seedLifecycleData`):

```typescript
it("exports memory chunks, memory facts, commitments, entities, and preferences — redacts derived fields", async () => {
  // Seed the five new tables for userA.
  await seedExportExtensionData();

  const userExport = await exportUserData({
    appConnectionString: connectionStrings.app,
    exportedAt: new Date("2026-06-12T10:00:00.000Z"),
    userId: ids.userA
  });
  const exportedJson = JSON.stringify(userExport);

  // memoryChunks: present, includes user-facing fields, excludes embedding and content_hash.
  expect(userExport.tables.memoryChunks.length).toBeGreaterThan(0);
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("id");
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("sourceKind");
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("sourcePath");
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("lineStart");
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("lineEnd");
  expect(userExport.tables.memoryChunks[0]).toHaveProperty("text");
  expect(Object.keys(userExport.tables.memoryChunks[0] ?? {})).not.toContain("embedding");
  expect(Object.keys(userExport.tables.memoryChunks[0] ?? {})).not.toContain("content_hash");
  expect(Object.keys(userExport.tables.memoryChunks[0] ?? {})).not.toContain("contentHash");

  // chatMemoryFacts: present, no embedding column.
  expect(userExport.tables.chatMemoryFacts.length).toBeGreaterThan(0);
  expect(userExport.tables.chatMemoryFacts[0]).toHaveProperty("id");
  expect(userExport.tables.chatMemoryFacts[0]).toHaveProperty("category");
  expect(userExport.tables.chatMemoryFacts[0]).toHaveProperty("content");
  expect(Object.keys(userExport.tables.chatMemoryFacts[0] ?? {})).not.toContain("embedding");

  // commitments: present with user-visible columns.
  expect(userExport.tables.commitments.length).toBeGreaterThan(0);
  expect(userExport.tables.commitments[0]).toHaveProperty("id");
  expect(userExport.tables.commitments[0]).toHaveProperty("title");
  expect(userExport.tables.commitments[0]).toHaveProperty("status");

  // entities: present with user-visible columns.
  expect(userExport.tables.entities.length).toBeGreaterThan(0);
  expect(userExport.tables.entities[0]).toHaveProperty("id");
  expect(userExport.tables.entities[0]).toHaveProperty("name");
  expect(userExport.tables.entities[0]).toHaveProperty("type");

  // preferences: present with key/value structure.
  expect(userExport.tables.preferences.length).toBeGreaterThan(0);
  expect(userExport.tables.preferences[0]).toHaveProperty("id");
  expect(userExport.tables.preferences[0]).toHaveProperty("key");
  expect(userExport.tables.preferences[0]).toHaveProperty("valueJson");

  // Global redaction guard across all new sections — key-level AND value-level.
  expect(exportedJson).not.toContain('"embedding"');
  expect(exportedJson).not.toContain('"content_hash"');
  expect(exportedJson).not.toContain('"file_hash"');
  // Value-level: the seed plants 'hash-sentinel' as memory_chunks.content_hash. A key-only
  // check would miss a renamed-column leak; assert the sentinel value never appears.
  expect(exportedJson).not.toContain("hash-sentinel");
});
```

Add the `seedExportExtensionData` helper inside the same test file (alongside `seedLifecycleData`):

```typescript
async function seedExportExtensionData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app.memory_chunks
         (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
       VALUES ($1, 'vault', 'notes/test.md', 0, 10, 'hash-sentinel', 'chunk text sentinel')`,
      [ids.userA]
    );
    await client.query(
      `INSERT INTO app.chat_memory_facts
         (owner_user_id, category, content, importance)
       VALUES ($1, 'fact', 'user likes coffee', 0.80)`,
      [ids.userA]
    );
    await client.query(
      `INSERT INTO app.commitments
         (owner_user_id, title, status, provenance, source_kind)
       VALUES ($1, 'send the report', 'open', 'inferred', 'email')`,
      [ids.userA]
    );
    await client.query(
      `INSERT INTO app.entities
         (owner_user_id, type, name, attributes, provenance)
       VALUES ($1, 'person', 'Alice Smith', '{}', 'volunteered')`,
      [ids.userA]
    );
    await client.query(
      `INSERT INTO app.preferences
         (owner_user_id, key, value_json)
       VALUES ($1, 'persona.tone', '"concise"')`,
      [ids.userA]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
```

Run: `vitest run tests/integration/release-hardening.test.ts`
Expected: the new assertions in the first test FAIL (keys not present); the second test FAILS (tables missing from export).

- [ ] Update `UserDataExportTables` interface in `scripts/export-user-data.ts` — add the five new readonly properties to the interface at lines 33-53:

```typescript
export interface UserDataExportTables {
  readonly aiAssistantActionRequests: readonly ExportRow[];
  readonly aiConfiguredModels: readonly ExportRow[];
  readonly aiProviderConfigs: readonly ExportRow[];
  readonly authAccounts: readonly ExportRow[];
  readonly betterAuthSessions: readonly ExportRow[];
  readonly briefingDefinitions: readonly ExportRow[];
  readonly briefingRuns: readonly ExportRow[];
  readonly calendarEvents: readonly ExportRow[];
  readonly chatMemoryFacts: readonly ExportRow[];
  readonly chatMessages: readonly ExportRow[];
  readonly chatThreads: readonly ExportRow[];
  readonly commitments: readonly ExportRow[];
  readonly connectorAccounts: readonly ExportRow[];
  readonly emailMessages: readonly ExportRow[];
  readonly entities: readonly ExportRow[];
  readonly memoryChunks: readonly ExportRow[];
  readonly notificationReads: readonly ExportRow[];
  readonly notifications: readonly ExportRow[];
  readonly preferences: readonly ExportRow[];
  readonly resourceGrants: readonly ExportRow[];
  readonly taskActivity: readonly ExportRow[];
  readonly tasks: readonly ExportRow[];
  readonly users: readonly ExportRow[];
  readonly workspaceMemberships: readonly ExportRow[];
}
```

- [ ] Update `readExportTables` in `scripts/export-user-data.ts` (lines 105-131) — add the five new entries to the returned object:

```typescript
async function readExportTables(
  scopedDb: DataContextDb,
  authDb: Kysely<JarvisDatabase>,
  userId: string
): Promise<UserDataExportTables> {
  return {
    users: await readRows(scopedDb.db, userQuery(userId)),
    authAccounts: await readRows(authDb, authAccountsQuery(userId)),
    betterAuthSessions: await readRows(authDb, betterAuthSessionsQuery(userId)),
    workspaceMemberships: await readRows(scopedDb.db, workspaceMembershipsQuery(userId)),
    resourceGrants: await readRows(scopedDb.db, resourceGrantsQuery(userId)),
    tasks: await readRows(scopedDb.db, tasksQuery(userId)),
    taskActivity: await readRows(scopedDb.db, taskActivityQuery(userId)),
    notifications: await readRows(scopedDb.db, notificationsQuery(userId)),
    notificationReads: await readRows(scopedDb.db, notificationReadsQuery(userId)),
    connectorAccounts: await readRows(scopedDb.db, connectorAccountsQuery(userId)),
    calendarEvents: await readRows(scopedDb.db, calendarEventsQuery(userId)),
    emailMessages: await readRows(scopedDb.db, emailMessagesQuery(userId)),
    aiProviderConfigs: await readRows(scopedDb.db, aiProviderConfigsQuery(userId)),
    aiConfiguredModels: await readRows(scopedDb.db, aiConfiguredModelsQuery(userId)),
    aiAssistantActionRequests: await readRows(scopedDb.db, aiAssistantActionRequestsQuery(userId)),
    chatThreads: await readRows(scopedDb.db, chatThreadsQuery(userId)),
    chatMessages: await readRows(scopedDb.db, chatMessagesQuery(userId)),
    briefingDefinitions: await readRows(scopedDb.db, briefingDefinitionsQuery(userId)),
    briefingRuns: await readRows(scopedDb.db, briefingRunsQuery(userId)),
    memoryChunks: await readRows(scopedDb.db, memoryChunksQuery(userId)),
    chatMemoryFacts: await readRows(scopedDb.db, chatMemoryFactsQuery(userId)),
    commitments: await readRows(scopedDb.db, commitmentsQuery(userId)),
    entities: await readRows(scopedDb.db, entitiesQuery(userId)),
    preferences: await readRows(scopedDb.db, preferencesQuery(userId))
  };
}
```

- [ ] Add the five new query functions to `scripts/export-user-data.ts` — add after the `briefingRunsQuery` function (after line 479). Note for QA: `memoryChunksQuery` intentionally exports `ownerUserId` and `updatedAt` in addition to the spec's listed columns (`id`, `source_kind`, `source_path`, `line_start`, `line_end`, `text`) — this matches the house pattern used by `tasksQuery`/`briefingRunsQuery` and is an intentional superset, not drift. None of the added columns are derived/sensitive.

```typescript
function memoryChunksQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      source_kind AS "sourceKind",
      source_path AS "sourcePath",
      line_start AS "lineStart",
      line_end AS "lineEnd",
      text,
      updated_at AS "updatedAt"
    FROM app.memory_chunks
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY source_path, line_start, id
  `;
}

function chatMemoryFactsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      category,
      content,
      source_thread_id::text AS "sourceThreadId",
      importance,
      status,
      superseded_at AS "supersededAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.chat_memory_facts
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function commitmentsQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      title,
      counterparty,
      due_at AS "dueAt",
      status::text,
      provenance::text,
      source_kind::text AS "sourceKind",
      source_ref AS "sourceRef",
      surfaced_state AS "surfacedState",
      life_area AS "lifeArea",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.commitments
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function entitiesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      type::text,
      name,
      attributes,
      provenance::text,
      vault_note_path AS "vaultNotePath",
      connector_refs AS "connectorRefs",
      life_area AS "lifeArea",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.entities
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function preferencesQuery(userId: string) {
  return sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      key,
      value_json AS "valueJson",
      updated_at AS "updatedAt"
    FROM app.preferences
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY key, id
  `;
}
```

- [ ] Run the release-hardening tests to confirm both the new assertions and the new dedicated test PASS:

```bash
vitest run tests/integration/release-hardening.test.ts
```

Expected: all tests PASS including the two new assertions.

- [ ] Verify the hard invariant — no `embedding`, `content_hash`, or `file_hash` column appears in any query function:

```bash
grep -n 'embedding\|content_hash\|file_hash' scripts/export-user-data.ts
```

Expected: zero matches.

- [ ] Commit:

```bash
git add scripts/export-user-data.ts tests/integration/release-hardening.test.ts
git commit -m "fix(export): add missing personal-data tables to user export (#170)

Adds memoryChunks, chatMemoryFacts, commitments, entities, and preferences
to the export allowlist. Derived/sensitive fields (embedding, content_hash,
file_hash) are explicitly excluded from all five queries. Release-hardening
integration test extended with per-table presence assertions and a global
redaction guard. UserDataExportTables interface updated accordingly.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Final verification — acceptance greps + full gate

**Files:** All files touched in Tasks 1-5.

- [ ] Run the notifications-specific acceptance grep:

```bash
grep -n 'includes("Session")' packages/notifications/src/routes.ts
```

Expected: zero matches.

- [ ] Run the tasks-repository ownership grep — confirm both create and update paths have the ownership check:

```bash
grep -n 'List not found or not accessible\|Parent task not found or not accessible' packages/tasks/src/repository.ts
```

Expected: four matches (two messages × two paths each — create and update).

- [ ] Run the export redaction grep — confirm no derived fields leaked:

```bash
grep -n 'embedding\|content_hash\|file_hash' scripts/export-user-data.ts
```

Expected: zero matches.

- [ ] Run the foundation-test self-incriminating-comment grep:

```bash
grep -n 'no teardown\|persists for the remainder' tests/integration/foundation.test.ts
```

Expected: zero matches.

- [ ] Run the targeted test suites individually to confirm all are green:

```bash
vitest run tests/integration/foundation.test.ts
```

Expected: all PASS.

```bash
vitest run tests/integration/notifications.test.ts
```

Expected: all PASS.

```bash
vitest run tests/integration/tasks.test.ts
```

Expected: all PASS.

```bash
vitest run tests/integration/release-hardening.test.ts
```

Expected: all PASS.

- [ ] Run the full verification gate:

```bash
pnpm verify:foundation
```

Expected: green (lint, format:check, check:file-size, typecheck, db:migrate, test:integration all pass).

- [ ] Commit (if any final fixes were needed during gate):

```bash
git add <any files adjusted during gate>
git commit -m "chore(audit-slice-i): verify:foundation green — portability + observability tail

All four audit findings resolved: #170 export completeness, #149 dead-branch
handleRouteError in notifications, #140 task list/parent ownership checks,
#166 foundation test share isolation. Full gate passes.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
