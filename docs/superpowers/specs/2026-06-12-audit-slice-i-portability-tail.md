# Spec: Audit Slice I — Portability + Observability Tail

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #170, #149, #140, #166
**Tier:** `sensitive` (#170 has end-user privacy impact) + `routine` (#149, #140, #166)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)
**Dependency:** Parallel-safe. Does not share files with the migration spine. May land at
any point after Slice A merges (no structural dependency on B–H). #166 requires access to
`tests/integration/foundation.test.ts`.

---

## Context

Four independent hygiene and portability fixes, none requiring schema changes:

- **#170 — export omits user memory and structured-state data:**
  `scripts/export-user-data.ts` maintains an explicit allowlist. Missing from it:
  `app.memory_chunks`, `app.chat_memory_facts`, `app.commitments`, `app.entities`,
  `app.preferences`. These are core personal data tables (episodic memory, structured notes,
  user commitments). A GDPR-style data export that omits them is incomplete.
  **Known-incomplete residual:** `app.shares` (the live owner-or-share sharing table) and
  task-module tables (`app.task_lists`, `app.task_tags`) also contain personal data and are
  not exported today. `tasksQuery` (≈ lines 227–244) is missing eight post-foundation columns
  (`list_id`, `parent_task_id`, `do_at`, `effort`, `source`, `source_ref`, `external_key`,
  `recurrence`). These are tracked as follow-up work; this slice only adds the five specified tables.
- **#149 — `handleRouteError` always returns 401:**
  `packages/notifications/src/routes.ts:111-117` has a dead conditional — both branches of an
  `if` block send `401 Session is missing or expired`. Any unexpected error (5xx, data error,
  DB timeout) is masked as a 401 auth failure.
- **#140 — no list/parent-task ownership check on task create/update:**
  `packages/tasks/src/repository.ts:96` (create: `input.listId` taken raw),
  `:127` (create: `input.parentTaskId` taken raw),
  `:184-187` (update: `list_id`/`parent_task_id` written raw). FK validates existence but not
  ownership. A task can be moved to a list the actor doesn't own, making the task invisible
  (it exists but RLS hides it on the foreign list).
- **#166 — foundation integration test share persists across suite:**
  `tests/integration/foundation.test.ts` ≈ line 220 creates a share with a self-incriminating
  comment ("this share persists for the remainder of the suite (no teardown)"). This pollutes
  subsequent tests in the suite and masks isolation failures.

---

## Fix design

### #170 — Add missing tables to user data export

**Location:** `scripts/export-user-data.ts`.

Add the five missing tables. `app.chat_memory_facts` exists — confirmed at
`packages/memory/sql/0041_memory_facts.sql:4` — remove the "if this table exists" hedge.

**Tables to add:**

1. **`app.memory_chunks`** — export `id`, `source_kind`, `source_path`, `line_start`, `line_end`,
   `text`. Filter `WHERE owner_user_id = $userId`. **Do not export** `embedding` (vector blob,
   derived, large) or `content_hash`/`file_hash`.

2. **`app.chat_memory_facts`** — export all non-derived columns. Filter by `owner_user_id`.
   Do not export `embedding` if it exists.

3. **`app.commitments`** — export all user-visible columns. Filter by `owner_user_id`.

4. **`app.entities`** — export all user-visible columns. Filter by `owner_user_id`.

5. **`app.preferences`** — export all columns. Filter by `owner_user_id`.

**Pattern to follow:** the existing `connectorAccountsQuery` and `aiProviderConfigsQuery`
functions show how to structure owner-filtered export queries with sensitive field redaction.

**Tests:** Extend `tests/integration/release-hardening.test.ts` (lines 44–80 cover existing
export assertions) with new assertions for each of the five added sections:

- Output JSON contains `memoryChunks`, `chatMemoryFacts`, `commitments`, `entities`, `preferences` keys
- Negative assertions: no `embedding` key appears in any chunk row
- Negative assertions: no `content_hash` key appears

Do not rely solely on a manual `pnpm export:user` run — add automated assertions to the
release-hardening suite so the gate catches regressions.

### #149 — Fix `handleRouteError` in notifications

**Location:** `packages/notifications/src/routes.ts:111-117`.

**Current:**

```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message.includes("Session")) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  return reply.code(401).send({ error: "Session is missing or expired" }); // dead, always 401
}
```

**Fix:**

```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message === "Session is missing or expired") {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  if (error instanceof Error && error.message === "Invalid bearer token") {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  // Unexpected errors: log and return generic 500
  throw error; // let Fastify's default handler log it and return 500
}
```

Use exact-match `===` (not `includes`) for both auth-error messages — every sibling module
(`packages/tasks/src/routes.ts:606-608`, `packages/chat`, `packages/ai`, etc.) uses exact-match.
The `"Invalid bearer token"` branch is essential: `resolveAccessContext` throws it for invalid
tokens, and losing that → 500 would break auth signaling for all three notifications routes.

Re-throwing unexpected errors (rather than `reply.code(500)`) matches house style in
`packages/briefings/src/routes.ts:411` and other modules.

Also review `packages/chat/src/routes.ts:271` (`handleRouteError` there) — fix the same
dead-branch pattern in the same PR if present.

### #140 — Ownership check for listId and parentTaskId

**Location:** `packages/tasks/src/repository.ts`.

**Create path (≈ lines 95–127):**

Before assigning `listId`, verify the actor owns that list:

```typescript
if (input.listId) {
  const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
  if (!owned) throw new HttpError(404, "List not found or not accessible");
}
```

Before assigning `parentTaskId`, verify the **actor owns** the parent task (not just visibility):

```typescript
if (input.parentTaskId) {
  const parentOwned = await scopedDb.db
    .selectFrom("app.tasks")
    .select("id")
    .where("id", "=", input.parentTaskId)
    .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
    .executeTakeFirst();
  if (!parentOwned) throw new HttpError(404, "Parent task not found or not accessible");
}
```

**Why ownership not visibility for parent:** `app.tasks` RLS is owner-OR-share (`0019_tasks_owner_or_share.sql:12-22`). A task merely view-shared to the actor passes a plain `getById` check, allowing the actor to parent their task under another user's task. Subsequent calls (`maybeAutoCloseParent`) would then write `task_activity` rows on the foreign parent. Require `owner_user_id = current_actor_user_id()` explicitly.

**Update path (≈ lines 184–187):**
Same checks: if `input.listId` changes, verify ownership. If `input.parentTaskId` changes,
verify ownership (not visibility).

**`isOwnedByActor` method to add in `packages/tasks/src/lists.ts`** (class `TaskListsRepository`):

```typescript
async isOwnedByActor(scopedDb: DataContextDb, listId: string): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.task_lists")
    .select("id")
    .where("id", "=", listId)
    .executeTakeFirst();
  return !!row;   // RLS is owner-only (0039_tasks_foundation.sql:143-146); row present = owned
}
```

**Error → HTTP mapping:** tasks routes have a local `HttpError` class (declared at
`packages/tasks/src/routes.ts:612-619`). The repository cannot throw it directly (it would
create a circular dep or force an import from routes). Options — pick one:

1. Move `HttpError` to `packages/tasks/src/errors.ts` and import it in both repository and routes.
2. Throw a plain `Error` with a specific message (e.g., `"List not found or not accessible"`),
   then add a message-match branch in `handleRouteError` (routes.ts:598-610) mapping it to 404.

Specify in the PR which approach is used. The acceptance test must assert HTTP 404 (not 500).

**Residual (explicitly accepted):** a manage-share grantee updating a task they manage can move
it to one of their own lists. This is accepted behavior for manage-share level; the spec does
not restrict it.

### #166 — Fix share persistence in foundation integration test

**Location:** `tests/integration/foundation.test.ts` ≈ line 220 (the share creation with the
self-incriminating comment).

**Do NOT use a blanket `afterEach` cleanup** — a downstream test at ≈ line 257 ('allows access
through an app.shares view grant') depends on a `beforeAll`-seeded share for `itemBGrantedToA`.
A blanket `cleanupShares(testDb, testActorUserId)` would delete that seeded share.

**Correct fix:** at the end of the specific test (or in a targeted `afterAll` scoped to that
test), delete only the specific share row that test creates:

```typescript
// After the test that creates the dangling share:
afterAll(async () => {
  await testDb
    .deleteFrom("app.shares")
    .where("resource_type", "=", "rls_probe_item")
    .where("resource_id", "=", itemAOwnPrivate)
    .where("grantee_user_id", "=", userB)
    .execute();
});
```

Adjust `resource_type`/`resource_id`/`grantee_user_id` to match the actual row.

**Acceptance:** add an in-suite assertion immediately after the cleanup — verify that the
downstream test (`allows access through an app.shares view grant`) still passes (proves the
seeded share was not deleted). A "run twice" check is insufficient because each run reseeds.

---

## Hard invariants

- **Export must not include secrets or derived data.** Do not export `embedding`, `content_hash`,
  `file_hash`, or any `*_key`/`*_secret`/`*_token`/`*_credential` column.
- **`handleRouteError` 500 must not leak internal error details.** Re-throw and let Fastify
  handle logging; return only the generic Fastify error JSON to the client.
- **RLS for ownership checks.** The `isOwnedByActor` list check relies on RLS (`task_lists` is
  owner-only). Must be called inside a `withDataContext` context. The parent-task ownership check
  uses an explicit `owner_user_id = app.current_actor_user_id()` predicate — not `getById`.
- **Both create and update paths guard listId and parentTaskId.** The vulnerability exists on
  both paths; partial fix is insufficient.

---

## Tests

- **`pnpm verify:foundation`** green. `pnpm test:integration` green.
- **Export completeness:** `tests/integration/release-hardening.test.ts` must assert each of the
  five new table sections is present in export output, with redaction checks for `embedding` and
  `content_hash`.
- **Notifications 500:** trigger an unexpected error on a notification route (e.g., forced throw);
  verify the response is a 500 (not 401). Also verify that an invalid-token request still returns 401.
- **Task list ownership (create and update):** attempt to create a task with a `listId` belonging
  to another user → expect 404, not silent success. Attempt to create with a `parentTaskId` belonging
  to another user → expect 404. Repeat for update path.
- **Foundation test isolation:** after the #166 fix, a following test that depends on the seeded
  share (`itemBGrantedToA`) still passes within the same `pnpm test:integration` run.

---

## Out of scope

- GDPR deletion or data-portability endpoint (only the export script is in scope).
- Adding `app.shares`, `app.task_lists`, `app.task_tags` to the export, or refreshing `tasksQuery`
  columns — tracked as follow-up. The out-of-scope rationale in this spec is "known-incomplete,
  deferred to a follow-up issue" not "those tables contain no personal data."
- Refactoring `handleRouteError` into a shared utility.
- Task list management UI changes.
