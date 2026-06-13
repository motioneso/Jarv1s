# Phase 3 — Task Verticals Finished: Recurrence Scheduling, Tag Assignment, List/Tag Rename + Delete

**Status:** Draft for build (overnight implementation plan)
**Date:** 2026-06-13
**Owner:** Ben
**Epic:** #48 (Phase 3 · Core Value — Real Briefings), exit criterion #3 — "Task verticals
finished: recurrence **scheduling** (recurring tasks materialize), tag **assignment** (#40),
list/tag **rename + delete** (#41)."
**Closes issues:** #40 (task-to-tag assignment), #41 (list/tag rename + delete).
**Builds on:** `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` (the foundation
that shipped the schema, RLS, read tools, and completion-driven recurrence) and ADR 0004
(tasks are the single action surface).
**Shares foundation with:** `docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md`
— the briefings slice introduces the **pg-boss cron engine** (`createPgBossClient` `schedule`
knob, worker-only). Recurrence materialization rides on that exact same cron mechanism; see
"Shared cron foundation" below. **Coordination note:** whichever slice lands first owns the
one-line `createPgBossClient` change; the other consumes it. This spec assumes the knob exists
and reconciles its own schedules.

---

## Goal

Finish the three remaining task verticals so the Tasks module is a complete daily driver:

1. **Recurrence becomes scheduled materialization.** Today a recurring task only spawns its
   next instance when the current one is marked `done`
   (`packages/tasks/src/repository.ts:258` → `generateNext`, `packages/tasks/src/recurrence.ts:71`).
   A recurring task whose user never completes it (or completes it late) never advances on its
   own. This slice makes recurring instances **materialize on a schedule** via the shared
   pg-boss cron, with **roll-forward** semantics (resolved decision #9 of the foundation spec:
   "fixed-schedule, one live instance, missed rolls forward without stacking"), plus a
   **lazy-on-view safety net** on the read path so the list is correct between cron ticks.

2. **Tag assignment (#40).** Wire the already-built `app.task_tag_assignments` table into the
   contract and UI: `TaskDto` gains `tags: TaskTagDto[]`, `serializeTask` joins assignments,
   assign/unassign happen from the task **detail** page (read-only chips in the list view), and
   `GET /api/tasks` gains a `tagId` filter. The DB trigger
   `app.task_tag_list_match` (`packages/tasks/sql/0039_tasks_foundation.sql:116-130`) already
   enforces `tag.list_id == task.list_id`, so the UI only offers tags from the task's own list.

3. **List/tag rename + delete (#41).** Add rename + delete repository methods and routes for
   lists and tags. **List delete** = `409` if the list still holds tasks, plus an optional
   `reassignToListId` param to move tasks first (honoring `app.tasks.list_id`'s
   `ON DELETE RESTRICT`, `packages/tasks/sql/0039_tasks_foundation.sql:46`). **Tag delete** =
   cascade (the `task_tag_assignments.tag_id` FK is already `ON DELETE CASCADE`,
   `0039_tasks_foundation.sql:29`).

This is **one focused new spec** because recurrence-as-scheduled-materialization is genuinely
new design (roll-forward semantics, a per-actor cron schedule, a worker INSERT grant, a
lazy-on-view safety net) not pinned by the foundation spec — which shipped recurrence as
*completion-driven only*. Tag assignment and rename/delete are mechanical contract/CRUD work
folded into the same slice because they touch the same files (`repository.ts`, `lists.ts`,
`routes.ts`, `serialize.ts`, `tasks-api.ts`, the mocks) and should land the contract change
once.

---

## Architecture

**Recurrence stays completion-driven AND gains a scheduled safety engine.** The existing
`generateNext` (`recurrence.ts:71`) remains the primary path: completing a recurring task
immediately spawns the next instance and is already idempotent via the
`tasks_recurrence_occurrence_idx` unique index on `(recurrence_series_id, occurrence_date)`
(`0039_tasks_foundation.sql:82-84`). This slice adds a **scheduled materialization path** for
the case the foundation left open: a recurring instance whose `occurrence_date` has passed and
that was never completed. A daily per-actor cron job sweeps the actor's own recurring series and
**rolls each forward** to the next occurrence at-or-after today — advancing past skipped dates
without stacking duplicate instances (decision #9: "one live instance, missed rolls forward").
Because a cron tick can be up to ~24 h stale, a **lazy-on-view safety net** runs the identical
roll-forward on the read path (`GET /api/tasks` and the focus/drift reads) so the user never
sees a stale list. The cron is the durability guarantee; the lazy path is the freshness
guarantee. Both call one shared, idempotent `rollForwardRecurringSeries` routine.

**Why a cron and not just lazy-on-view?** Lazy-on-view alone means a recurring task only
advances when the user opens the Tasks page — but Phase 3's briefing and (future) heartbeat
read tasks **without** a page view, and a notification-worthy "this recurring task is due today"
must be true even if the app UI is never opened that morning. The cron guarantees the data is
correct for those headless consumers. This mirrors exactly the briefings slice's reasoning for
its own cron (scheduled briefings fire without a page view).

**Shared cron foundation.** pg-boss's scheduler is disabled today —
`createPgBossClient` sets `schedule: false` (`packages/jobs/src/pg-boss.ts:118`). The
briefings slice flips this on **only in the worker process** (`apps/worker/src/worker.ts:46`)
by passing `{ schedule: true }` through the existing `overrides` argument, so the cron engine
runs in exactly one long-lived process. Recurrence consumes the same enabled engine: it
registers a per-actor daily schedule on `boss.schedule(TASKS_RECURRENCE_QUEUE, cronExpr, data,
{ tz, key })` and the worker handles the fired job RLS-scoped. There is **no cross-user "what's
due" sweep** anywhere — every schedule is written in its owner's request context, every fired
job carries only that owner's `actorUserId`, and the worker executes under that actor's RLS via
`registerDataContextWorker` → `toAccessContext` (`pg-boss.ts:204-217`). This deliberately
avoids the multi-user leak surface the briefings spec calls out.

**Tag assignment and rename/delete are additive REST + repository work.** They reuse the
existing `withDataContext` + `serialize*` + Fastify route patterns
(`packages/tasks/src/routes.ts`). The schema already exists; the only DB change these two
features need is the new **worker INSERT grant** for recurrence (the assignment/rename/delete
mutations all run as `jarvis_app_runtime`, which already has full DML on the tag tables —
`0039_tasks_foundation.sql:164-167`). One new migration carries the worker grant; no other DDL
is required because `0039` already created every table, trigger, index, and FK.

---

## Components

Each component lists: **what it does · how it is used · what it depends on.**

### A. Recurrence — roll-forward routine (`packages/tasks/src/recurrence.ts`, extend)

- **What:** A new exported `rollForwardRecurringSeries(db, seriesId)` (and a batch
  `rollForwardOwnedSeries(db)` that finds the actor's live recurring tasks and calls the
  per-series routine for each). For a series whose single live (`status='todo'`) instance has
  `occurrence_date < today`, it computes the next occurrence **at or after today** by repeatedly
  applying the existing `computeNextOccurrenceDate` logic (`recurrence.ts:23`) until the date is
  not in the past, then advances the live instance's `recurrence.occurrence_date`, `due_at`, and
  `do_at` by the cumulative delta (reusing the existing `advanceDate` helper, `recurrence.ts:46`).
  Roll-forward **mutates the existing live instance in place** rather than inserting a new row —
  this is the "one live instance, missed rolls forward without stacking" rule (decision #9):
  skipping N missed occurrences must not create N rows. (Contrast: `generateNext`, the
  completion path, inserts a *new* `todo` row because the prior instance is now `done` — that is
  correct because completion is the user acknowledging the occurrence happened.)
- **How used:** Called by the cron worker (component D) for the fired actor, and by the
  lazy-on-view read path (component E) inside the same `withDataContext` scope. Both are
  RLS-scoped, so a series the actor doesn't own is invisible and untouched.
- **Depends on:** `DataContextDb` (branded handle, `assertDataContextDb`), the existing
  `computeNextOccurrenceDate`/`advanceDate` helpers, and `app.current_actor_user_id()` for the
  in-place `UPDATE`. **Determinism:** date math is computed from the stored `occurrence_date`,
  not wall-clock, except for the single "today" boundary (passed in as a parameter / computed
  once per call in UTC, matching `recurrence.ts`'s existing `toISOString().slice(0,10)` UTC
  convention) so behavior is testable.
- **Idempotency:** rolling a series already at/after today is a no-op (the loop runs zero
  times). Concurrent cron + lazy-on-view both target the same single live row; the in-place
  `UPDATE ... WHERE recurrence_series_id = ? AND status='todo' AND (recurrence->>'occurrence_date') < today`
  is naturally convergent (a second writer matches zero rows once the first advances it). The
  `tasks_recurrence_occurrence_idx` unique index still protects against any accidental duplicate
  insert.

### B. Recurrence — queue + payload (`packages/tasks/src/jobs.ts`, extend; `manifest.ts`)

- **What:** A new queue constant `TASKS_RECURRENCE_QUEUE = "tasks-recurrence-materialize"`
  (in `manifest.ts` next to `TASKS_DEFERRED_STATUS_QUEUE`, `manifest.ts:42`), a new
  `QueueDefinition` appended to `TASKS_QUEUE_DEFINITIONS` (`jobs.ts:34`), and a new
  metadata-only payload type `RecurrenceMaterializePayload extends ActorScopedJobPayload`
  carrying **only** `{ actorUserId, idempotencyKey? }`. A `RECURRENCE_MATERIALIZE_PAYLOAD_KEYS`
  allow-list + `isRecurrenceMaterializePayloadMetadataOnly` guard mirror the existing
  `DEFERRED_TASK_STATUS_PAYLOAD_KEYS` pattern (`jobs.ts:45-56`). The queue options mirror the
  deferred-status queue: `retryLimit: 0, deleteAfterSeconds: 60, retentionSeconds: 60`.
- **How used:** The schedule row's `data` is this payload (`{ actorUserId }` — the series id is
  **not** in the payload; the worker discovers the actor's own series under RLS, so the payload
  stays minimal and metadata-only). The worker (component D) validates the payload, then runs
  `rollForwardOwnedSeries`.
- **Depends on:** `@jarv1s/jobs` (`ActorScopedJobPayload`, `QueueDefinition`,
  `registerDataContextWorker`, `sendJob`). `actorUserId` and `idempotencyKey` are already in
  `ALLOWED_PAYLOAD_KEYS` (`pg-boss.ts:45-58`) — **no change to that set is needed** (this is the
  "series id discovered under RLS, never in payload" decision; if a future revision *did* put a
  series id in the payload it would require adding a key to `ALLOWED_PAYLOAD_KEYS`).

### C. Recurrence — per-actor schedule reconcile (`packages/tasks/src/recurrence-schedule.ts`, new)

- **What:** A small module mirroring the briefings `schedule.ts` design. `recurrenceCronExpr()`
  returns a documented fixed daily expression (e.g. `"0 3 * * *"` — pre-dawn, before the
  morning briefing reads tasks). `reconcileRecurrenceSchedule(boss, actorUserId)` calls
  `boss.schedule(TASKS_RECURRENCE_QUEUE, cronExpr, { actorUserId }, { tz, key: actorUserId })` —
  the per-actor key upserts on `(name, key)` so one schedule row exists per user. There is **no
  unschedule on last-recurring-task-deleted** in this slice (the job is a cheap no-op when the
  actor has zero live recurring series); keeping the schedule is simpler and harmless. `tz`
  defaults to a documented `"UTC"` (per-user timezone is deferred — see Out of scope).
- **How used:** Called (a) from the create-task route **after** a recurring task is created
  (so a user who adds their first recurring task gets a schedule), and (b) as a **per-session
  self-heal**: `reconcileRecurrenceSchedule` is invoked opportunistically on Tasks page load
  (via a lightweight call already in the request context) so a schedule lost to a DB reset
  re-establishes itself — exactly the briefings "per-session reconcile self-heals" pattern.
  Reconcile runs **outside** the `withDataContext` callback (pg-boss is not RLS-scoped) using
  the actor id from `accessContext.actorUserId`.
- **Depends on:** `@jarv1s/jobs` (`TASKS_RECURRENCE_QUEUE`, payload typing) and the boss handle
  already threaded into `TasksRoutesDependencies.boss` (`routes.ts:50`). **Failure isolation:** a
  reconcile/schedule error must never fail the user's HTTP request — log it structured
  (name+message only, like `defaultOnPgBossError`, `pg-boss.ts:97`) and return normally; the
  cron self-heals next session.

### D. Recurrence — worker handler (`packages/tasks/src/jobs.ts`, extend; `module-registry`)

- **What:** Extend `registerTasksJobWorkers` (`jobs.ts:58`) to register a second worker on
  `TASKS_RECURRENCE_QUEUE`. The handler validates the payload via
  `isRecurrenceMaterializePayloadMetadataOnly` (throws on any extra key, mirroring `jobs.ts:72`),
  then calls `rollForwardOwnedSeries(scopedDb)` under the job's actor RLS context (supplied by
  `registerDataContextWorker` → `toAccessContext`). Returns a small metadata result
  `{ rolledForward: number }`.
- **How used:** Registered through the existing `module-registry` wiring — `registerTasksJobWorkers`
  is already the tasks `registerWorkers` entry (`packages/module-registry/src/index.ts:119`), so
  returning two work ids from it requires no registry change. The queue is exported via
  `TASKS_QUEUE_DEFINITIONS`, which `getAllQueueDefinitions` already aggregates
  (`module-registry/src/index.ts:195`), so `migratePgBoss` creates it and the worker's
  startup queue-existence guard (`apps/worker/src/worker.ts:61-77`) recognizes it.
- **Depends on:** the **worker INSERT/UPDATE grant** (component F) — without it the in-place
  roll-forward `UPDATE` matches zero rows, because today `jarvis_worker_runtime` has only
  `SELECT` on the new tables and `app.tasks` (foundation grants the worker SELECT-only;
  `0039_tasks_foundation.sql:168-171`). The recurrence row policy `tasks_*` on `app.tasks`
  already lists `jarvis_worker_runtime` as a `TO` role — the missing piece is the table-level
  `GRANT`.

### E. Recurrence — lazy-on-view safety net (`packages/tasks/src/repository.ts`, extend)

- **What:** Before returning rows, `listVisible` (`repository.ts:55`) calls
  `rollForwardOwnedSeries(scopedDb)` so the list reflects rolled-forward occurrences even if the
  cron hasn't ticked since the last skipped date. The roll-forward is idempotent and touches only
  the actor's own series under RLS. Equivalent freshness is applied to the focus/at-risk/overdue
  reads (component A is called once per request; the drift queries then read the corrected rows).
- **How used:** Runs inside the same `withDataContext` scope as the read. Because roll-forward is
  a no-op when nothing is stale (the common case), the added cost is one cheap indexed
  `SELECT ... WHERE recurrence_series_id IS NOT NULL AND status='todo'` per task-list load.
- **Depends on:** component A. **Trade-off acknowledged:** this makes `listVisible` perform a
  write on the read path when a series is stale. That is intentional (freshness guarantee) and
  bounded (only stale series, only the actor's own). It is acceptable under the existing pattern
  where the completion path already writes from a status update; the read here only writes when
  data is genuinely behind.

### F. Migration — worker grant (`packages/tasks/sql/0065_tasks_worker_recurrence_grant.sql`, new)

- **What:** A new, additive migration granting the worker role the DML it needs to materialize
  recurrence: `GRANT INSERT, UPDATE ON app.tasks TO jarvis_worker_runtime;`. (INSERT covers the
  completion-style `generateNext` path should it ever run in a worker; UPDATE covers the in-place
  roll-forward. Both are required for the scheduled engine.) **No new policy is needed** — the
  existing `app.tasks` RLS policies already include `jarvis_worker_runtime` in their `TO` clause
  (the foundation wrote them forward-compatibly), so once the grant exists the worker's writes
  are RLS-scoped to the job's actor automatically.
- **How used:** Picked up by `pnpm db:migrate` via the module migration directory
  (`tasksModuleSqlMigrationDirectory`, `manifest.ts:43`). It is the **highest** migration number
  at authoring time — current max is `0064` (`packages/memory/sql/0064_*.sql`), and `0063` is
  the latest tasks migration; this slice takes the **next free global number** at landing time
  (≥ `0065`). Add the new file path to `tasksModuleManifest.database.migrations`
  (`manifest.ts:59-63`).
- **Depends on:** the migration runner's hash-check contract — **never edit `0039` or any applied
  file**; this is a brand-new file (Hard Invariant: "Never edit applied migrations").
- **Number coordination:** if the briefings/sync slices land migrations the same night, take the
  next free number after theirs (migration numbers are global by landing order — see Fleet
  Operations memory). The file name number is cosmetic ordering; only `(directory, filename)` and
  content hash matter to the runner.

### G. Tag assignment — contract (`packages/shared/src/tasks-api.ts`)

- **What:** Add `tags: readonly TaskTagDto[]` to `TaskDto` (interface, `tasks-api.ts:7-25`) and
  to `taskDtoSchema` (add `tags` to `required` and to `properties` as
  `{ type: "array", items: taskTagDtoSchema }`, `tasks-api.ts:129-169`). `TaskTagDto` and
  `taskTagDtoSchema` already exist (`tasks-api.ts:440-470`) and must be **defined above**
  `taskDtoSchema` references it — note `taskTagDtoSchema` is currently declared *after*
  `taskDtoSchema`, so either move `taskTagDtoSchema` above `taskDtoSchema` or inline the items
  schema; the implementer must resolve this ordering so the `as const` schema is valid. Add two
  new request/response contracts: `AssignTaskTagRequest { tagId: string }` →
  `assignTaskTagRequestSchema`, and the assign/unassign route schemas
  (`assignTaskTagRouteSchema` with `taskParamsSchema` params + body; `unassignTaskTagRouteSchema`
  with a `{ id, tagId }` params schema). Both respond with the updated `TaskDto`
  (reuse `getTaskResponseSchema` shape).
- **How used:** `serializeTask` (component H) populates `tags`; routes (component I) validate the
  assign/unassign bodies; the web client and mocks consume the new field.
- **Depends on:** existing `taskTagDtoSchema`, `nullableStringSchema`, `taskParamsSchema`.
  **This is the single contract change** that ripples to every `serializeTask` caller and every
  mock — land it once (see Data flow / ripple list).

### H. Tag assignment — repository + serialize (`repository.ts`, `lists.ts`, `serialize.ts`)

- **What:**
  - `serializeTask(task, tags)` gains a `tags: TaskTag[]` argument and maps it through the
    existing `serializeTaskTag` (`serialize.ts:52`). **All three call sites must pass tags**
    (`routes.ts`, `tools.ts`, `serialize.ts` itself is the definition) — see ripple list.
  - `TasksRepository` gains a tag-join helper. To avoid an N+1, `listVisible`/`listByParentId`
    fetch all assignments+tags for the returned task ids in **one** query
    (`task_tag_assignments JOIN task_tags`), then group by `task_id` in memory; single-task reads
    (`getById`) fetch that task's tags. Expose `getTagsForTask(db, taskId)` and
    `getTagsForTasks(db, taskIds)` (returns `Map<taskId, TaskTag[]>`).
  - `TaskListsRepository` (in `lists.ts`) gains `assignTag(db, taskId, tagId)` (insert into
    `app.task_tag_assignments`, relying on the `task_tag_list_match` trigger to reject a
    cross-list tag — catch the trigger error and surface a `400`) and
    `unassignTag(db, taskId, tagId)` (delete the assignment row; `ON DELETE` n/a, plain delete).
    Both run as `jarvis_app_runtime` which already has full DML on the table
    (`0039_tasks_foundation.sql:166`).
- **How used:** Routes call these; serializers fold tags into the DTO.
- **Depends on:** the `app.task_tag_assignments` RLS policy tightened to **parent-task
  ownership** in `0062_task_tag_assignments_ownership.sql` — so assign/unassign only work on the
  actor's **own** tasks (a future read-share recipient cannot mutate tags). This is already
  enforced at the DB; the repository just relies on it.

### I. Tag assignment — routes + tag filter (`packages/tasks/src/routes.ts`, `manifest.ts`)

- **What:**
  - `POST /api/tasks/:id/tags` — body `{ tagId }` → `listsRepository.assignTag` → return the
    re-serialized task with its updated `tags`. `DELETE /api/tasks/:id/tags/:tagId` →
    `unassignTag` → return the updated task.
  - `GET /api/tasks` gains an optional `tagId` query param (parsed alongside the existing
    `quadrant` param, `routes.ts:76`). When present, filter to tasks carrying that assignment —
    reuse the exact approach already proven in the assistant tool (`tools.ts:53-60`: select
    `task_id` from `task_tag_assignments WHERE tag_id = ?`, intersect). Document the param in
    `listTasksRouteSchema` only if a querystring schema is added (today the route has none; keep
    it permissive and validate in the handler like `quadrant`).
  - Register the two new routes in `tasksModuleManifest.routes` (`manifest.ts:126-218`) with
    `permissionId: "tasks.update"` (assign/unassign mutate a task the actor owns).
- **How used:** The web detail page assigns/unassigns; the list view shows read-only chips; the
  list view's existing list/status/search filters can layer the `tagId` filter.
- **Depends on:** components G, H; the existing route error handler `handleRouteError`
  (`routes.ts:28`) and the `requireObject`/`requiredString` parsers (`routes.ts:467-483`).

### J. List/tag rename + delete — repository (`packages/tasks/src/lists.ts`)

- **What:** Add to `TaskListsRepository`:
  - `renameList(db, listId, name)` — `UPDATE app.task_lists SET name=?, updated_at=now()`; relies
    on the `task_lists_owner_name_idx` unique index (`0039:14`) to reject a duplicate name (catch
    → `409`). RLS owner-only ensures the actor can only rename their own.
  - `deleteList(db, listId, reassignToListId?)` — **409-if-nonempty plus optional reassign:**
    (1) if `reassignToListId` is given, verify the actor owns it (`isOwnedByActor`, `lists.ts:108`)
    and `UPDATE app.tasks SET list_id = reassignToListId WHERE list_id = listId` first (this also
    runs the `task_tag_list_match` reconciliation concern — moving a task to another list can
    orphan tags from the old list; **drop assignments whose tag is not in the destination list**,
    mirroring the foundation's "list move drops foreign tags" rule, foundation spec
    "List move" behavior). (2) Then `DELETE FROM app.task_lists WHERE id = listId`. If the list
    still has tasks and no `reassignToListId` was given, the `ON DELETE RESTRICT` FK
    (`0039:46`) raises — catch it and return `409 { error: "List is not empty" }`. Guard: refuse
    to delete the **last** list / the implicit default if that would leave the user with none
    (return `409`); creating tasks resolves-or-creates "Personal" (`lists.ts:8`), so at least one
    list should always exist.
  - `renameTag(db, listId, tagId, name)` — `UPDATE app.task_tags SET name=? WHERE id=? AND
    list_id=?`; relies on `task_tags_list_name_idx` (`0039:24`) for duplicate rejection (→ `409`).
  - `deleteTag(db, listId, tagId)` — `DELETE FROM app.task_tags WHERE id=? AND list_id=?`;
    assignments cascade automatically (`task_tag_assignments.tag_id ... ON DELETE CASCADE`,
    `0039:29`). No 409 path — tag delete is always allowed.
- **How used:** Routes (component K) call these inside `withDataContext`.
- **Depends on:** RLS owner-only on `task_lists`/`task_tags` (`0039:143-151`); the `ON DELETE
  RESTRICT` and `ON DELETE CASCADE` FKs; `isOwnedByActor`.

### K. List/tag rename + delete — routes (`packages/tasks/src/routes.ts`, `manifest.ts`, shared)

- **What:** New routes mirroring the issue scope:
  - `PATCH /api/tasks/lists/:listId` — body `{ name }` → `renameList` → `{ list }`.
  - `DELETE /api/tasks/lists/:listId` — optional body/query `{ reassignToListId? }` →
    `deleteList` → `204` (or `{ deleted: true }`); `409` on non-empty without reassign.
  - `PATCH /api/tasks/lists/:listId/tags/:tagId` — body `{ name }` → `renameTag` → `{ tag }`.
  - `DELETE /api/tasks/lists/:listId/tags/:tagId` → `deleteTag` → `204`.
  - Add request/response/route schemas in `tasks-api.ts` (`renameTaskListRequestSchema`,
    `deleteTaskListRequestSchema` with optional `reassignToListId`, `renameTaskTagRequestSchema`,
    and `:listId`/`:tagId` params schemas). Register all four in `tasksModuleManifest.routes`
    with `permissionId: "tasks.update"` (rename) / a delete uses `tasks.update` too (there is no
    separate delete permission; manage-level is `tasks.manage` but list/tag CRUD is an update
    surface — match `createTaskList`'s `tasks.create` for create, `tasks.update` for mutate).
- **How used:** The web list sidebar exposes rename/delete affordances (component L).
- **Depends on:** component J; existing route plumbing.

### L. Web UI (`apps/web/src/tasks/*`, `apps/web/src/api/client.ts`, `query-keys.ts`)

- **What:**
  - **Tag chips (read-only) in the list view:** `task-list-view.tsx` renders `task.tags` as chips
    (the `tag-chip` class already exists, `tasks-page.tsx:259`). The issue #40 scope names
    `task-list-view.tsx`; render chips there.
  - **Assign/unassign on the detail page:** `task-detail-page.tsx` gains a Tags section that
    lists the task's current tags (removable) and offers tags from **the task's own list** only
    (fetch via the existing `listTaskTags(task.listId)`, `client.ts`), calling new
    `assignTaskTag(taskId, { tagId })` / `unassignTaskTag(taskId, tagId)` client fns. Invalidate
    `queryKeys.tasks.detail(taskId)` + `queryKeys.tasks.list` on success.
  - **List/tag rename + delete affordances** in the `ListSidebar` (`tasks-page.tsx:168`): each
    list/tag row gets rename (inline edit) + delete (with a confirm; on a non-empty list delete,
    surface the `409` and offer reassign). New client fns `renameTaskList`, `deleteTaskList`,
    `renameTaskTag`, `deleteTaskTag`; invalidate `queryKeys.tasks.lists` /
    `queryKeys.tasks.tags(listId)`.
  - **Optional tag filter** in the toolbar: a tag dropdown (populated from the active list's tags)
    that adds `?tagId=` to `listTasks`. `listTasks()` (`client.ts:133`) gains an optional
    `{ tagId?, quadrant? }` arg; `queryKeys.tasks.list` stays the coarse key (client-side filter
    is also acceptable and matches the existing in-memory `visibleTasks` filtering at
    `tasks-page.tsx:55`).
- **How used:** These are the user-facing surfaces that satisfy #40 and #41.
- **Depends on:** the contract change (G) so `TaskDto.tags` is typed; React Query keys
  (`query-keys.ts:43-50`) already cover lists/tags/detail.

### M. Test mocks (`tests/e2e/mock-api.ts`, any REST mocks)

- **What:** `createMockTask` (`mock-api.ts:434`) adds `tags: []` so the e2e `TaskDto` matches the
  contract. Add mock handlers for `POST/DELETE /api/tasks/:id/tags`, `PATCH/DELETE
  /api/tasks/lists/:listId`, `PATCH/DELETE /api/tasks/lists/:listId/tags/:tagId` so the new UI
  paths are routable in e2e. The existing tag list mock `handleTaskTagsRoute`
  (`mock-api.ts:316`) returns a tag with `listId: "list-1"` — reuse for the detail-page tag
  picker.
- **How used:** Keeps `pnpm test:e2e` green after the contract ripple.
- **Depends on:** component G (the `TaskDto.tags` shape).

---

## Data flow

**Scheduled recurrence (cron path):**
1. Worker boss starts with `{ schedule: true }` (shared briefings change,
   `apps/worker/src/worker.ts:46`); pg-boss evaluates `pgboss.schedule` rows.
2. A user's daily schedule row (key = `actorUserId`, written by component C) fires at the cron
   time in `tz`, emitting a job on `TASKS_RECURRENCE_QUEUE` with payload `{ actorUserId }`.
3. `registerDataContextWorker` (`pg-boss.ts:188`) shape-checks `actorUserId` and opens an RLS
   context for that actor (`toAccessContext`, `pg-boss.ts:204`).
4. The handler validates the payload is metadata-only, then `rollForwardOwnedSeries(scopedDb)`
   selects the actor's live recurring `todo` tasks and, for each whose `occurrence_date < today`,
   advances `occurrence_date`/`due_at`/`do_at` in place to the next occurrence ≥ today
   (component A). No new rows; no duplicates (unique index backstop).

**Lazy-on-view (read path):**
1. `GET /api/tasks` → `resolveAccessContext` → `withDataContext` → `repository.listVisible`.
2. `listVisible` first calls `rollForwardOwnedSeries(scopedDb)` (no-op if nothing stale), then
   reads tasks + joins tags (component H) and serializes with `tags` populated.

**Completion (unchanged primary path):** `PATCH /api/tasks/:id { status: "done" }` →
`repository.update` → on a recurring `done` task, `generateNext` inserts the next instance
(`repository.ts:258`). The cron and lazy paths never duplicate this because a *completed* series
has no live `todo` instance to roll forward — the new live instance `generateNext` created is
already at the next occurrence.

**Tag assignment:** detail page → `POST /api/tasks/:id/tags { tagId }` → `assignTag` (trigger
enforces same-list) → re-serialize task with tags → React Query invalidation → chips update in
list + detail.

**List delete with reassign:** sidebar delete → `DELETE /api/tasks/lists/:id { reassignToListId }`
→ `UPDATE app.tasks SET list_id=...` (drop foreign tags) → `DELETE app.task_lists` → invalidate
lists/tasks.

**Contract ripple (land once):** changing `TaskDto` to include `tags` touches every
`serializeTask` caller and every fixture:
`packages/tasks/src/serialize.ts` (definition),
`packages/tasks/src/routes.ts` (8 call sites),
`packages/tasks/src/tools.ts` (`taskListExecute`, `taskGetExecute`, focus/at-risk/overdue, subtasks),
`packages/shared/src/tasks-api.ts` (`taskDtoSchema` + `required`),
`tests/e2e/mock-api.ts` (`createMockTask`),
and `tests/integration/tasks.test.ts` assertions that read serialized tasks.

---

## Error handling

- **Cron/schedule write failures** (component C): caught, logged structured (name+message only),
  HTTP request unaffected; per-session reconcile self-heals. Matches `defaultOnPgBossError`
  (`pg-boss.ts:97`) — never rethrow on the pg-boss maintenance path.
- **Worker job failures:** `retryLimit: 0` (like the deferred-status queue) — a failed
  materialization tick is dropped, not retried into a storm; the next daily tick and any
  lazy-on-view both recover the state (roll-forward is idempotent). A malformed payload
  (`actorUserId` missing/non-uuid) fails job-scoped at the boundary (`toAccessContext`
  `assertUuid`, `pg-boss.ts:211`) rather than deep in a query.
- **Non-metadata payload:** the worker throws
  `Recurrence job ... contains non-metadata payload fields` (mirrors `jobs.ts:75`) — defense in
  depth even though `sendJob`/`boss.schedule` data is constructed only from `{ actorUserId }`.
- **Cross-list tag assign:** the `task_tag_list_match` trigger raises; the repository catches the
  PG error and the route returns `400 { error: "tag must belong to the task's list" }`.
- **Duplicate list/tag name:** unique-index violation caught → `409`.
- **List delete on a non-empty list without reassign:** `ON DELETE RESTRICT` raises → caught →
  `409 { error: "List is not empty" }` (the UI then offers reassign). Deleting the last list →
  `409`.
- **Tag/list not owned:** RLS makes the row invisible; `UPDATE`/`DELETE` matches zero rows →
  `404` (consistent with `getById` 404s in `routes.ts:162`).
- **Roll-forward race:** convergent in-place `UPDATE` (component A) — a second writer matches
  zero rows; no error, no duplicate.

---

## Security & invariants (CLAUDE.md Hard Invariants honored)

- **No admin private-data bypass / Private by default.** All new reads/writes go through
  `withDataContext` under the actor's RLS. The recurrence cron carries only `actorUserId` and the
  worker executes as that actor — **no cross-user "what's due" sweep** (the documented
  multi-user leak surface the briefings spec avoids). No `BYPASSRLS`; the worker grant (component
  F) is plain DML on an RLS-FORCEd table, scoped by the existing policies.
- **DataContextDb only.** `rollForwardRecurringSeries`, the tag join, and all rename/delete
  methods accept the branded `DataContextDb` and call `assertDataContextDb` (the existing
  pattern, `recurrence.ts:72`, `repository.ts:56`). No raw Kysely root instance is passed.
- **AccessContext shape.** Unchanged — `{ actorUserId, requestId }`. The cron worker builds it
  via `toAccessContext` from the job's `actorUserId` (`pg-boss.ts:213`); no new fields.
- **Metadata-only job payloads.** `RecurrenceMaterializePayload = { actorUserId, idempotencyKey? }`
  — actor id + optional idempotency key only; the series id is **discovered under RLS in the
  worker, never carried in the payload**. Validated by `isRecurrenceMaterializePayloadMetadataOnly`
  and by `sendJob`/`assertMetadataOnlyPayload`'s `ALLOWED_PAYLOAD_KEYS` (which already contains
  `actorUserId`, `idempotencyKey`). No task content, titles, or recurrence specs in the payload.
- **Secrets never escape.** No secrets touched. `TaskDto.tags` carries only tag id/name/listId —
  no secret surface. Structured logs emit name+message only (`pg-boss.ts:97` precedent).
- **Module isolation.** All work is inside the `tasks` module + its shared contract + its web
  surface. No other module's tables are read or written. The cron reuses the *generic* pg-boss
  engine in `@jarv1s/jobs`, not the briefings module's internals — the two slices share only the
  `createPgBossClient` foundation knob and each registers its own queue/schedule.
- **Provider-agnostic AI.** No AI provider or model is referenced; this slice adds no AI calls.
- **pgvector image / never revert.** Untouched.
- **Never edit applied migrations / module SQL in the owning dir.** The only DDL is a **new**
  file `packages/tasks/sql/0065_tasks_worker_recurrence_grant.sql` in the tasks module's `sql/`
  dir, added to the manifest's migration list. `0039`/`0062`/`0063` are untouched.
- **Spec before build.** This document is that spec.

---

## Testing strategy

**Integration (`tests/integration/tasks.test.ts`, extended — DB-backed via `pnpm test:tasks`):**

- **Roll-forward, no stacking:** create a recurring task with `occurrence_date` two cadences in
  the past; run `rollForwardOwnedSeries`; assert the single live instance advanced to the first
  occurrence ≥ today and that the series still has **exactly one** `todo` row (decision #9). Run
  it twice → idempotent (second run is a no-op).
- **Roll-forward vs completion don't double-count:** complete a recurring task (existing test at
  `tasks.test.ts:641` stays green — `generateNext` still spawns one next instance); then run
  roll-forward → still exactly one live instance.
- **Multi-skip:** `occurrence_date` 5 weekly cadences in the past → advances to the next
  occurrence ≥ today in one pass; one row only.
- **Worker grant:** a roll-forward executed under a **worker** RLS context (simulating the cron
  job actor) succeeds — proves the new `GRANT INSERT, UPDATE ... TO jarvis_worker_runtime`
  (component F) is in force; assert it fails (zero rows) **without** the grant in a control if
  feasible, or at minimum assert the grant via `information_schema.role_table_grants`.
- **RLS isolation:** user B's recurring series is untouched when user A's roll-forward runs.
- **Tag assignment:** assign a same-list tag → `TaskDto.tags` contains it; assign a tag from a
  **different** list → `400` (trigger). Unassign → tag removed. `getById`/`listVisible` return
  the joined tags (no N+1 — single grouped query). `GET /api/tasks?tagId=` filters correctly.
- **List rename:** renames; duplicate name → `409`; not-owned → `404`.
- **List delete:** non-empty without reassign → `409`; with `reassignToListId` → tasks moved,
  foreign tags dropped, list deleted; deleting the last list → `409`; not-owned → `404`.
- **Tag rename/delete:** rename duplicate → `409`; delete cascades assignments
  (`task_tag_assignments` rows gone).
- **Payload guard:** a recurrence job with an extra payload key is rejected by
  `isRecurrenceMaterializePayloadMetadataOnly`.

**Unit (`tests/unit`, in the CI gate as of #51):** `rollForwardRecurringSeries` date math —
multi-skip across month boundaries, the "already current" no-op, the today-boundary edge (an
instance whose `occurrence_date == today` is **not** rolled). `recurrenceCronExpr()` returns the
documented expression.

**E2e (`pnpm test:e2e`):** `tasks.spec.ts` extended — assign a tag from the detail page and see
the chip; rename a list in the sidebar; delete a tag. Mocks updated (component M) so the contract
matches.

**Gate:** `pnpm verify:foundation` (lint, format:check, check:file-size, typecheck, db:migrate,
test:integration) + `pnpm audit:release-hardening` green. Watch `check:file-size` — if
`repository.ts` or `routes.ts` approach 1000 lines, decompose (recurrence schedule already lives
in its own `recurrence-schedule.ts`; consider a `tags.ts` repository split).

---

## Acceptance criteria

1. A recurring task whose `occurrence_date` is in the past **advances on the daily cron tick**
   to the next occurrence at-or-after today, with the series retaining **exactly one** live
   (`todo`) instance — verified by an integration test that runs `rollForwardOwnedSeries` and
   asserts a single advanced row.
2. The same correctness holds **between cron ticks**: opening `GET /api/tasks` rolls a stale
   series forward (lazy-on-view safety net) so the returned list is never stale.
3. A multi-skip series (N missed occurrences) advances in **one** roll-forward to the next
   occurrence ≥ today **without** creating N rows (no stacking).
4. Roll-forward is **idempotent**: running it on an already-current series is a no-op; running it
   twice yields the same single live instance; it never duplicates the completion path's instance.
5. The recurrence cron job is **metadata-only** (`{ actorUserId, idempotencyKey? }`), validated
   by a guard and by `sendJob`'s `ALLOWED_PAYLOAD_KEYS`; the worker executes the roll-forward
   **RLS-scoped to the job's actor** with **no cross-user read**.
6. A new migration `packages/tasks/sql/0065_tasks_worker_recurrence_grant.sql` (next free global
   number) grants `INSERT, UPDATE ON app.tasks TO jarvis_worker_runtime`, is added to the tasks
   manifest migration list, and `pnpm db:migrate` is idempotent (exit 0 on re-run). `0039`/`0062`
   are unedited.
7. `TaskDto` includes `tags: TaskTagDto[]`; `serializeTask` populates it via a joined query (no
   N+1); the schema's `required` includes `tags`; **every** `serializeTask` caller and the e2e
   `createMockTask` compile and pass.
8. `POST /api/tasks/:id/tags` assigns a same-list tag and `DELETE /api/tasks/:id/tags/:tagId`
   unassigns; a cross-list tag assign returns `400` (DB trigger); both routes are owner-scoped
   (parent-task ownership per `0062`).
9. `GET /api/tasks?tagId=` returns only tasks carrying that assignment.
10. The task **detail** page assigns/unassigns tags (offering only the task's own list's tags);
    the **list view** shows read-only tag chips.
11. `PATCH /api/tasks/lists/:listId` renames a list (duplicate → `409`, not-owned → `404`);
    `DELETE /api/tasks/lists/:listId` returns `409` on a non-empty list, and with
    `reassignToListId` moves tasks (dropping foreign tags) then deletes; deleting the last list →
    `409`.
12. `PATCH /api/tasks/lists/:listId/tags/:tagId` renames a tag (duplicate → `409`);
    `DELETE /api/tasks/lists/:listId/tags/:tagId` deletes it and **cascades** its assignments.
13. The list sidebar exposes rename + delete affordances for lists and tags.
14. `pnpm verify:foundation` + `pnpm audit:release-hardening` are green; `pnpm test:e2e` green;
    no source file exceeds 1000 lines.

---

## Out of scope / deferred

- **Per-user recurrence timezone.** The cron uses a documented fixed `tz` (UTC) and a fixed
  pre-dawn time. Per-user timezone for recurrence materialization is deferred; lazy-on-view makes
  the user-visible list correct regardless, so the only effect is the headless (briefing/heartbeat)
  read may be at most one tick stale relative to the user's local midnight.
- **Completion-relative recurrence** ("3 days after I finish") and **subtasks on recurring
  tasks** — explicitly deferred by the foundation spec (Non-Goals) and the
  `tasks_hierarchy_guard` trigger still forbids a recurring task being a parent
  (`0039:101-108`). Unchanged here.
- **Weekly/monthly cron cadence per schedule.** The schedule fires **daily** and rolls forward
  whatever is due; the recurrence *spec* (daily/weekly/monthly) lives in the task's `recurrence`
  jsonb, not in the cron cadence. Distinct schedule cadences are unnecessary.
- **Unschedule on last-recurring-task-deleted.** The per-actor schedule persists; the job is a
  cheap no-op when the actor has no live recurring series. A cleanup pass is deferred.
- **Bulk tag operations / tag colors / tag reordering.** Single assign/unassign + rename/delete
  only.
- **List-level sharing** — per-task sharing only (foundation Non-Goals); rename/delete are
  owner-only.
- **AI write tools for tags/recurrence** — the assistant tool surface stays **read-only**
  (foundation decision); `tasks.list` already exposes a `tagId` read filter (`manifest.ts:243`).
  No write tool is added.

## Open risks

1. **Cron-engine ownership collision with the briefings/sync slices.** All three Phase-3 slices
   want the worker boss with `{ schedule: true }`. The change is a single line at
   `apps/worker/src/worker.ts:46`; the slices must coordinate so it lands **once** (whichever
   merges first owns it; the others rebase). If recurrence lands first it owns the knob and the
   briefings spec consumes it.
2. **Write-on-read in `listVisible`.** The lazy-on-view safety net performs an `UPDATE` during a
   read when a series is stale. Acceptable (bounded, idempotent, owner-only) but worth a perf eye
   on very large task lists; mitigation is the indexed predicate
   (`recurrence_series_id IS NOT NULL AND status='todo' AND occurrence_date < today`). If it ever
   bites, the cron alone is sufficient for correctness and the lazy path can be gated to the
   recurring subset only (already the plan).
3. **`taskTagDtoSchema` declaration order in `tasks-api.ts`.** `taskDtoSchema` (line 129) is
   defined *before* `taskTagDtoSchema` (line 460); referencing the latter inside the former
   requires reordering or inlining. A mechanical but easy-to-miss compile break — flagged in
   component G.
4. **N+1 on the tag join.** The list/subtask reads must batch the tag fetch
   (`getTagsForTasks` → one grouped query). A naive per-task fetch would regress the list page;
   the test "(no N+1 — single grouped query)" guards intent but cannot truly assert query count
   without instrumentation — reviewer must eyeball the implementation.
5. **Migration number drift across the overnight fleet.** If briefings/sync land migrations the
   same night, `0065` may collide; the implementer must take the next free **global** number at
   landing and update the manifest accordingly (Fleet Operations memory: numbers are global by
   landing order).
6. **`createPgBossClient` `schedule: true` blast radius.** Enabling the cron engine in the worker
   is a foundation change; if it is *not* yet merged when this slice builds, the recurrence cron
   silently won't fire (lazy-on-view still keeps the UI correct, so tests that don't simulate a
   fired job still pass — masking the gap). The integration test should exercise
   `rollForwardOwnedSeries` directly (not via a real cron tick) so correctness is verified
   independent of the engine knob, and the worker-registration wiring is covered separately.
