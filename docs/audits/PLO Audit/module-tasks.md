# Tasks Module — Thermo-Nuclear Code Quality Audit

**Module:** `packages/tasks`
**Reviewed:** 2026-06-10
**Files reviewed:**
- `packages/tasks/src/breakdown.ts`
- `packages/tasks/src/drift.ts`
- `packages/tasks/src/index.ts`
- `packages/tasks/src/jobs.ts`
- `packages/tasks/src/lists.ts`
- `packages/tasks/src/manifest.ts`
- `packages/tasks/src/preferences.ts`
- `packages/tasks/src/recurrence.ts`
- `packages/tasks/src/repository.ts`
- `packages/tasks/src/routes.ts`
- `packages/tasks/src/serialize.ts`
- `packages/tasks/src/tools.ts`
- `packages/tasks/sql/0003_tasks_module.sql`
- `packages/tasks/sql/0019_tasks_owner_or_share.sql`
- `packages/tasks/sql/0039_tasks_foundation.sql`
- `tests/integration/tasks.test.ts`
- `tests/integration/tasks-tools.test.ts`
- `tests/integration/tasks-view.test.ts`
- `tests/integration/tasks-web-contract.test.ts`

---

## Summary

The tasks module is broadly well-structured. RLS is enabled with FORCE on every table, the DataContextDb invariant is respected, AccessContext shape is correct, and job payloads are metadata-only. The critical and high findings below are real functional gaps, not stylistic preferences.

---

## Findings

### [HIGH] `contribute` grant level advertised but functionally inert — view-only in practice

- **File:** `packages/tasks/sql/0019_tasks_owner_or_share.sql:41–48`, `packages/tasks/src/manifest.ts:229–231`
- **Category:** Security / Architecture
- **Finding:** The manifest declares `grantLevels: ["view", "contribute", "manage"]` for shareable tasks. The `has_share` function uses a rank system: view=1, contribute=2, manage=3. The tasks UPDATE policy checks `has_share('task', id, 'manage')` (rank >= 3). A user granted `contribute` (rank 2) passes SELECT (view policy checks rank >= 1) but fails UPDATE (manage policy requires rank >= 3). The `contribute` level is silently treated as view-only — users granted it cannot update or comment on tasks they expect to be able to contribute to.
- **Evidence:**
  ```sql
  -- 0019: tasks_update only checks 'manage'
  OR app.has_share('task', id, 'manage')
  ```
  ```ts
  // manifest.ts:229
  grantLevels: ["view", "contribute", "manage"]
  ```
- **Impact:** Users who receive a `contribute` share see the task but cannot act on it. Callers granting `contribute` believe they are granting write access; they are not. This is a semantic contract violation.
- **Recommendation:** Either (a) update the tasks UPDATE policy to `has_share('task', id, 'contribute')` (rank >= 2) to honour the contribute level, or (b) remove `"contribute"` from `grantLevels` if tasks intentionally support only view/manage sharing. Decision requires an explicit design choice; the current state is inconsistent.

---

### [HIGH] `task_activity_insert` policy allows any view-share grantee to add activity records

- **File:** `packages/tasks/sql/0003_tasks_module.sql:161–173`
- **Category:** Security
- **Finding:** The `task_activity_insert` RLS policy allows INSERT when the actor can see the parent task (`EXISTS (SELECT 1 FROM app.tasks parent_task WHERE parent_task.id = task_id)`). Because `app.tasks` has FORCE RLS, this inner query is filtered by the task SELECT policy — which grants access to `view`-level grantees. A user with only `view` share can therefore insert comments/activity on another user's task. The `POST /api/tasks/:id/activity` route also carries `permissionId: "tasks.update"` in the manifest, but that is a system-level permission check, not a per-resource check, so it does not prevent this.
- **Evidence:**
  ```sql
  CREATE POLICY task_activity_insert ON app.task_activity
  FOR INSERT TO jarvis_app_runtime, jarvis_worker_runtime
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND actor_user_id = app.current_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM app.tasks parent_task WHERE parent_task.id = task_id
    )  -- view-level share satisfies this EXISTS
  );
  ```
- **Impact:** A user with view-only access to a shared task can annotate it with arbitrary activity records (comments, status_changed entries, etc.). The owner sees foreign annotations they cannot distinguish from legitimate system activity.
- **Recommendation:** Tighten the insert policy to require update-level access: change the EXISTS to also check `has_share('task', task_id, 'contribute')` (or `'manage'`), or add an owner check: `AND EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id AND (t.owner_user_id = app.current_actor_user_id() OR app.has_share('task', t.id, 'contribute')))`.

---

### [HIGH] `POST /api/tasks/:id/activity` does not validate task visibility before inserting — wrong error on invisible task

- **File:** `packages/tasks/src/routes.ts:223–239`
- **Category:** Security / Error Handling
- **Finding:** The activity creation route calls `repository.addActivity(scopedDb, request.params.id, input)` without first checking whether the task exists or is visible to the actor. If the task does not exist or is not visible, the `executeTakeFirstOrThrow()` call in `addActivity` causes Postgres to raise an RLS policy violation ("new row violates row-level security policy"), which surfaces as an unhandled DB error. `handleRouteError` re-throws non-`HttpError` errors as-is, resulting in a 500 response with a Postgres error message in the body. This leaks DB internals and also distinguishes "task not found" from "task not accessible" differently than other routes (which return 404).
- **Evidence:**
  ```ts
  // routes.ts:230 — no prior getById check
  const activity = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
    repository.addActivity(scopedDb, request.params.id, input)
  );
  // addActivity uses executeTakeFirstOrThrow — throws on RLS violation
  ```
- **Impact:** 500 with DB error text is returned for attempts to add activity to invisible tasks, instead of 404. This leaks schema/policy details and is inconsistent with other routes.
- **Recommendation:** Perform a `getById` check before `addActivity`, as the deferred-status route already does (lines 248–255). Return 404 if null. This is the established pattern in the same file.

---

### [HIGH] Cascade-close of a recurring child task silently skips `generateNext`

- **File:** `packages/tasks/src/repository.ts:251–266`
- **Category:** Architecture / Code Quality
- **Finding:** `cascadeCloseChildren` issues bare `updateTable` SQL directly to close children, bypassing the `update()` method. The `update()` method is the only place where `generateNext` is called for recurring tasks. The DB trigger (`tasks_hierarchy_guard`) prevents a recurring task from being a parent, but it does not prevent a child task from having recurrence set. If a child task is recurring, and its parent is closed, `cascadeCloseChildren` closes the child without triggering `generateNext`. The recurring series silently terminates.
- **Evidence:**
  ```ts
  // repository.ts:252–260 — direct DB update, no call to generateNext
  for (const child of openChildren) {
    await scopedDb.db
      .updateTable("app.tasks")
      .set({ status: parentStatus, ... })
      .where("id", "=", child.id)
      .execute();
    // No generateNext call here
  }
  ```
- **Impact:** A recurring child task whose parent is completed will never generate its next occurrence. The user's recurring task silently disappears with no indication. There are no tests for this case.
- **Recommendation:** Either (a) prevent child tasks from having recurrence set (add a DB constraint or trigger clause: `IF NEW.parent_task_id IS NOT NULL AND NEW.recurrence IS NOT NULL THEN RAISE EXCEPTION`), or (b) call `generateNext` inside `cascadeCloseChildren` for each child that has recurrence set. Option (a) is simpler and eliminates an ambiguous feature combination.

---

### [MEDIUM] `in_progress` retained in DB enum but removed from TypeScript types — type/schema drift

- **File:** `packages/tasks/sql/0003_tasks_module.sql:9`, `packages/db/src/types.ts:143`
- **Category:** Architecture / TypeScript
- **Finding:** The Postgres `app.task_status` ENUM still includes `'in_progress'` (created in migration 0003). Migration 0039 backfills existing `in_progress` rows to `todo`. However, the ENUM value is never dropped from Postgres. The TypeScript `TaskStatus` type (`"todo" | "done" | "archived"`) does not include `in_progress`. This creates permanent drift: the DB type allows a value that the application types do not.
- **Evidence:**
  ```sql
  -- 0003_tasks_module.sql:9
  CREATE TYPE app.task_status AS ENUM ('todo', 'in_progress', 'done', 'archived');
  -- 0039_tasks_foundation.sql:66
  UPDATE app.tasks SET status = 'todo' WHERE status = 'in_progress';
  -- (no ALTER TYPE ... DROP VALUE)
  ```
  ```ts
  // packages/db/src/types.ts:143
  export type TaskStatus = "todo" | "done" | "archived";
  ```
- **Impact:** A future developer, superuser script, or migration bug could insert `in_progress` into the DB without any TypeScript compile error at the column-value level. The enum divergence will confuse future contributors. PostgreSQL does not support `DROP VALUE` on enums, but a new migration could rename/replace the type.
- **Recommendation:** Add a migration that replaces the `app.task_status` ENUM with a `text NOT NULL CHECK (status IN ('todo','done','archived'))` constraint (or a new enum without `in_progress`), keeping the change fully backwards-compatible. Alternatively, document the divergence explicitly and add a DB-level constraint excluding `in_progress`.

---

### [MEDIUM] `cascadeCloseChildren` is a sequential N+1 loop — not batched

- **File:** `packages/tasks/src/repository.ts:251–267`
- **Category:** Code Quality / Architecture
- **Finding:** `cascadeCloseChildren` iterates over open children and issues one `UPDATE` + one `INSERT` (activity) per child in sequence. A parent task with many subtasks triggers 2N round-trips inside a single transaction. This could cause lock contention and latency spikes. The entire `update()` call runs inside a Kysely transaction (`withDataContext` wraps in a transaction), so atomicity is not the issue — only performance.
- **Evidence:**
  ```ts
  for (const child of openChildren) {
    await scopedDb.db.updateTable("app.tasks")...execute();
    await this.addActivity(scopedDb, child.id, ...);
  }
  ```
- **Impact:** Closing a parent with N children issues 2N sequential DB round-trips. At the one-level max allowed by the hierarchy invariant this is bounded, but still O(N) where N = subtask count.
- **Recommendation:** Batch the status updates: one `UPDATE app.tasks SET status=... WHERE parent_task_id = $1 AND status != $2` bulk update. For activity records, batch insert with `INSERT INTO app.task_activity ... VALUES ... ON CONFLICT DO NOTHING`. This collapses 2N round-trips to 2.

---

### [MEDIUM] `idempotencyKey` payload field is accepted, stored, and never used

- **File:** `packages/tasks/src/jobs.ts:16`, `packages/tasks/src/routes.ts:261`, `packages/tasks/src/routes.ts:270`
- **Category:** Code Quality / Payloads
- **Finding:** `DeferredTaskStatusPayload` includes an optional `idempotencyKey`. The route parses it, adds it to the payload, and the worker receives it — but neither the route nor the worker uses it for any deduplication or pg-boss `singletonKey` logic. `boss.send` is called without a `singletonKey`. The field is dead functionality.
- **Evidence:**
  ```ts
  // routes.ts:270 — no singletonKey passed
  const jobId = await dependencies.boss.send(TASKS_DEFERRED_STATUS_QUEUE, payload);
  ```
  ```ts
  // jobs.ts — worker never reads job.data.idempotencyKey
  const result = { taskId: job.data.taskId, updated: task !== undefined, status: task?.status ?? null };
  ```
- **Impact:** Callers who pass `idempotencyKey` believing it will deduplicate concurrent status updates get no such guarantee. The field clutters the payload type and creates false API expectations.
- **Recommendation:** Either implement deduplication using `boss.send(queue, payload, { singletonKey: payload.idempotencyKey })` when the key is present, or remove the field from the type, route parser, and payload schema entirely. If future deduplication is planned, leave a code comment and a TODO issue rather than dead wire.

---

### [MEDIUM] `ownedTables` in manifest is incomplete — missing four tables

- **File:** `packages/tasks/src/manifest.ts:65`
- **Category:** Architecture
- **Finding:** `ownedTables` lists only `["app.tasks", "app.task_activity"]` but the tasks module also owns `app.task_lists`, `app.task_tags`, `app.task_tag_assignments`, and `app.task_preferences`, all created in migration 0039.
- **Evidence:**
  ```ts
  // manifest.ts:65
  ownedTables: ["app.tasks", "app.task_activity"]
  ```
- **Impact:** Module-level ownership tracking is incorrect. If the module registry or any tooling uses `ownedTables` to gate cleanup, schema inspection, or conflict detection, the four undeclared tables will be ignored. This is a consistency violation even if not currently enforced.
- **Recommendation:** Update `ownedTables` to include all six tables:
  ```ts
  ownedTables: [
    "app.tasks", "app.task_activity",
    "app.task_lists", "app.task_tags",
    "app.task_tag_assignments", "app.task_preferences"
  ]
  ```

---

### [MEDIUM] `preferences.getOrCreate` has an unbounded recursion path

- **File:** `packages/tasks/src/preferences.ts:19`
- **Category:** Error Handling / Code Quality
- **Finding:** `getOrCreate` recursively calls `this.getOrCreate(db)` when the INSERT returns no row (lost concurrent race). This is the standard "select → insert → re-select" pattern, but the recursive self-call has no depth guard. If the database consistently returns no row from the INSERT (e.g., due to a persistent RLS violation or constraint the code did not anticipate), this will recurse until stack overflow.
- **Evidence:**
  ```ts
  return inserted ?? this.getOrCreate(db);
  ```
- **Impact:** In the normal concurrent-insert race case this executes at most twice and is safe. However, a persistent DB condition (e.g., RLS policy mismatch that prevents both insert and re-select) causes infinite recursion. This is a reliability concern, not a theoretical one, because the RLS policy for `task_preferences` could change.
- **Recommendation:** Replace the recursive call with a direct re-select (no recursion) and throw an explicit error if the re-select also returns nothing. This matches the three-step pattern in `TaskListsRepository.getOrCreate` (lists.ts) which already follows this safer approach.

---

### [MEDIUM] `recurrence` object accepted as arbitrary JSON — no structural validation at route layer

- **File:** `packages/tasks/src/routes.ts:516–524`, `packages/shared/src/tasks-api.ts:211`
- **Category:** Code Quality / TypeScript
- **Finding:** The route body parser accepts `recurrence` as `anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]` — any JSON object passes. The recurrence logic in `recurrence.ts` reads `spec.freq`, `spec.interval`, and `spec.occurrence_date` with only a falsy guard (`!spec.freq || !spec.interval || !spec.occurrence_date`). An interval of `0` passes the falsy check (0 is falsy) and would cause `computeNextOccurrenceDate` to return the same date as the input occurrence_date, creating a degenerate recurring series. Negative intervals cause the series to go backwards in time. An invalid `freq` value falls through the `switch` without advancing the date, again producing the same date.
- **Evidence:**
  ```ts
  // recurrence.ts:79 — 0 fails the falsy check, but negative doesn't
  if (!spec.freq || !spec.interval || !spec.occurrence_date) { return null; }
  // routes.ts — no validation of recurrence shape
  function optionalRecurrence(value: unknown): Record<string, unknown> | null | undefined {
    if (typeof value !== "object" || Array.isArray(value)) throw ...;
    return value as Record<string, unknown>;
  }
  ```
- **Impact:** A client can send `{ freq: "invalid", interval: -7, occurrence_date: "2026-01-01" }` and the recurring task will either fail to advance its occurrence (creating infinite identical occurrences, caught by the unique index) or advance backwards. The unique index prevents duplicate dates, but the error message is opaque to the caller.
- **Recommendation:** Add explicit validation in `optionalRecurrence` or in `repository.create`: check `freq` is one of `daily|weekly|monthly`, `interval` is a positive integer, and `occurrence_date` is a valid `YYYY-MM-DD` string. Return 400 on invalid input rather than letting it propagate to the DB.

---

### [LOW] `serializeDate` helper is duplicated across four packages

- **File:** `packages/tasks/src/serialize.ts:10`, `packages/ai/src/routes.ts:744`, `packages/connectors/src/routes.ts:371`, `packages/settings/src/routes.ts:510`
- **Category:** Code Quality
- **Finding:** Four separate implementations of `serializeDate(value: Date | string | null | undefined): string | null | undefined` exist across packages. The tasks version is the most complete (handles null), the others are slightly different variants.
- **Evidence:**
  ```
  packages/tasks/src/serialize.ts:10
  packages/ai/src/routes.ts:744
  packages/connectors/src/routes.ts:371
  packages/settings/src/routes.ts:510
  ```
- **Impact:** Discrepancies between the implementations (null handling, undefined handling) will produce inconsistent API responses. New packages will re-implement it again.
- **Recommendation:** Extract `serializeDate` (the tasks variant, which handles null) into `@jarv1s/shared` or `@jarv1s/db`, delete the per-package copies, and import from the canonical location.

---

### [LOW] `getQuadrant` / quadrant logic is duplicated between backend and shared package

- **File:** `packages/tasks/src/serialize.ts:17`, `packages/shared/src/tasks-view.ts:37–38`
- **Category:** Code Quality
- **Finding:** `getQuadrant` (backend) and `quadrantOf` (frontend, in `@jarv1s/shared`) implement the same Eisenhower matrix classification with the comment explicitly noting the duplication ("Mirrors backend serialize.ts getQuadrant"). Any change to the classification logic must be applied in both places.
- **Evidence:**
  ```ts
  // shared/src/tasks-view.ts:37
  /** Mirrors backend serialize.ts getQuadrant: important = priority>=4; urgent = due within 48h (incl. overdue). */
  export function quadrantOf(task: TaskDto): TaskQuadrant {
  ```
- **Impact:** The two implementations can drift if one is updated without the other. Tests exist for both independently, but no cross-verification.
- **Recommendation:** The backend `filterByQuadrant` helper in `serialize.ts` could delegate to the shared `quadrantOf` if `@jarv1s/shared` is already a dependency. Alternatively, accept the duplication with a shared unit test that runs both implementations against the same fixtures.

---

### [LOW] `isDeferredTaskStatusPayloadMetadataOnly` guard in routes.ts is belt-over-suspenders on a statically typed object

- **File:** `packages/tasks/src/routes.ts:264–268`
- **Category:** Code Quality / TypeScript
- **Finding:** The payload variable at line 257 is constructed as a literal `DeferredTaskStatusPayload` — a statically typed object with exactly four known fields. The metadata check immediately after casts it to `unknown as Record<string, unknown>` and re-validates the keys. The cast is unnecessary because the object has no excess keys that TypeScript would not already have rejected. This pattern adds noise and slightly misleads readers into thinking dynamic construction of the payload is happening.
- **Evidence:**
  ```ts
  const payload: DeferredTaskStatusPayload = { actorUserId, taskId, requestedStatus, idempotencyKey };
  if (!isDeferredTaskStatusPayloadMetadataOnly(payload as unknown as Record<string, unknown>)) {
    throw new HttpError(500, "...");
  }
  ```
- **Impact:** None at runtime; the check always passes. The double-cast reduces readability and could mislead reviewers.
- **Recommendation:** Remove the runtime metadata check from the route (the check is already present in the worker as a defence-in-depth guard). If the check is kept, remove the cast by accepting `DeferredTaskStatusPayload` directly in the function signature.

---

### [LOW] Cross-user tag access not tested at the API level

- **File:** `tests/integration/tasks.test.ts`
- **Category:** Tests
- **Finding:** The `GET /api/tasks/lists/:listId/tags` and `POST /api/tasks/lists/:listId/tags` routes are tested only for the owning user. There is no test verifying that User B cannot access User A's list tags by supplying User A's `listId` directly. The `task_tags_rw` RLS policy uses `owner_user_id = app.current_actor_user_id()`, so tags from other lists are filtered — but this is not verified by any integration test.
- **Impact:** If the RLS policy were accidentally weakened, the gap would go undetected until a security review or production incident.
- **Recommendation:** Add a test: User B calls `GET /api/tasks/lists/:listId/tags` using User A's `listId`. Expected: empty array (no tags visible, not a 404 or 403, because the list itself is not visible either and the query simply returns nothing).

---

### [LOW] Missing test coverage for recurring child task cascade-close

- **File:** `tests/integration/tasks.test.ts`
- **Category:** Tests
- **Finding:** No test covers the case where a child task has `recurrence` set and the parent is closed. This is the scenario documented in the HIGH finding above (cascade silently skips `generateNext`). Even if the behavior is considered acceptable (recurring children are not supported), the DB should enforce this constraint and the test should verify rejection.
- **Impact:** The behavioral gap in `cascadeCloseChildren` is undetected by the test suite.
- **Recommendation:** Add a test that either (a) verifies that assigning recurrence to a child task is rejected at the DB level, or (b) verifies that completing the parent correctly generates the next instance for a recurring child (once the fix is implemented).

---

### [INFO] `has_resource_grant_level` function created in migration 0003 is dead code after migration 0019

- **File:** `packages/tasks/sql/0003_tasks_module.sql:45–66`, `packages/tasks/sql/0019_tasks_owner_or_share.sql`
- **Category:** Code Quality
- **Finding:** Migration 0003 creates `app.has_resource_grant_level()`. Migration 0019 replaces all task RLS policies that used it with `app.has_share()`. The function remains in the DB schema but is no longer referenced in any active policy, application code, or migration.
- **Impact:** Dead function in the DB schema adds confusion. A future developer might attempt to use it believing it is canonical.
- **Recommendation:** Add a migration that drops `app.has_resource_grant_level()` if it is not used by any other module. Verify with `SELECT ... FROM pg_depend` before dropping.

---

### [INFO] Barrel `index.ts` exports all internals — no public API surface distinction

- **File:** `packages/tasks/src/index.ts`
- **Category:** Architecture
- **Finding:** `index.ts` re-exports everything from all source files with `export * from`, including route-layer helpers (`filterByQuadrant`, `getQuadrant`, `serializeDate`, `serializeTask*`), tool execute functions, and repository classes. Other modules consuming `@jarv1s/tasks` can import any of these. The intended public API (for use by tests and the app's module registration) is a subset of the total exports.
- **Impact:** Not a hard invariant violation, but it means the module's public contract is larger than intended. Internal helpers can be imported and relied upon by external consumers, making future refactors harder.
- **Recommendation:** Consider splitting `index.ts` into a smaller public API (manifest, route registrar, job worker registrar, queue constants) and keep repository classes for test use only. This is a low-priority refactor.

---

## Module Invariants Verification

| Invariant | Status | Notes |
|---|---|---|
| No admin bypass / BYPASSRLS | PASS | No BYPASSRLS on any runtime role. |
| Private by default | PASS | All tables have FORCE RLS. Owner-only default. |
| DataContextDb only | PASS | All repos call `assertDataContextDb`. |
| AccessContext shape | PASS | No workspaceId usage anywhere. |
| Secrets never escape | PASS | No secret fields in TaskDto or payloads. |
| Metadata-only job payloads | PASS | Payload contains IDs and status only. |
| Provider-agnostic AI | N/A | No AI provider calls in this module. |
| Module isolation | PASS | No imports of other module internals. |
| pgvector image | N/A | No Docker config in this module. |
| Never edit applied migrations | PASS | No edits detected. |
| One-level hierarchy enforced | PASS | DB trigger `tasks_hierarchy_guard` enforced. |
| RLS on tasks table | PASS | ENABLE + FORCE on all six tables. |
| Task isolation (actor-scoped) | PASS | All queries scoped via RLS + DataContextDb. |
