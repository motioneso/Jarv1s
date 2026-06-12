# Spec: Audit Slice I — Portability + Observability Tail

**Date:** 2026-06-12
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
  `scripts/export-user-data.ts` maintains an explicit 19-table allowlist. Missing from it:
  `app.memory_chunks`, `app.chat_memory_facts`, `app.commitments`, `app.entities`,
  `app.preferences`. These are core personal data tables (episodic memory, structured notes,
  user commitments). A GDPR-style data export that omits them is incomplete. This is the only
  Tier-3 item with direct end-user privacy impact.
- **#149 — `handleRouteError` always returns 401:**
  `packages/notifications/src/routes.ts:111-117` has a dead conditional — both branches of an
  `if` block send `401 Session is missing or expired`. The second branch is unreachable. Any
  unexpected error (5xx, data error, DB timeout) is masked as a 401 auth failure. This hides
  bugs and breaks monitoring.
- **#140 — no list/parent-task ownership check on task create/update:**
  `packages/tasks/src/repository.ts:96` (create: `input.listId` taken raw),
  `:184-187` (update: `list_id`/`parent_task_id` written raw). FK validates existence but not
  ownership. A task can be moved to a list the actor doesn't own, making the task invisible
  (it exists but RLS hides it on the foreign list). Severity: MED/integrity, not an IDOR read
  leak (the issue itself states this).
- **#166 — foundation integration test share persists across suite:**
  `tests/integration/foundation.test.ts:214-217` creates a share with a self-incriminating
  comment ("this share persists for the remainder of the suite (no teardown)"). This is test
  hygiene with zero production exposure but it pollutes subsequent tests in the suite and
  masks isolation failures.

---

## Fix design

### #170 — Add missing tables to user data export

**Location:** `scripts/export-user-data.ts`.

The export function reads from an explicit allowlist. Add the five missing tables and their
appropriate columns/serialization.

**Tables to add:**

1. **`app.memory_chunks`** — export `id`, `source_kind`, `source_path`, `line_start`, `line_end`,
   `text` (no embeddings — they are derived and large). Filter `WHERE owner_user_id = $userId`.

2. **`app.chat_memory_facts`** — if this table exists (confirm schema), export all non-derived
   columns. Filter by owner.

3. **`app.commitments`** — export all user-visible columns. Filter by `owner_user_id`.

4. **`app.entities`** — export all user-visible columns. Filter by `owner_user_id`.

5. **`app.preferences`** — export all columns. Filter by `owner_user_id`.

**Do not export:** vector embedding columns (`embedding`), internal hash columns
(`content_hash`, `file_hash`), or any column that is purely derived/internal. Treat these the
same way connector secrets are handled: include a boolean `hasFoo` rather than the value if
the column is opaque internal data.

**Pattern to follow:** the existing `connectorAccountsQuery` and `aiProviderConfigsQuery`
functions show how to structure owner-filtered export queries with sensitive field redaction.

### #149 — Fix `handleRouteError` dead branch in notifications

**Location:** `packages/notifications/src/routes.ts:111-117`.

**Current:**
```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message.includes("Session")) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  return reply.code(401).send({ error: "Session is missing or expired" });  // dead, always 401
}
```

**Fix:**
```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message.includes("Session")) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  // Unexpected errors: log server-side, return generic 500
  console.error("Unhandled notifications route error:", error);
  return reply.code(500).send({ error: "Internal server error" });
}
```

This matches the pattern used in `packages/briefings/src/routes.ts:390-416` (which properly
distinguishes auth errors from unexpected errors). Use whatever logger is available in the
package; fall back to `console.error` if no structured logger is wired.

Also review whether the same dead-branch pattern exists in `packages/chat/src/routes.ts:271`
(`handleRouteError` there) — fix it in the same PR if so.

### #140 — Ownership check for listId and parentTaskId on task create/update

**Location:** `packages/tasks/src/repository.ts`.

**Create path (≈ line 95-96):**
```typescript
const listId = input.listId ?? (await this.listsRepository.getOrCreateDefault(scopedDb)).id;
```

Before assigning `listId`, verify the actor owns that list:
```typescript
if (input.listId) {
  const owned = await this.listsRepository.isOwnedByActor(scopedDb, input.listId);
  if (!owned) throw new Error("List not found or not accessible");
}
```

**Update path (≈ lines 184-187):**
Same check: if `input.listId` is being changed, verify the target list is owned by the actor.

**`parentTaskId` check (≈ line 186):**
If `parentTaskId` is being set, verify the parent task is visible to the actor (use an
existence check via `getById` which is already owner-scoped via RLS).

**`isOwnedByActor` method to add in `packages/tasks/src/lists-repository.ts`** (or wherever
`TaskListRepository` lives):
```typescript
async isOwnedByActor(scopedDb: DataContextDb, listId: string): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb
    .selectFrom("app.task_lists")
    .select("id")
    .where("id", "=", listId)
    .executeTakeFirst();
  return !!row;   // RLS already filters to actor's lists
}
```

Since `app.task_lists` has owner-scoped RLS, a SELECT that returns a row means the actor owns
it. No explicit `owner_user_id = actor` check needed at the app layer — RLS handles it.

### #166 — Fix share persistence in foundation integration test

**Location:** `tests/integration/foundation.test.ts:214-217`.

Add a teardown in the test or `afterEach`/`afterAll` block to delete the share created in
that test. Alternatively, create the share inside a test-scoped transaction that is rolled
back after the test. The specific pattern depends on how the foundation test suite manages
DB state — follow the existing teardown conventions in the file.

If the test creates a share and downstream tests expect it to be absent, the simplest fix is:

```typescript
afterEach(async () => {
  await cleanupShares(testDb, testActorUserId);
});
```

Where `cleanupShares` deletes shares created by the test actor. This ensures test isolation
without rewriting the test structure.

---

## Hard invariants

- **Export must not include secrets.** `app.memory_chunks` `text` column is user content (safe).
  Do not export `embedding` (vector blob — useless and large). Do not export any column named
  `*_key`, `*_secret`, `*_token`, `*_credential`, or `*_hash`.
- **Secrets never escape** (CLAUDE.md hard invariant #5). The export additions must follow the
  same redaction pattern as connector/AI config exports (boolean `hasSecret`, not the secret).
- **`handleRouteError` 500 must not leak internal error details** to the response body. Log
  the full error server-side; return only `"Internal server error"` to the client.
- **RLS for ownership checks.** The `isOwnedByActor` list check relies on RLS to scope the
  query. It must be called inside a `withDataContext` context (the repository already requires
  `DataContextDb`), so the GUC is set. No raw `owner_user_id =` app-layer filter needed.

---

## Tests

- **`pnpm verify:foundation`** green. `pnpm test:integration` green.
- **Export completeness:** run `pnpm export:user -- --user-id <test-user>` and verify the
  output JSON contains `memoryChunks`, `commitments`, `entities`, `preferences` sections.
  Verify no `embedding` column appears.
- **Notifications 500:** trigger an unexpected error on a notification route (e.g., DB down
  or forced throw); verify the response is `500 Internal server error`, not `401`.
- **Task list ownership:** attempt to create a task with a `listId` belonging to another user;
  verify the request returns a 404/403, not a silent success.
- **Foundation test isolation:** run `pnpm test:integration` twice in sequence; verify the
  second run does not fail due to share state leaked from the first.

---

## Out of scope

- GDPR deletion or data-portability endpoint (only the export script is in scope).
- Full export UI or scheduled-export feature.
- Adding missing tables beyond the five listed (other tables are either already exported or
  do not contain personal data).
- Refactoring `handleRouteError` into a shared utility (clean, but not required for this fix).
- Task list management UI changes.
