## Phase 10 — Module tasks

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 3
- MED: 6
- LOW: 5
- INFO: 3

### Findings

#### [HIGH] View-only sharee can write task activity (contribute privilege via view grant)
**File:** `packages/tasks/sql/0003_tasks_module.sql:161-173`  
**Invariant violated / concern:** Private by default / least-privilege grant enforcement. The share model defines three levels (`view`, `contribute`, `manage`) and `tasks_update` correctly requires `manage`. But `task_activity_insert` only checks that the parent task is *visible* (`EXISTS (SELECT 1 FROM app.tasks WHERE id = task_id)`), which is satisfied by a bare `view` share.  
**Detail:** A user granted only `view` on a task can `POST /api/tasks/:id/activity` and persist a comment/activity row on a resource they were given read-only access to. Writing activity is a contribution, not a read. The RLS INSERT policy conflates "can see the task" with "can contribute to it." The intended ladder (`view` < `contribute` < `manage`) is silently collapsed for the activity surface. This is a real cross-user write-escalation against the sharing model, even though it does not breach owner isolation.  
**Suggested fix:** Tighten `task_activity_insert` WITH CHECK to `owner_user_id = current_actor OR app.has_share('task', task_id, 'contribute')` — i.e. require at least contribute. Resolve the activity's parent owner via a subquery against `app.tasks` (which is RLS-filtered, so the EXISTS still works) rather than the bare existence check.

#### [HIGH] Sub-tasks can be created under another user's parent task (cross-owner hierarchy)
**File:** `packages/tasks/sql/0003_tasks_module.sql:120-127`, `packages/tasks/src/breakdown.ts:50-76`  
**Invariant violated / concern:** Private by default; one-level-hierarchy ownership integrity. `tasks_insert` only enforces `owner_user_id = current_actor`. It does not require the referenced `parent_task_id` to be owned by (or manage-shared to) the actor.  
**Detail:** A user with a `view` or `contribute` share on someone else's parent task (it is visible to them) can `POST /api/tasks` (or `POST /api/tasks/:id/breakdown`) with `parentTaskId` set to that foreign task. The new child row passes `tasks_insert` (its own `owner_user_id` is the actor) and passes `tasks_hierarchy_guard` (parent is top-level). The result is a parent task owned by user A with children owned by user B. The owner A now sees foreign-owned children under their own task tree (children are visible to A via `parent_task_id` joins in `getAtRisk`/`listByParentId` only if A can see them — but A's `maybeAutoCloseParent`/`cascadeCloseChildren` will silently skip rows it cannot see, corrupting the cascade), and a view-only sharee has effectively written into A's task structure. `breakDown` explicitly inserts children with `owner_user_id = app.current_actor_user_id()` while inheriting the foreign `parent.list_id`, compounding the inconsistency (child owned by B, list owned by A).  
**Suggested fix:** Add a WITH CHECK clause to `tasks_insert` that, when `parent_task_id IS NOT NULL`, requires the parent to be owned by the actor or manage-shared to them. Equivalently enforce in the `tasks_hierarchy_guard` trigger that `NEW.owner_user_id = (SELECT owner_user_id FROM app.tasks WHERE id = NEW.parent_task_id)`. The same ownership-match should be asserted for `list_id` (see related MED below).

#### [HIGH] No ownership check that `list_id` / `parent_task_id` belong to the actor
**File:** `packages/tasks/src/repository.ts:121-146`, `packages/tasks/src/repository.ts:183-185`  
**Invariant violated / concern:** Private by default; referential ownership integrity. `create` and `update` accept an arbitrary `listId` from the request body and write it straight into `app.tasks.list_id`. `task_lists` RLS is owner-only, but the FK from `app.tasks.list_id` to `app.task_lists.id` is enforced by Postgres *without* RLS on the referenced side (FK validation runs as the table owner, bypassing RLS).  
**Detail:** A user can `PATCH /api/tasks/:id { listId: "<another user's list uuid>" }` or `POST /api/tasks` with a foreign `listId`. The FK check passes (the list row exists), `tasks_update`/`tasks_insert` only validate `owner_user_id`, and the task is now filed under a list the actor does not own and cannot see. `serializeTaskList`/`list()` will never surface it to the actor, producing an orphaned/invisible task. There is no IDOR read leak (the list name isn't returned), but it is an integrity hole: a task owned by A pointing at B's private list. The `parentTaskId` path (HIGH above) is the more serious sibling of the same root cause.  
**Suggested fix:** In `create`/`update`, validate that the supplied `listId` resolves through a `listsRepository` read (which is RLS-scoped) before assigning it; reject with 400/404 otherwise. Defense-in-depth: add an RLS-aware trigger asserting `list_id`'s owner equals the task's owner.

#### [MED] `tasks.updateStatus` assistant tool declares a write capability with no `execute`
**File:** `packages/tasks/src/manifest.ts:338-353`  
**Invariant violated / concern:** Cast-heavy/contract-obscuring abstraction; dead-or-misleading public surface. Every other tool in the manifest provides an `execute`; `tasks.updateStatus` (the only `risk: "write"` tool) omits it. `ToolExecute` is optional in the SDK, so this compiles, but the tool is advertised to the assistant with an `inputSchema` and `outputSchema` yet has no implementation wired here.  
**Detail:** Either the write path is dispatched elsewhere (an out-of-module convention not visible in this package, which would be a module-isolation smell) or the tool is non-functional and will fail/no-op at call time. A registered, schema-bearing write tool with no executor is a latent bug: the assistant believes it can change task status and the contract gives no signal that it cannot.  
**Suggested fix:** Wire an explicit `taskUpdateStatusExecute` in `tools.ts` (calling `repository.updateStatus`, honoring `idempotencyKey`), or remove the tool from the manifest until the deferred-status job is the sanctioned write path. If the platform intentionally maps write tools to the deferred-status queue, document that mapping at the manifest entry so the missing `execute` is not read as a defect.

#### [MED] `taskListExecute` does whole-table fetch then in-memory filtering instead of pushing predicates to SQL
**File:** `packages/tasks/src/tools.ts:19-64`  
**Invariant violated / concern:** Incidental complexity / inefficiency; duplicated filtering logic. The tool loads `repository.listVisible` (all visible tasks, unbounded) and then re-implements `listId`/`status`/`priority`/`dueBefore`/`dueAfter`/`quadrant`/`tagId` filtering in JS — logic that the HTTP route layer also partially duplicates (`filterByQuadrant`) and that SQL could do directly.  
**Detail:** For an actor with many tasks this fetches and serializes the full set on every assistant call regardless of filter selectivity, and the `tagId` path issues a second query then set-intersects in memory. The `dueBefore`/`dueAfter` branches re-parse `due_at` with `new Date(t.due_at as Date | string)` (cast smell) per row. This is the classic "filter in the app what the DB should filter" anti-pattern and the filtering vocabulary now lives in three places (route validation, `filterByQuadrant`, this tool).  
**Suggested fix:** Add a `listFiltered(scopedDb, criteria)` method on `TasksRepository` that builds the WHERE clause (including a `task_tag_assignments` join for `tagId`) and reuse it from both the route and the tool. Compute quadrant in SQL or keep it as the single post-filter, but eliminate the per-call full-table fetch.

#### [MED] `getQuadrant` urgency depends on wall-clock `Date.now()`, making quadrant filtering non-deterministic and untestable
**File:** `packages/tasks/src/serialize.ts:17-32`  
**Invariant violated / concern:** Hidden temporal coupling; logic leaked into a serializer. `getQuadrant` (and thus `filterByQuadrant`, used by both the REST `/api/tasks?quadrant=` route and the `tasks.list` tool) reads `Date.now()` directly inside what is otherwise a pure serialization module.  
**Detail:** Placing time-sensitive business classification (Eisenhower quadrant) in `serialize.ts` mixes a side-effecting clock read into the DTO layer. It cannot be unit-tested deterministically (contrast `recurrence.ts`, which deliberately avoids wall-clock for exactly this reason and documents it). The 48-hour urgency threshold is also a magic literal duplicated from `drift.ts`'s `AT_RISK_WINDOW_HOURS`.  
**Suggested fix:** Move quadrant classification out of `serialize.ts` into a dedicated pure function that accepts an injected `now: Date`, and share the 48h constant with `drift.ts`. Have callers pass the request's `now`.

#### [MED] `generateNext` swallows any error whose message contains the substring "unique"
**File:** `packages/tasks/src/recurrence.ts:126-134`  
**Invariant violated / concern:** Over-broad swallowed error / fragile string-matching error handling. The catch treats *any* error whose message includes `"tasks_recurrence_occurrence_idx"` **or** the substring `"unique"` as a benign idempotent no-op and returns `null`.  
**Detail:** Matching on the bare substring `"unique"` is dangerously broad — an unrelated constraint violation (e.g. `tasks_source_external_key_idx`, any future `*unique*` index, or even an error message that merely mentions "unique") would be silently swallowed, dropping a recurrence instance with no signal. Driver/locale changes to the error text would silently flip this from "swallow" to "throw" or vice versa.  
**Suggested fix:** Inspect the PG error code (`23505` unique_violation) and the specific `constraint` name (`tasks_recurrence_occurrence_idx`) from the Kysely/pg error object rather than substring-matching the message. Re-throw anything that is not exactly that constraint.

#### [MED] `recurrence` accepted as opaque `Record<string, unknown>` and cast unchecked into `RecurrenceSpec`
**File:** `packages/tasks/src/routes.ts:516-524`, `packages/tasks/src/recurrence.ts:78-81`  
**Invariant violated / concern:** Unchecked cast obscuring the real contract; missing boundary validation. The route's `optionalRecurrence` only verifies the value is a non-array object — it does not validate `freq ∈ {daily,weekly,monthly}`, `interval` being a positive integer, or `occurrence_date` format. `repository.create` then writes it verbatim, and `generateNext` does `task.recurrence as unknown as RecurrenceSpec` with only truthiness guards.  
**Detail:** A client can persist `recurrence: { freq: "fortnightly", interval: -3, junk: {...} }`. It survives the route, the DB column is untyped `jsonb`, and `generateNext` either no-ops (falsy guard) or computes a nonsense next date. The `as unknown as` double-cast is exactly the "cast-heavy contract that obscures the real invariant" smell — the type system is told to trust unvalidated user JSON.  
**Suggested fix:** Validate the recurrence shape at the route boundary (reject unknown freq, non-positive interval, malformed date) and narrow it to `RecurrenceSpec` there, so the repository and `generateNext` receive a typed value and the unchecked cast disappears.

#### [MED] Defensive `metadataOnly` re-check duplicated at three layers for an internally-constructed payload
**File:** `packages/tasks/src/routes.ts:264-268`, `packages/tasks/src/jobs.ts:72-76`  
**Invariant violated / concern:** Over-defensive internal complexity / belt-and-suspenders against own code. The deferred-status payload is built by the route from four known literal fields, immediately re-validated with `isDeferredTaskStatusPayloadMetadataOnly` (throwing 500 if it fails), then the worker re-validates the *same* check again on receipt.  
**Detail:** The payload is a struct the route just constructed from `accessContext.actorUserId`, `params.id`, and validated body fields — it cannot contain non-metadata keys, so the route-side check is dead defensiveness against the function's own literal object. The cast `payload as unknown as Record<string, unknown>` to feed the checker is itself a smell. Metadata-only enforcement is a real invariant, but the right place to enforce it once is the worker boundary (untrusted queue input), not the producer that just built it.  
**Suggested fix:** Drop the route-side re-check (or replace with a typed builder that makes a non-metadata payload unconstructible), keep the single worker-side guard, and remove the `as unknown as Record<string, unknown>` casts by typing the checker over the payload type.

#### [LOW] `description` (free-text user content) flows into AI tool outputs via `tasks.list` / `tasks.get`
**File:** `packages/tasks/src/serialize.ts:62-82`, `packages/tasks/src/tools.ts:63,83`  
**Invariant violated / concern:** Secrets-never-escape is *not* violated (task descriptions are the actor's own non-secret data and the channel is RLS-scoped to the actor), but flagged for awareness: full task `description` is serialized into assistant tool results that become AI-prompt context.  
**Detail:** This is acceptable under the invariants (owner's own content, provider-agnostic router) but worth noting because there is no length cap or redaction — a very large description inflates the prompt, and any future cross-user share read (`view` sharee calling `tasks.get`) would surface the owner's description text to a different user's AI session. That last case is intended by the share model but should be a conscious decision.  
**Suggested fix:** No action required for owner-only access. If/when shared-task AI access is exercised, confirm the share level gating `tasks.get` is the intended exposure, and consider truncating `description` in tool outputs.

#### [LOW] `TaskPreferencesRepository.getOrCreate` recurses on lost-race instead of a bounded re-select
**File:** `packages/tasks/src/preferences.ts:12-20`  
**Invariant violated / concern:** Incidental complexity / unbounded recursion on a race path. On `ON CONFLICT DO NOTHING` returning no row, `getOrCreate` calls itself recursively. `lists.ts` solves the identical race with a single terminal re-select (`executeTakeFirstOrThrow`).  
**Detail:** The recursion is bounded in practice (the conflicting row exists, so the next call's first SELECT returns it), but it is a self-call where a flat re-select is clearer and matches the established canonical pattern in the same package. A pathological repeated-delete race could loop.  
**Suggested fix:** Replace the recursive tail with a final `selectFrom(...).executeTakeFirstOrThrow()`, mirroring `TaskListsRepository.getOrCreate` for consistency.

#### [LOW] Manifest route entries inconsistently reference `routeSchema.response[200]` vs full route schemas
**File:** `packages/tasks/src/manifest.ts:203,209,215`  
**Invariant violated / concern:** Contract inconsistency / leaky abstraction. Focus/at-risk/overdue routes register `responseSchema: focusTasksRouteSchema.response[200]` while every other route uses a standalone `*ResponseSchema` export.  
**Detail:** Reaching into `.response[200]` couples the manifest to the internal shape of the Fastify route-schema object rather than a named response contract, and is asymmetric with the other 11 route entries. If the route schema's `response` map ever changes shape, only these three break in a non-obvious way.  
**Suggested fix:** Export dedicated `focusTasksResponseSchema` / `atRiskTasksResponseSchema` / `overdueTasksResponseSchema` from `@jarv1s/shared` and reference those uniformly.

#### [LOW] `actor_kind` column supports `jarvis`/`system` but repository hardcodes `"user"` everywhere
**File:** `packages/tasks/src/repository.ts:321`, `packages/tasks/src/breakdown.ts:86`  
**Invariant violated / concern:** Scaffolding for an unbuilt capability (stale/aspirational schema). Migration 0039 adds `actor_kind CHECK (actor_kind IN ('user','jarvis','system'))`, but every insert in the module writes the literal `"user" as const`. Cascade/auto-close activities authored by the system are also recorded as `actor_kind = 'user'`.  
**Detail:** The auto-close and cascade activities (repository.ts:262, 293) are system-generated yet attributed to `user`, which is misleading for any future audit/provenance feature reading `actor_kind`. The enum value `jarvis`/`system` is currently dead.  
**Suggested fix:** Either drop the unused enum values until a feature needs them, or tag cascade/auto-close/recurrence activities with `actor_kind = 'system'` so the column carries real provenance.

#### [LOW] Magic 48-hour window duplicated across `drift.ts` and `serialize.ts`
**File:** `packages/tasks/src/drift.ts:9`, `packages/tasks/src/serialize.ts:25`  
**Invariant violated / concern:** Duplicated constant / single-source-of-truth. `AT_RISK_WINDOW_HOURS = 48` in `drift.ts` and `hoursUntilDue <= 48` in `serialize.ts` independently encode the same "urgent" threshold used by overlapping features (at-risk vs quadrant urgency).  
**Detail:** The two notions of "urgent within 48h" can silently diverge if one is tuned. They are conceptually the same product rule expressed twice.  
**Suggested fix:** Export a single shared constant and consume it in both places.

#### [INFO] Owner isolation, transactional cascade, and one-level hierarchy invariants are correctly enforced
**File:** `packages/db/src/data-context.ts:30-36`, `packages/tasks/sql/0039_tasks_foundation.sql:91-114`, `packages/tasks/src/repository.ts:205-227`  
**Invariant violated / concern:** None — positive confirmation.  
**Detail:** (1) Every repository method calls `assertDataContextDb` and queries through the branded `scopedDb.db`; no raw root Kysely or raw `fs` use anywhere in the module. (2) `withDataContext` wraps the whole handler in one Postgres transaction with `SET LOCAL app.actor_user_id`, so the commitment/breakdown child-insert loop and the completion cascade (cascade-close children, auto-close parent, recurrence generateNext) are atomic — no half-applied state. (3) The one-level hierarchy and "recurring task may not be a parent" rules are enforced at the DB by `tasks_hierarchy_guard` rather than duplicated in app code, and the code correctly relies on the trigger. (4) `tasks` SELECT/INSERT/UPDATE policies and all new-table policies are owner-or-share / owner-only with `current_actor_user_id() IS NOT NULL` guards; no `BYPASSRLS`, FORCE RLS is set on every table.  
**Suggested fix:** None.

#### [INFO] Deferred-status job payload is genuinely metadata-only
**File:** `packages/tasks/src/jobs.ts:13-56`, `packages/tasks/src/routes.ts:257-262`  
**Invariant violated / concern:** None — positive confirmation of the metadata-only-payload invariant.  
**Detail:** `DeferredTaskStatusPayload` carries only `actorUserId`, `taskId`, `requestedStatus` (an enum), and an optional `idempotencyKey` — actor/resource IDs, a small command param, and an idempotency key, exactly as the invariant permits. No task title, description, or other private content is placed on the queue. The `DEFERRED_TASK_STATUS_PAYLOAD_KEYS` allowlist + `isDeferredTaskStatusPayloadMetadataOnly` provide a positive enforcement check (see MED about its redundant placement, not its correctness).  
**Suggested fix:** None (correctness-wise).

#### [INFO] Module isolation respected — no cross-module internal imports
**File:** `packages/tasks/src/index.ts:1-12`  
**Invariant violated / concern:** None — positive confirmation of module isolation.  
**Detail:** The module imports only `@jarv1s/db`, `@jarv1s/jobs`, `@jarv1s/module-sdk`, `@jarv1s/shared`, and Fastify/pg-boss/kysely types — all declared platform/contract packages. It does not import another feature module's internals or query another module's tables. All task SQL lives in `packages/tasks/sql/` (not `infra/`), satisfying the module-SQL-location invariant.  
**Suggested fix:** None.
