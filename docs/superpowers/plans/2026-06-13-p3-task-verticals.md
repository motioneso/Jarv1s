# Implementation Plan — Phase 3: Task Verticals Finished (Recurrence Scheduling, Tag Assignment, List/Tag Rename + Delete)

**Plan for:** Epic #48 (Phase 3 · Core Value — Real Briefings), exit criterion #3 — "Task verticals
finished: recurrence **scheduling** (recurring tasks materialize), tag **assignment** (#40),
list/tag **rename + delete** (#41)."
**Closes issues:** #40 (task-to-tag assignment), #41 (list/tag rename + delete).
**Approved spec:** `docs/superpowers/specs/2026-06-13-phase3-task-verticals-finished.md`
(read it in full alongside this plan; this plan is the executable, dependency-ordered translation).

**Grounded on:** branch `phase2-portable-deploy` at `28ab5b6` (`feat(module-registry): gate module
registration on CORE_VERSION compat`); the prior grounding commit `5140dc3` is an ancestor of this
HEAD, so every line/signature cited below was re-verified against `phase2-portable-deploy`. Run
`pnpm audit:preflight` before building; it must exit 0. Record the verified commit in the PR body
("grounded on `<sha>`"). **Note:** `phase2-portable-deploy` already ships
`packages/settings/sql/0065_module_enablement.sql` (or similar) — so the **migration number `0065`
is already taken**. This plan's new migration MUST take the next free global number at landing (see
the migration-number rule below); the example filename `0065_*` in this document is illustrative
only and MUST be renumbered.

**Executed by:** an autonomous overnight build. This plan is self-contained and dependency-ordered.
Every task is bite-sized TDD: write a failing test → run it and SEE it fail → minimal implementation
with COMPLETE code → run it and SEE it pass → commit with an explicit `git add <paths>`. **NEVER**
`git add -A` / `git add .` — another session may share this working tree. Stage only the explicit
paths each task names.

> **Design-direction gate — DOES NOT APPLY TO THIS PLAN.** The prompt that generated this plan
> carries a conditional clause: "For the design-direction slice specifically … place an explicit
> `AWAIT BEN'S MOCKUP SIGN-OFF` gate after the spec+mockups+token-scaffolding tasks and BEFORE any
> app-wide CSS restyle tasks." **This plan is the task-verticals slice, NOT the design-direction
> slice.** It authors **zero** mockups, **zero** `tokens.css`, and **zero** app-wide CSS restyle —
> all of that lives in the separate spec `docs/superpowers/specs/2026-06-13-p3-design-direction-ritual-design.md`
> and its own plan. The web tasks here (T22–T25) add small, scoped JSX + minimal CSS for tag chips,
> a detail-page Tags section, and sidebar rename/delete affordances — they are feature wiring against
> the **existing** plain-CSS class system, not a visual-language restyle, so the mockup-sign-off gate
> is not engaged. If a future revision folds design-direction work into this plan, the gate MUST be
> inserted before any `tokens.css`/restyle task. (Recorded so the builder does not invent CSS work.)

---

## Goal

Finish the three remaining task verticals so the Tasks module is a complete daily driver:

1. **Recurrence becomes scheduled materialization.** Today a recurring task only spawns its next
   instance when the current one is marked `done` (`packages/tasks/src/repository.ts:258` →
   `generateNext`, `packages/tasks/src/recurrence.ts:71`). This slice adds a **roll-forward**
   routine that advances a stale live instance **in place** to the next occurrence ≥ today (one live
   instance, missed rolls forward without stacking), driven by (a) a per-actor daily **pg-boss cron**
   (durability for headless consumers) and (b) a **lazy-on-view safety net** on the read path
   (freshness between cron ticks). Both call one shared idempotent `rollForwardOwnedSeries`.
2. **Tag assignment (#40).** Add `tags: TaskTagDto[]` to `TaskDto`, join assignments in `serializeTask`,
   assign/unassign from the task **detail** page (read-only chips in the list view), and a `tagId`
   filter on `GET /api/tasks`. The DB trigger `task_tag_list_match` already enforces same-list tags.
3. **List/tag rename + delete (#41).** Rename + delete repository methods and routes for lists and
   tags. **List delete** = `409` if the list still holds tasks, plus an optional `reassignToListId`
   to move tasks first (honoring `ON DELETE RESTRICT`). **Tag delete** = cascade
   (`task_tag_assignments.tag_id` FK is `ON DELETE CASCADE`).

## Architecture

Recurrence stays **completion-driven** (`generateNext` is the unchanged primary path) **and** gains a
**scheduled safety engine**. A new `rollForwardRecurringSeries(db, seriesId)` / `rollForwardOwnedSeries(db)`
mutates the single live (`status='todo'`) instance of a series whose `occurrence_date < today` in
place — advancing `occurrence_date`/`due_at`/`do_at` by the cumulative delta to the first occurrence
≥ today — so N missed occurrences never create N rows. It is idempotent (the convergent
`UPDATE … WHERE id = <selected live id> AND (recurrence->>'occurrence_date') < today`
matches zero rows once advanced; the `tasks_recurrence_occurrence_idx` unique index backstops any
accidental insert).

> **Owner-only, not RLS-default — explicit predicate required (Codex finding, verified).** The
> `tasks_update` policy (`packages/tasks/sql/0019_tasks_owner_or_share.sql:33-49`) is **owner-OR-share**:
> its `USING`/`WITH CHECK` is `owner_user_id = app.current_actor_user_id() OR app.has_share('task', id,
> 'manage')`. So RLS alone would let an actor with a `manage` share roll **another owner's** series —
> wrong: recurrence roll-forward is an **owner-only** mutation (the scheduled cron and the lazy-on-view
> path act on the actor's *own* series, never tasks merely shared to them). Therefore every roll-forward
> SELECT and UPDATE in this slice carries an **explicit**
> `owner_user_id = app.current_actor_user_id()` predicate (a `sql\`owner_user_id = app.current_actor_user_id()\``
> filter), not just the implicit RLS scope. This is defense-in-depth (RLS still applies) and makes the
> owner-only intent explicit and test-provable. An integration test asserts a manage-shared task is
> NOT rolled by the grantee.

> **Single-row update, not whole-series (Codex finding, verified).** The UPDATE targets the
> **specific live row id selected** (`WHERE id = live.id`), not `WHERE recurrence_series_id = ? AND
> status='todo'`. A series should have exactly one live instance, but a `WHERE recurrence_series_id`
> update would mutate **all** `todo` rows to the same occurrence if a duplicate ever existed — a
> `tasks_recurrence_occurrence_idx` unique violation, or silent corruption. Selecting `LIMIT 1` (the
> canonical live row, ordered by `occurrence_date`) and updating by its id is deterministic and
> race-safe (the `occurrence_date < today` predicate stays on the UPDATE so a concurrent advance wins
> convergently).

A new metadata-only queue `tasks-recurrence-materialize` carries payload `{ actorUserId, idempotencyKey? }`
**only** (the series id is discovered under RLS in the worker, never in the payload). A per-actor daily
schedule (`boss.schedule(queue, cronExpr, { actorUserId }, { tz: "UTC", key: actorUserId })`) is
registered from the create-task route after a recurring task is created and re-asserted as a
per-session self-heal on Tasks page load. The worker handler validates the payload metadata-only, then
runs `rollForwardOwnedSeries` under the job's actor RLS (`registerDataContextWorker` → `toAccessContext`).
There is **no cross-user "what's due" sweep** anywhere — every schedule and every fired job carries
only its owner's `actorUserId`.

Tag assignment and rename/delete are additive REST + repository work reusing the existing
`withDataContext` + `serialize*` + Fastify route patterns. The schema already exists; the only DDL is
one new migration carrying a defensive worker grant.

**pg-boss cron engine ownership (shared with sibling slices).** `createPgBossClient` sets
`schedule: false` (`packages/jobs/src/pg-boss.ts:118`). The cron engine is enabled **only in the
worker process** by passing `{ schedule: true }` through the existing `overrides` arg at
`apps/worker/src/worker.ts:46`. This is a **one-line shared foundation change** the briefings and
sync slices also want — whichever slice lands first owns it; the others consume it. T11 of this plan
owns it **idempotently** (it checks first and is a no-op if already `{ schedule: true }`), so it is
safe regardless of merge order. Correctness of roll-forward is verified by calling the routine
**directly** in tests (never via a real cron tick), so the engine knob never masks a gap.

## Tech Stack

- **Runtime/build:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, Node 20+.
- **DB:** Postgres 17 (`pgvector/pgvector:pg17`), Kysely query builder, RLS via
  `app.current_actor_user_id()`, branded `DataContextDb` handle (`assertDataContextDb`). Migrations
  run by `pnpm db:migrate`; the runner **scans the module `sql/` directory alphabetically and
  hash-checks each applied file** (`packages/db/src/migrations/sql-runner.ts:116`) — a new file is
  picked up automatically; the manifest `database.migrations` array is a declaration list updated for
  consistency.
- **Jobs:** pg-boss `^12.18.2`. `pgboss.schedule` is `PRIMARY KEY (name, key)` — the per-actor `key`
  upserts one schedule row per user. `ScheduleOptions` carries `{ tz, key }`. Metadata-only payloads
  enforced by `ALLOWED_PAYLOAD_KEYS` (already contains `actorUserId`, `idempotencyKey` —
  `pg-boss.ts:45`).
- **Contracts:** plain shared TypeScript + AJV `as const` JSON schemas (`packages/shared/src/tasks-api.ts`).
- **Tests:** Vitest integration suites against Postgres from `pnpm db:up` (`pnpm test:tasks`); Vitest
  unit suites in the gate (`pnpm test:unit` → `tests/unit/`); Playwright e2e with mocked REST
  (`pnpm test:e2e`).
- **Web:** React + Vite + plain CSS + `var()` tokens (NO Tailwind, NO CSS-modules), TanStack Query.

---

## File Structure

### New files

| Path | Purpose |
| --- | --- |
| `packages/tasks/src/recurrence-schedule.ts` | `recurrenceCronExpr()` + `reconcileRecurrenceSchedule(boss, actorUserId)` (per-actor daily schedule upsert; failure-isolated). |
| `packages/tasks/sql/00NN_tasks_worker_recurrence_grant.sql` | Defensive `GRANT INSERT, UPDATE ON app.tasks TO jarvis_worker_runtime` migration (idempotent). **`0065` is already taken on `phase2-portable-deploy` (module-enablement);** take the next free **global** number (`0066`+) at landing — see the migration-number rule. |
| `tests/unit/tasks-recurrence-rollforward.test.ts` | Pure date-math unit tests for `rollForwardRecurringSeries` + `recurrenceCronExpr`. |

### Modified files

| Path | Change |
| --- | --- |
| `packages/tasks/src/recurrence.ts` | **Fix the monthly end-of-month clamp bug**; add exported `rollForwardRecurringSeries` + `rollForwardOwnedSeries` (owner-only explicit predicate, update-by-id, no whole-series UPDATE); export `computeNextOccurrenceDate`/`advanceDate`/`nextOccurrenceAtOrAfter`. |
| `packages/tasks/src/jobs.ts` | Add `RecurrenceMaterializePayload`, `RECURRENCE_MATERIALIZE_PAYLOAD_KEYS`, `isRecurrenceMaterializePayloadMetadataOnly`, append queue def, register second worker. |
| `packages/tasks/src/manifest.ts` | Add `TASKS_RECURRENCE_QUEUE`; add new SQL file to `database.migrations`; register tag-assign/unassign + list/tag rename/delete routes; add recurrence job entry. |
| `packages/tasks/src/repository.ts` | `listVisible`/`listByParentId` call roll-forward + batch tag join; `getById` joins tags; add `getTagsForTask`/`getTagsForTasks`; **`update` drops foreign tags when a task moves lists** (T17b). |
| `packages/tasks/src/lists.ts` | Add `assignTag` (deterministic 404/400 mapping), `unassignTag`, `renameList`, `deleteList` (existence-before-last-list-guard; reject self-reassign), `renameTag`, `deleteTag`. |
| `packages/tasks/src/serialize.ts` | `serializeTask(task, tags = [])` gains a defaulted `tags` argument (lands in T12 with the contract to keep typecheck green), maps through `serializeTaskTag`. |
| `packages/tasks/src/tools.ts` | All `serializeTask` call sites pass a tags array (read tools stay read-only). |
| `packages/tasks/src/routes.ts` | Pass tags at all `serializeTask` call sites; add tag-assign/unassign routes + `tagId` filter; add list/tag rename/delete routes; reconcile recurrence schedule after recurring create + on list load. |
| `packages/shared/src/tasks-api.ts` | Add `tags` to `TaskDto` + `taskDtoSchema`; reorder so `taskTagDtoSchema` precedes `taskDtoSchema`; add assign/rename/delete request + route schemas + params schemas. |
| `apps/web/src/api/client.ts` | Add `assignTaskTag`, `unassignTaskTag`, `renameTaskList`, `deleteTaskList`, `renameTaskTag`, `deleteTaskTag`; `listTasks({ tagId? })`. |
| `apps/web/src/tasks/task-list-view.tsx` | Render `task.tags` as read-only chips. |
| `apps/web/src/tasks/task-detail-page.tsx` | Tags section (assign/unassign from the task's own list). |
| `apps/web/src/tasks/tasks-page.tsx` | `ListSidebar` rename + delete affordances for lists and tags. |
| `apps/web/src/tasks/tasks.css` | Minimal styles for the new chips/affordances (existing class system; no token restyle). |
| `tests/e2e/mock-api.ts` | `createMockTask` adds `tags: []` (lands in T12 to keep web typecheck green); mock handlers for the new routes registered AFTER the generic task routes (Playwright reverse-order precedence). |
| `tests/e2e/tasks.spec.ts` | e2e: assign a tag from detail, rename a list, delete a tag. |
| `apps/worker/src/worker.ts` | Enable the pg-boss cron engine (`{ schedule: true }`) in the worker process (T11; shared foundation knob, idempotent). |
| `tests/integration/tasks.test.ts` | Integration coverage for every new behavior (see Testing strategy). |
| `tests/integration/tasks-helpers.ts` | `handleNextRecurrenceJob` helper (mirror of `handleNextTaskJob`) for the recurrence worker test (T10). |

### New test files (in addition to the above)

| Path | Purpose |
| --- | --- |
| `tests/unit/tasks-contract-tags.test.ts` | `TaskDto.tags` + assign/rename/delete schema assertions (T12–T13). |
| `tests/unit/jobs-cron-engine-knob.test.ts` | Non-flaky seam test: `createPgBossClient` defaults `schedule:false`, override flips it (T11). |

---

## Pre-flight (do this before Task 1)

```sh
pnpm audit:preflight            # MUST exit 0 (tree fresh vs origin/main). If behind, STOP.
pnpm install
pnpm db:up                      # Postgres for DB-touching tests
pnpm db:migrate                 # bring schema current
git checkout -b p3-task-verticals
```

If `audit:preflight` is non-zero because the tree is **behind**, stop and escalate — do not pull a
shared tree. Being *ahead* (local-only doc commits) is fine.

> **Migration-number rule (read once):** This plan illustrates the new migration as `0065_*.sql`, but
> **`0065` is ALREADY taken on `phase2-portable-deploy`** (`packages/settings/sql/0065_module_enablement.sql`
> or similar — confirm exact name at landing). The migration runner sorts by filename within the
> directory and hash-checks content; the number is cosmetic ordering but must be globally unique and
> free. **Take the next free global number** (`0066`+, and bump again if briefings/sync land theirs
> first) and update the manifest entry to match. Never edit an already-applied file. Verify the next
> free number at landing:
> `find packages -path '*/sql/*.sql' -printf '%f\n' | sort | tail -1`
> (then choose the next integer above the highest, across ALL packages, not just `tasks`).

---

## Phase A — Recurrence: roll-forward routine (pure logic first)

### Task 1 — Export the date helpers from `recurrence.ts` + fix the monthly end-of-month clamp

**Files:** modify `packages/tasks/src/recurrence.ts`.

`computeNextOccurrenceDate` and `advanceDate` are currently file-private; the roll-forward routine and
its unit tests need them. Promote them to exports.

> **PRE-EXISTING MONTHLY BUG — fix it here (Codex finding, verified against
> `packages/tasks/src/recurrence.ts:23-40`).** The monthly branch is
> `base.setUTCMonth(base.getUTCMonth() + spec.interval)` with **no clamp**. JS `Date#setUTCMonth`
> overflows: Jan 31 + 1 month → it sets month to February **on day 31**, which JS normalizes to
> **Mar 3** (or Mar 2 in a leap year) instead of clamping to Feb 28/29. This corrupts monthly series
> and **`nextOccurrenceAtOrAfter` (Task 2) loops on this helper**, so the bug compounds across
> multi-skip roll-forward. The plan's later "fix only if a test reveals it" (Task 26) is upgraded:
> fix the clamp HERE so every downstream task builds on a correct helper. The fix is behavior-changing
> for the monthly end-of-month case only; weekly/daily are unaffected.

**Steps:**

1. Write a failing unit test. Create `tests/unit/tasks-recurrence-rollforward.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";

   import { computeNextOccurrenceDate, advanceDate } from "@jarv1s/tasks";

   describe("recurrence date helpers", () => {
     it("computeNextOccurrenceDate advances weekly by interval", () => {
       expect(
         computeNextOccurrenceDate({ freq: "weekly", interval: 1, occurrence_date: "2026-06-08" })
       ).toBe("2026-06-15");
     });

     it("computeNextOccurrenceDate clamps month-end overflow (Jan 31 -> Feb 28, not Mar 3)", () => {
       expect(
         computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2026-01-31" })
       ).toBe("2026-02-28"); // 2026 is not a leap year
       expect(
         computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2028-01-31" })
       ).toBe("2028-02-29"); // leap year clamps to the 29th
     });

     it("computeNextOccurrenceDate advances monthly without overflow when the day exists", () => {
       expect(
         computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2026-03-15" })
       ).toBe("2026-04-15");
     });

     it("advanceDate shifts a Date by the occurrence delta", () => {
       const shifted = advanceDate(
         new Date("2026-06-08T09:00:00.000Z"),
         "2026-06-08",
         "2026-06-15"
       );
       expect(shifted?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
     });
   });
   ```

   (The `recurrenceCronExpr` assertion lands in Task 9 — its import is intentionally **omitted** from
   this Task 1 file so the run is honest; Task 9 appends it.)

2. Run it and SEE it fail (the names are not exported yet, and the clamp assertions fail against the
   current overflow behavior):

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

3. Minimal implementation in `packages/tasks/src/recurrence.ts`:

   a. Change the two declarations from `function` to `export function`:

   - `function computeNextOccurrenceDate(` → `export function computeNextOccurrenceDate(`
   - `function advanceDate(` → `export function advanceDate(`

   b. **Fix the monthly clamp.** Replace the bare `setUTCMonth` monthly branch with an explicit
   add-and-clamp (COMPLETE replacement for the `monthly` case in `computeNextOccurrenceDate`):

   ```ts
   case "monthly": {
     const day = base.getUTCDate();
     // Move to the 1st before adding months so the month add never overflows the day,
     // then clamp the day to the target month's last day.
     base.setUTCDate(1);
     base.setUTCMonth(base.getUTCMonth() + spec.interval);
     const lastDayOfTargetMonth = new Date(
       Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
     ).getUTCDate();
     base.setUTCDate(Math.min(day, lastDayOfTargetMonth));
     break;
   }
   ```

   (Daily and weekly branches are unchanged. The `{ ... }` block scope is required because the
   `case` declares `const day`.)

   No `index.ts` change is needed: it already does `export * from "./recurrence.js";` (verified at
   `packages/tasks/src/index.ts:7`), so the new exports propagate automatically. Confirm with:

   ```sh
   grep -n "recurrence" packages/tasks/src/index.ts   # expect: export * from "./recurrence.js";
   ```

4. Run it and SEE it pass:

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/recurrence.ts tests/unit/tasks-recurrence-rollforward.test.ts
   git add packages/tasks/src/index.ts   # only if you edited the export list
   git commit -m "fix(tasks): clamp monthly recurrence end-of-month + export date helpers (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 2 — `rollForwardRecurringSeries` (single series, in-place, idempotent)

**Files:** modify `packages/tasks/src/recurrence.ts`; modify `tests/unit/tasks-recurrence-rollforward.test.ts`.

**Steps:**

1. Add failing **unit** tests for the pure date computation that the routine performs. Append to
   `tests/unit/tasks-recurrence-rollforward.test.ts`:

   ```ts
   import { nextOccurrenceAtOrAfter } from "@jarv1s/tasks";

   describe("nextOccurrenceAtOrAfter (roll-forward date math)", () => {
     const spec = { freq: "weekly", interval: 1, occurrence_date: "2026-06-01" } as const;

     it("returns the same date when occurrence is already at/after today", () => {
       expect(nextOccurrenceAtOrAfter(spec, "2026-06-01")).toBe("2026-06-01");
       expect(nextOccurrenceAtOrAfter(spec, "2026-05-31")).toBe("2026-06-01");
     });

     it("rolls a multi-skip series forward to the first occurrence >= today in one pass", () => {
       // five weekly cadences in the past relative to today 2026-07-06:
       expect(nextOccurrenceAtOrAfter(spec, "2026-07-06")).toBe("2026-07-06");
     });

     it("does not roll an occurrence that equals today (boundary)", () => {
       expect(nextOccurrenceAtOrAfter(spec, "2026-06-01")).toBe("2026-06-01");
     });
   });
   ```

2. Run and SEE fail:

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

3. Minimal implementation — add to `packages/tasks/src/recurrence.ts` (COMPLETE code):

   ```ts
   /**
    * Given a recurrence spec and a `today` (YYYY-MM-DD, UTC), return the first
    * occurrence date at-or-after today, computed deterministically from the spec's
    * stored occurrence_date by repeatedly applying computeNextOccurrenceDate.
    *
    * Boundary rule: an occurrence_date that EQUALS today is already "at or after" —
    * it is returned unchanged (not rolled).
    */
   export function nextOccurrenceAtOrAfter(spec: RecurrenceSpec, today: string): string {
     let current = spec.occurrence_date;
     // Guard against a pathological spec (interval 0) producing an infinite loop.
     if (!spec.freq || !spec.interval || spec.interval < 1) {
       return current;
     }
     let guard = 0;
     while (current < today && guard < 10_000) {
       current = computeNextOccurrenceDate({ ...spec, occurrence_date: current });
       guard += 1;
     }
     return current;
   }

   /**
    * Roll a single recurring series forward in place: if its one live (status='todo')
    * instance has occurrence_date < today, advance occurrence_date/due_at/do_at to the
    * next occurrence at-or-after today. One live instance, missed rolls forward without
    * stacking (no new row). Idempotent: a series already at/after today is a no-op.
    *
    * Returns true if a row was advanced, false otherwise.
    */
   export async function rollForwardRecurringSeries(
     db: DataContextDb,
     seriesId: string,
     today: string = new Date().toISOString().slice(0, 10)
   ): Promise<boolean> {
     assertDataContextDb(db);

     // OWNER-ONLY: explicit owner predicate, not just RLS (tasks_update is owner-OR-share;
     // roll-forward must never touch a series merely shared to this actor). Select the single
     // canonical live row (LIMIT 1, oldest occurrence first) so we update by id, never the
     // whole series.
     const live = await db.db
       .selectFrom("app.tasks")
       .selectAll()
       .where("recurrence_series_id", "=", seriesId)
       .where("status", "=", "todo")
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .orderBy(sql`(recurrence->>'occurrence_date')`, "asc")
       .limit(1)
       .executeTakeFirst();

     if (!live || live.recurrence == null) {
       return false;
     }

     const spec = live.recurrence as unknown as RecurrenceSpec;
     if (!spec.freq || !spec.interval || !spec.occurrence_date) {
       return false;
     }
     if (spec.occurrence_date >= today) {
       return false; // already current — no-op
     }

     const newOccurrence = nextOccurrenceAtOrAfter(spec, today);
     if (newOccurrence === spec.occurrence_date) {
       return false;
     }

     const nextRecurrence: RecurrenceSpec = {
       freq: spec.freq,
       interval: spec.interval,
       occurrence_date: newOccurrence
     };
     const nextDueAt = advanceDate(live.due_at, spec.occurrence_date, newOccurrence);
     const nextDoAt = advanceDate(live.do_at, spec.occurrence_date, newOccurrence);

     // Convergent in-place update BY ID (never whole-series): a concurrent writer that has
     // already advanced this row past `today` matches zero rows here. The status='todo' guard
     // is CRITICAL — a concurrent completion (generateNext path) can flip this row to 'done'
     // between our SELECT and UPDATE; without it we would mutate a completed historical row.
     // Owner predicate restated for defense-in-depth.
     const updated = await db.db
       .updateTable("app.tasks")
       .set({
         recurrence: nextRecurrence as unknown as Record<string, unknown>,
         due_at: nextDueAt,
         do_at: nextDoAt,
         updated_at: new Date()
       })
       .where("id", "=", live.id)
       .where("status", "=", "todo")
       .where(sql<boolean>`(recurrence->>'occurrence_date') < ${today}`)
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .executeTakeFirst();

     return Number(updated.numUpdatedRows ?? 0n) > 0;
   }
   ```

4. Run and SEE pass:

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/recurrence.ts tests/unit/tasks-recurrence-rollforward.test.ts
   git commit -m "feat(tasks): rollForwardRecurringSeries — in-place, idempotent, no stacking (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 3 — `rollForwardOwnedSeries` (batch over the actor's live recurring series)

**Files:** modify `packages/tasks/src/recurrence.ts`; modify `tests/integration/tasks.test.ts`.

This is the DB-backed batch routine; its correctness needs RLS, so its first test is an integration
test (in the gate via `pnpm test:tasks`).

**Steps:**

1. Add a failing **integration** test to `tests/integration/tasks.test.ts` (inside the existing
   `describe`). Use the existing `dataContext`, `userAContext`, `repository`, and import
   `rollForwardOwnedSeries` from `@jarv1s/tasks`:

   ```ts
   it("rollForwardOwnedSeries advances a stale series to the next occurrence >= today, one row, idempotent", async () => {
     const today = new Date().toISOString().slice(0, 10);
     const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

     const made = await dataContext.withDataContext(userAContext(), (db) =>
       repository.create(db, {
         title: "weekly recurring",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: past },
         dueAt: new Date(past + "T09:00:00.000Z")
       })
     );

     const rolled = await dataContext.withDataContext(userAContext(), (db) =>
       rollForwardOwnedSeries(db, today)
     );
     expect(rolled).toBeGreaterThanOrEqual(1);

     const series = await dataContext.withDataContext(userAContext(), (db) =>
       db.db
         .selectFrom("app.tasks")
         .selectAll()
         .where("recurrence_series_id", "=", made.recurrence_series_id!)
         .where("status", "=", "todo")
         .execute()
     );
     expect(series).toHaveLength(1); // no stacking
     const occ = (series[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
     expect(occ >= today).toBe(true);

     // Idempotent: a second run is a no-op (zero rolled, still one row).
     const again = await dataContext.withDataContext(userAContext(), (db) =>
       rollForwardOwnedSeries(db, today)
     );
     expect(again).toBe(0);
   });
   ```

2. Run and SEE fail (export missing / wrong behavior):

   ```sh
   pnpm test:tasks
   ```

3. Minimal implementation — add to `packages/tasks/src/recurrence.ts` (COMPLETE code):

   ```ts
   /**
    * Roll forward every live recurring series owned by the current actor (RLS-scoped).
    * Finds distinct series with a stale live instance, rolls each via
    * rollForwardRecurringSeries, and returns the count advanced. Idempotent.
    */
   export async function rollForwardOwnedSeries(
     db: DataContextDb,
     today: string = new Date().toISOString().slice(0, 10)
   ): Promise<number> {
     assertDataContextDb(db);

     // OWNER-ONLY scan: distinct stale series the ACTOR OWNS (explicit predicate, not just
     // RLS — tasks_select is owner-OR-share, so a manage-shared stale series would otherwise
     // appear here and be rolled by the grantee).
     const stale = await db.db
       .selectFrom("app.tasks")
       .select("recurrence_series_id")
       .distinct()
       .where("recurrence_series_id", "is not", null)
       .where("status", "=", "todo")
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .where(sql<boolean>`(recurrence->>'occurrence_date') < ${today}`)
       .execute();

     let rolled = 0;
     for (const row of stale) {
       const seriesId = row.recurrence_series_id;
       if (seriesId == null) continue;
       if (await rollForwardRecurringSeries(db, seriesId, today)) {
         rolled += 1;
       }
     }
     return rolled;
   }
   ```

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/recurrence.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): rollForwardOwnedSeries — batch roll-forward over actor series (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 4 — Roll-forward does not double-count the completion path

**Files:** modify `tests/integration/tasks.test.ts` only (regression guard — no new impl).

**Steps:**

1. Add a failing-then-passing guard test. Completing a recurring task spawns the next instance via
   `generateNext`; running roll-forward afterwards must NOT create another row:

   ```ts
   it("roll-forward does not duplicate the completion-path instance", async () => {
     const today = new Date().toISOString().slice(0, 10);
     const made = await dataContext.withDataContext(userAContext(), (db) =>
       repository.create(db, {
         title: "complete then roll",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: today },
         dueAt: new Date(today + "T09:00:00.000Z")
       })
     );
     await dataContext.withDataContext(userAContext(), (db) =>
       repository.updateStatus(db, made.id, "done")
     );
     await dataContext.withDataContext(userAContext(), (db) =>
       rollForwardOwnedSeries(db, today)
     );
     const live = await dataContext.withDataContext(userAContext(), (db) =>
       db.db
         .selectFrom("app.tasks")
         .selectAll()
         .where("recurrence_series_id", "=", made.recurrence_series_id!)
         .where("status", "=", "todo")
         .execute()
     );
     expect(live).toHaveLength(1); // exactly one live instance
   });
   ```

2. Run:

   ```sh
   pnpm test:tasks
   ```

   This should pass immediately (the completion path produces a fresh instance at the next occurrence,
   which is ≥ today, so roll-forward is a no-op on it). If it FAILS, the roll-forward in Task 2/3 is
   wrong — fix the routine, not the test. (Confirm the failure is real by temporarily breaking the
   `>= today` guard, then restore.)

3. Commit:

   ```sh
   git add tests/integration/tasks.test.ts
   git commit -m "test(tasks): roll-forward + completion path never double-count (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 5 — RLS isolation for roll-forward

**Files:** modify `tests/integration/tasks.test.ts` only.

**Steps:**

1. Add a test: user B's stale recurring series is untouched when user A runs roll-forward:

   ```ts
   it("roll-forward is RLS-scoped: A's run never touches B's series", async () => {
     const today = new Date().toISOString().slice(0, 10);
     const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
     const bMade = await dataContext.withDataContext(userBContext(), (db) =>
       repository.create(db, {
         title: "B weekly",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
       })
     );
     await dataContext.withDataContext(userAContext(), (db) =>
       rollForwardOwnedSeries(db, today)
     );
     const bLive = await dataContext.withDataContext(userBContext(), (db) =>
       db.db
         .selectFrom("app.tasks")
         .selectAll()
         .where("recurrence_series_id", "=", bMade.recurrence_series_id!)
         .where("status", "=", "todo")
         .execute()
     );
     const occ = (bLive[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
     expect(occ).toBe(past); // untouched by A's run
   });
   ```

2. Add a SECOND test — the owner-OR-share gap. A task B shared to A with `manage` is **not** rolled
   by A's run (the explicit `owner_user_id` predicate, not just RLS, is what enforces this). Use the
   suite's existing share helper (grep `has_share` / the shares repo used elsewhere in
   `tasks.test.ts`; if the suite has no manage-share helper, insert a `manage` grant row directly for
   B's task to A under B's context, mirroring the shareability tests):

   ```ts
   it("roll-forward does NOT roll a manage-shared series owned by another user", async () => {
     const today = new Date().toISOString().slice(0, 10);
     const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
     const bMade = await dataContext.withDataContext(userBContext(), (db) =>
       repository.create(db, {
         title: "B weekly shared-manage",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
       })
     );
     // Grant A a 'manage' share on B's task (reuse the suite's existing share machinery).
     await grantManageShare(bMade.id, ids.userB, ids.userA); // helper as used elsewhere in suite
     // A's roll-forward run must skip it (owner predicate, not just RLS).
     await dataContext.withDataContext(userAContext(), (db) => rollForwardOwnedSeries(db, today));
     const bLive = await dataContext.withDataContext(userBContext(), (db) =>
       db.db.selectFrom("app.tasks").selectAll()
         .where("recurrence_series_id", "=", bMade.recurrence_series_id!)
         .where("status", "=", "todo").execute()
     );
     const occ = (bLive[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
     expect(occ).toBe(past); // untouched — manage share is NOT ownership for roll-forward
   });
   ```

   > If the suite genuinely has no helper to create a `manage` share, insert the grant row directly
   > with the same columns the shareability tests use (`grep -n "has_share\|action_grants\|shares"
   > tests/integration/tasks.test.ts`). Do NOT skip this test — it is the proof for the most serious
   > finding (owner-OR-share RLS would otherwise let a grantee mutate the owner's recurrence).

3. Run and SEE pass (the explicit owner predicate enforces both cases):

   ```sh
   pnpm test:tasks
   ```

4. Commit:

   ```sh
   git add tests/integration/tasks.test.ts
   git commit -m "test(tasks): roll-forward is owner-only — RLS isolation + manage-share refusal (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase B — Migration: worker grant

### Task 6 — `00NN` worker recurrence grant (defensive, idempotent)

**Files:** create `packages/tasks/sql/00NN_tasks_worker_recurrence_grant.sql` (`00NN` = next free
global number — **NOT `0065`, which is taken**; see the migration-number rule); modify
`packages/tasks/src/manifest.ts`; modify `tests/integration/tasks.test.ts`.

> **PICK THE NUMBER FIRST.** Before creating the file, run
> `find packages -path '*/sql/*.sql' -printf '%f\n' | sort | tail -1` and choose the next integer above
> the highest across ALL packages. Use that everywhere below in place of `00NN`. The tasks dir already
> has up to `0063`; `0065` is taken by settings; so `0066`+ is likely free (verify, do not assume).

> **CONTEXT THE BUILDER MUST KNOW (verified against the tree):** `0003_tasks_module.sql:93` already
> grants `SELECT, INSERT, UPDATE ON app.tasks TO jarvis_app_runtime, jarvis_worker_runtime`, and **no
> later migration revokes it** (verified: `grep -rn "REVOKE.*app.tasks" packages infra` returns
> nothing). So the worker role **already** has the INSERT/UPDATE it needs for in-place roll-forward.
> This migration is therefore **defensive and explicit** (re-granting an existing grant is a Postgres
> no-op), not a fix for a missing grant. The spec's "fails without the grant" control is **not
> feasible** (the grant predates this slice) — assert presence via `information_schema.role_table_grants`
> instead. The migration still ships because the spec mandates it and it makes the worker's recurrence
> capability self-documenting and robust against any future grant churn on the new foundation tables.

**Steps:**

1. Add a failing integration test asserting the worker grant is present:

   ```ts
   it("jarvis_worker_runtime holds INSERT and UPDATE on app.tasks (recurrence grant)", async () => {
     const client = new Client({ connectionString: connectionStrings.bootstrap });
     await client.connect();
     try {
       const { rows } = await client.query(
         `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'jarvis_worker_runtime'
            AND table_schema = 'app' AND table_name = 'tasks'
            AND privilege_type IN ('INSERT','UPDATE')
          ORDER BY privilege_type`
       );
       const privs = rows.map((r: { privilege_type: string }) => r.privilege_type);
       expect(privs).toEqual(["INSERT", "UPDATE"]);
     } finally {
       await client.end();
     }
   });
   ```

   (This passes on the current tree because of `0003`. To make the TDD honest, FIRST confirm it
   passes, then write the migration so the grant is **owned by this slice's migration** going forward.
   If you prefer a true red→green, temporarily target a fictitious privilege in the assertion, see it
   fail, then restore — but the production assertion above is the one to commit.)

2. Run and confirm the assertion's behavior:

   ```sh
   pnpm test:tasks
   ```

3. Create `packages/tasks/sql/00NN_tasks_worker_recurrence_grant.sql` (use the real number you picked
   above; COMPLETE content):

   ```sql
   -- Phase 3 task-verticals: make the worker's recurrence-materialization capability
   -- explicit and self-documenting. The scheduled cron worker runs rollForwardOwnedSeries,
   -- which UPDATEs app.tasks in place (and INSERT covers the completion-style generateNext
   -- path should it ever run in a worker). jarvis_worker_runtime already received
   -- SELECT, INSERT, UPDATE on app.tasks in 0003_tasks_module.sql and no migration has
   -- revoked it; re-granting is an idempotent no-op. The app.tasks RLS policies
   -- (0019_tasks_owner_or_share.sql) already list jarvis_worker_runtime in their TO clause,
   -- so the worker's writes are RLS-scoped to the job's actor automatically. No new policy.
   GRANT INSERT, UPDATE ON app.tasks TO jarvis_worker_runtime;
   ```

4. Add the file to the manifest declaration list in `packages/tasks/src/manifest.ts`:

   ```ts
   database: {
     migrations: [
       "sql/0003_tasks_module.sql",
       "sql/0019_tasks_owner_or_share.sql",
       "sql/0039_tasks_foundation.sql",
       "sql/00NN_tasks_worker_recurrence_grant.sql"   // <- the real number you picked
     ],
   ```

   (Leave `migrationDirectories` and `ownedTables` unchanged. Note: the `migrations` array is a partial
   declaration list — the runner actually discovers files via `migrationDirectories` — but keep it
   current for consistency, as the existing entries are.)

5. Run `db:migrate` twice to prove idempotency, then the suite:

   ```sh
   pnpm db:migrate && pnpm db:migrate    # second run MUST exit 0 (hash-check + idempotent grant)
   pnpm test:tasks
   ```

6. Commit:

   ```sh
   git add packages/tasks/sql/00NN_tasks_worker_recurrence_grant.sql packages/tasks/src/manifest.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): explicit worker INSERT/UPDATE grant on app.tasks for recurrence (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase C — Recurrence: queue, payload, worker handler

### Task 7 — Recurrence queue constant + queue definition

**Files:** modify `packages/tasks/src/manifest.ts`, `packages/tasks/src/jobs.ts`.

**Steps:**

1. Add a failing **integration** test that the queue is created by `migratePgBoss` (the worker's
   startup guard depends on it existing). In `tests/integration/tasks.test.ts`:

   ```ts
   it("creates the tasks-recurrence-materialize queue", async () => {
     const queue = await workerBoss.getQueue("tasks-recurrence-materialize");
     expect(queue).not.toBeNull();
   });
   ```

2. Run and SEE fail (queue not defined yet):

   ```sh
   pnpm test:tasks
   ```

3. Implementation:

   In `packages/tasks/src/manifest.ts`, next to `TASKS_DEFERRED_STATUS_QUEUE`:

   ```ts
   export const TASKS_RECURRENCE_QUEUE = "tasks-recurrence-materialize";
   ```

   In `packages/tasks/src/jobs.ts`, import the new constant and append to `TASKS_QUEUE_DEFINITIONS`:

   ```ts
   import { TASKS_DEFERRED_STATUS_QUEUE, TASKS_RECURRENCE_QUEUE } from "./manifest.js";
   ```

   ```ts
   export const TASKS_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
     {
       name: TASKS_DEFERRED_STATUS_QUEUE,
       options: { retryLimit: 0, deleteAfterSeconds: 60, retentionSeconds: 60 }
     },
     {
       name: TASKS_RECURRENCE_QUEUE,
       options: { retryLimit: 0, deleteAfterSeconds: 60, retentionSeconds: 60 }
     }
   ];
   ```

   The integration test harness creates queues via `migratePgBoss(getAllQueueDefinitions())` during
   DB reset; confirm the harness reseeds queues (it does — `resetFoundationDatabase` runs migrate).
   If the queue is not present, ensure `pnpm db:migrate` was re-run in beforeAll.

4. Run and SEE pass:

   ```sh
   pnpm db:migrate && pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/manifest.ts packages/tasks/src/jobs.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): add tasks-recurrence-materialize queue definition (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 8 — Recurrence payload type + metadata-only guard

**Files:** modify `packages/tasks/src/jobs.ts`; modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Add a failing test for the guard:

   ```ts
   it("isRecurrenceMaterializePayloadMetadataOnly rejects extra keys", async () => {
     const { isRecurrenceMaterializePayloadMetadataOnly } = await import("@jarv1s/tasks");
     expect(
       isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA })
     ).toBe(true);
     expect(
       isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA, idempotencyKey: "k" })
     ).toBe(true);
     expect(
       isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA, seriesId: "x" })
     ).toBe(false);
   });
   ```

2. Run and SEE fail:

   ```sh
   pnpm test:tasks
   ```

3. Implementation — add to `packages/tasks/src/jobs.ts` (COMPLETE code):

   ```ts
   export interface RecurrenceMaterializePayload extends ActorScopedJobPayload {
     readonly idempotencyKey?: string;
   }

   export interface RecurrenceMaterializeResult {
     readonly rolledForward: number;
   }

   export const RECURRENCE_MATERIALIZE_PAYLOAD_KEYS = ["actorUserId", "idempotencyKey"] as const;

   export function isRecurrenceMaterializePayloadMetadataOnly(
     payload: Record<string, unknown>
   ): boolean {
     const allowedKeys = new Set<string>(RECURRENCE_MATERIALIZE_PAYLOAD_KEYS);
     return Object.keys(payload).every((key) => allowedKeys.has(key));
   }
   ```

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/jobs.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): recurrence materialize payload type + metadata-only guard (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 9 — Recurrence schedule module (`recurrence-schedule.ts`)

**Files:** create `packages/tasks/src/recurrence-schedule.ts`; modify
`tests/unit/tasks-recurrence-rollforward.test.ts`; modify `packages/tasks/src/index.ts` if it uses an
explicit export list.

**Steps:**

1. Add the `recurrenceCronExpr` assertion that was deferred from Task 1 — append to the unit test:

   ```ts
   import { recurrenceCronExpr } from "@jarv1s/tasks";

   describe("recurrenceCronExpr", () => {
     it("returns the documented pre-dawn daily cron expression", () => {
       expect(recurrenceCronExpr()).toBe("0 3 * * *");
     });
   });
   ```

2. Run and SEE fail:

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

3. Implementation — create `packages/tasks/src/recurrence-schedule.ts` (COMPLETE code):

   ```ts
   import type { PgBoss } from "pg-boss";

   import { TASKS_RECURRENCE_QUEUE } from "./manifest.js";
   import type { RecurrenceMaterializePayload } from "./jobs.js";

   /**
    * Documented fixed daily cron expression: 03:00 — pre-dawn, before the morning
    * briefing reads tasks. Per-user timezone is deferred (see spec Out of scope);
    * the schedule runs in UTC and the lazy-on-view safety net keeps the user-visible
    * list correct regardless of local midnight.
    */
   export function recurrenceCronExpr(): string {
     return "0 3 * * *";
   }

   export const RECURRENCE_SCHEDULE_TZ = "UTC";

   /**
    * Upsert a per-actor daily recurrence schedule. The schedule row key is the
    * actorUserId, so pgboss.schedule's PRIMARY KEY (name, key) keeps exactly one row
    * per user. Failure-isolated: a schedule error must NEVER fail the caller's HTTP
    * request — it is logged structured (name+message only) and swallowed; the
    * per-session self-heal re-establishes the schedule next time.
    */
   export async function reconcileRecurrenceSchedule(
     boss: PgBoss,
     actorUserId: string
   ): Promise<void> {
     const data: RecurrenceMaterializePayload = { actorUserId };
     try {
       await boss.schedule(TASKS_RECURRENCE_QUEUE, recurrenceCronExpr(), data, {
         tz: RECURRENCE_SCHEDULE_TZ,
         key: actorUserId
       });
       // Observability (Codex finding): a structured success line so schedule upserts are
       // visible/auditable. actorUserId is an internal id, not a secret. Cardinality is
       // bounded to one row per actor by the (name, key) primary key.
       process.stdout.write(
         `${JSON.stringify({
           level: "debug",
           event: "tasks.recurrence_schedule_reconciled",
           actorUserId
         })}\n`
       );
     } catch (error) {
       const err = error instanceof Error ? error : new Error(String(error));
       process.stderr.write(
         `${JSON.stringify({
           level: "error",
           event: "tasks.recurrence_schedule_failed",
           name: err.name,
           message: err.message
         })}\n`
       );
     }
   }
   ```

   > **pg-boss API note:** `boss.schedule(name, cron, data, options)` — verify the exact
   > `ScheduleOptions` field names against the installed pg-boss types
   > (`node_modules/pg-boss/types.d.ts`): `{ tz, key }`. If `key` is not on `ScheduleOptions` in the
   > pinned version, fall back to a singletonKey-style options object the version supports; the goal is
   > one schedule row per actor. Do not invent fields.

   If `packages/tasks/src/index.ts` uses an explicit export list, add
   `export * from "./recurrence-schedule.js";` (or the named exports).

4. Run and SEE pass:

   ```sh
   pnpm test:unit -- tests/unit/tasks-recurrence-rollforward.test.ts
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/recurrence-schedule.ts tests/unit/tasks-recurrence-rollforward.test.ts
   git add packages/tasks/src/index.ts   # only if you edited the export list
   git commit -m "feat(tasks): per-actor recurrence schedule reconcile (failure-isolated) (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 10 — Recurrence worker handler (second worker on the tasks module)

**Files:** modify `packages/tasks/src/jobs.ts`; modify `tests/integration/tasks.test.ts` and
`tests/integration/tasks-helpers.ts`.

**Steps:**

1. Add an integration test that a fired recurrence job rolls the actor's series forward under worker
   RLS. Add a helper to `tests/integration/tasks-helpers.ts` mirroring `handleNextTaskJob` but for the
   recurrence queue (registers both workers via `registerTasksJobWorkers`, sends a
   `{ actorUserId }` job to `TASKS_RECURRENCE_QUEUE` via `sendJob`, waits for the recurrence
   `onResult`). Then in `tests/integration/tasks.test.ts`:

   ```ts
   it("recurrence worker rolls the actor's stale series forward under RLS", async () => {
     const today = new Date().toISOString().slice(0, 10);
     const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
     const made = await dataContext.withDataContext(userAContext(), (db) =>
       repository.create(db, {
         title: "worker rolls me",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
       })
     );

     const result = await handleNextRecurrenceJob(workerBoss, ids.userA);
     expect(result.rolledForward).toBeGreaterThanOrEqual(1);

     const live = await dataContext.withDataContext(userAContext(), (db) =>
       db.db
         .selectFrom("app.tasks")
         .selectAll()
         .where("recurrence_series_id", "=", made.recurrence_series_id!)
         .where("status", "=", "todo")
         .execute()
     );
     const occ = (live[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
     expect(occ >= today).toBe(true);
   });
   ```

   `handleNextRecurrenceJob` (new helper) — COMPLETE shape (mirror `handleNextTaskJob`, but send a job
   first and resolve on the recurrence `onResult` callback added in step 3; register workers with the
   new `onRecurrenceResult` option; `sendJob(workerBoss, TASKS_RECURRENCE_QUEUE, { actorUserId })`).

2. Run and SEE fail:

   ```sh
   pnpm test:tasks
   ```

3. Implementation — extend `registerTasksJobWorkers` in `packages/tasks/src/jobs.ts` to register a
   second worker and return both work ids (COMPLETE code for the additions):

   ```ts
   import { TASKS_DEFERRED_STATUS_QUEUE, TASKS_RECURRENCE_QUEUE } from "./manifest.js";
   import { rollForwardOwnedSeries } from "./recurrence.js";
   ```

   Extend `RegisterTasksJobWorkersOptions`:

   ```ts
   export interface RegisterTasksJobWorkersOptions {
     readonly repository?: TasksRepository;
     readonly workOptions?: WorkOptions;
     readonly onResult?: (
       job: Job<DeferredTaskStatusPayload>,
       result: DeferredTaskStatusResult
     ) => void;
     readonly onRecurrenceResult?: (
       job: Job<RecurrenceMaterializePayload>,
       result: RecurrenceMaterializeResult
     ) => void;
   }
   ```

   At the end of `registerTasksJobWorkers`, before `return`, register the second worker and collect
   its id:

   ```ts
   const recurrenceWorkId = await registerDataContextWorker<
     RecurrenceMaterializePayload,
     RecurrenceMaterializeResult
   >(
     boss,
     TASKS_RECURRENCE_QUEUE,
     dataContext,
     async (job, scopedDb) => {
       if (
         !isRecurrenceMaterializePayloadMetadataOnly(
           job.data as unknown as Record<string, unknown>
         )
       ) {
         throw new Error(`Recurrence job ${job.id} contains non-metadata payload fields`);
       }
       const rolledForward = await rollForwardOwnedSeries(scopedDb);
       const result = { rolledForward };
       options.onRecurrenceResult?.(job, result);
       return result;
     },
     options.workOptions
   );

   return [workId, recurrenceWorkId];
   ```

   No `module-registry` change is required — its tasks `registerWorkers` already calls
   `registerTasksJobWorkers(boss, deps.dataContext)` and accepts the returned id array.

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/jobs.ts tests/integration/tasks.test.ts tests/integration/tasks-helpers.ts
   git commit -m "feat(tasks): recurrence worker handler — RLS-scoped roll-forward (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 11 — Enable the pg-boss cron engine in the worker process (shared, idempotent)

**Files:** modify `apps/worker/src/worker.ts`.

> **SHARED FOUNDATION — land idempotently.** The briefings and sync slices also want
> `{ schedule: true }`. Make this change tolerant of already being applied. If, at build time,
> `apps/worker/src/worker.ts:46` already reads `createPgBossClient(connectionString, { schedule: true })`,
> this task is a **no-op** — skip the edit and note it in the PR. Otherwise apply the one-line change.

> **Verified default (Codex finding):** `apps/worker/src/worker.ts:46` currently reads
> `const boss = createPgBossClient(connectionString);` (NO second arg), and `createPgBossClient`
> defaults `schedule: false` (`packages/jobs/src/pg-boss.ts:118`). So the edit IS needed on the
> current tree; the "no-op if already applied" clause only protects against a sibling slice landing
> first.

**Steps:**

1. Add a NON-FLAKY unit test (Codex finding: prove the seam, not a cron tick) — create
   `tests/unit/jobs-cron-engine-knob.test.ts`. It mocks the `pg-boss` named `PgBoss` export to capture the
   constructor options, then asserts the **default** `createPgBossClient` is `schedule: false` and an
   **override** flips it to `true`. This proves the API/default boss never enables the engine while the
   worker's override does, with no DB and no timing:

   ```ts
   import { describe, expect, it, vi } from "vitest";

   const ctorOptions: Array<Record<string, unknown>> = [];
   // pg-boss is imported as a NAMED export in packages/jobs/src/pg-boss.ts (`import { PgBoss }
   // from "pg-boss"`), so the mock must expose `PgBoss`, not `default`.
   vi.mock("pg-boss", () => ({
     PgBoss: class {
       constructor(opts: Record<string, unknown>) {
         ctorOptions.push(opts);
       }
       on() {}
     }
   }));

   describe("createPgBossClient cron-engine knob", () => {
     it("defaults schedule:false and honors a schedule:true override", async () => {
       const { createPgBossClient } = await import("@jarv1s/jobs");
       createPgBossClient("postgres://x");
       expect(ctorOptions.at(-1)).toMatchObject({ schedule: false });
       createPgBossClient("postgres://x", { schedule: true });
       expect(ctorOptions.at(-1)).toMatchObject({ schedule: true });
     });
   });
   ```

   > Confirm `@jarv1s/jobs` re-exports `createPgBossClient` and that `pg-boss` is imported as the
   > NAMED `PgBoss` export in `pg-boss.ts` (it is — `import { PgBoss } from "pg-boss"; new PgBoss({...})`).
   > If the package mocks awkwardly under the workspace alias, place the test in `packages/jobs` and
   > import the local module path. The point is a deterministic assertion of the option, never a real
   > cron fire.

2. Run and SEE pass (default branch) — it already asserts the seam; the worker edit below makes the
   worker consume it:

   ```sh
   pnpm test:unit -- tests/unit/jobs-cron-engine-knob.test.ts
   ```

3. Apply the change at `apps/worker/src/worker.ts:46`:

   ```ts
   // pg-boss cron engine is enabled ONLY here, in the single long-lived worker process,
   // so scheduled jobs (recurrence materialization, scheduled briefings) fire in exactly
   // one place. The API server's boss stays schedule:false. Shared foundation knob — see
   // docs/superpowers/specs/2026-06-13-phase3-task-verticals-finished.md "Shared cron foundation".
   const boss = createPgBossClient(connectionString, { schedule: true });
   ```

4. Run:

   ```sh
   pnpm typecheck && pnpm test:unit -- tests/unit/jobs-cron-engine-knob.test.ts
   ```

5. Commit:

   ```sh
   git add apps/worker/src/worker.ts tests/unit/jobs-cron-engine-knob.test.ts
   git commit -m "feat(worker): enable pg-boss cron engine in the worker process (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase D — Tag assignment contract (the single ripple — land once)

### Task 12 — `TaskDto.tags` + contract schemas (reorder `taskTagDtoSchema`) + serializer default (atomic, typecheck stays green)

**Files:** modify `packages/shared/src/tasks-api.ts`, `packages/tasks/src/serialize.ts`,
`tests/e2e/mock-api.ts`.

> **Compile trap (spec Open Risk #3):** `taskDtoSchema` (line ~129) is declared **before**
> `taskTagDtoSchema` (line ~460). Referencing `taskTagDtoSchema` inside `taskDtoSchema` requires
> moving `TaskTagDto` + `taskTagDtoSchema` **above** `taskDtoSchema`. Do the move; do not inline.

> **KEEP TYPECHECK GREEN PER COMMIT (Codex finding).** An overnight autonomous build must not leave
> `pnpm typecheck` red across commits (red commits poison `git bisect` and any mid-run gate). The
> original plan deferred green typecheck from T12 to T16. Instead, this task lands the **three changes
> that together keep the contract compiling in one atomic commit**: (1) `TaskDto.tags` + schema, (2)
> `serializeTask(task, tags = [])` with a default so **every existing caller still compiles**, and (3)
> the e2e `createMockTask` `tags: []` (a TS object literal that would otherwise miss the new required
> field). Real tag population at the call sites still lands incrementally in T14–T18, but each of those
> commits also typechecks because the default makes `tags` optional **to the caller**. Net: `pnpm
> typecheck` is green after EVERY commit from T12 onward.

**Steps:**

1. Add a failing **typecheck-driven** assertion. Because contracts are compile-time, add a tiny type
   test in `tests/unit/` — `tasks-contract-tags.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import { taskDtoSchema } from "@jarv1s/shared";
   import type { TaskDto } from "@jarv1s/shared";

   describe("TaskDto.tags contract", () => {
     it("taskDtoSchema requires tags", () => {
       expect(taskDtoSchema.required).toContain("tags");
       expect(taskDtoSchema.properties).toHaveProperty("tags");
     });
     it("TaskDto type carries tags (compile check)", () => {
       const dto: TaskDto = {
         id: "t", ownerUserId: "u", listId: "l", parentTaskId: null, title: "x",
         description: null, status: "todo", priority: null, position: 0, dueAt: null,
         doAt: null, effort: null, source: "manual", sourceRef: null, completedAt: null,
         createdAt: null, updatedAt: null, tags: []
       };
       expect(dto.tags).toEqual([]);
     });
   });
   ```

2. Run and SEE fail:

   ```sh
   pnpm test:unit -- tests/unit/tasks-contract-tags.test.ts
   ```

3. Implementation in `packages/shared/src/tasks-api.ts`:

   a. **Move** the `TaskTagDto` interface and `taskTagDtoSchema` const (currently in the "Task Tags"
   section ~lines 440–470) to **above** `taskDtoSchema` (before line ~129). Keep their full content
   identical. Leave the rest of the "Task Tags" section (responses/requests) where it is.

   b. Add `tags` to the `TaskDto` interface:

   ```ts
   readonly tags: readonly TaskTagDto[];
   ```

   c. Add `"tags"` to `taskDtoSchema.required` and a `tags` property:

   ```ts
   // in required: [...]
   "updatedAt",
   "tags"
   // in properties: { ... }
   updatedAt: nullableStringSchema,
   tags: { type: "array", items: taskTagDtoSchema }
   ```

   d. **In the same commit**, add the `tags = []` default to `serializeTask` so every existing caller
   keeps compiling. In `packages/tasks/src/serialize.ts` (the full join wiring is T14; HERE just add
   the parameter + default + the `tags` field so the return type satisfies the new `TaskDto`):

   ```ts
   import type { Task, TaskActivity, TaskList, TaskPreferences, TaskTag } from "@jarv1s/db";
   // ...
   export function serializeTask(task: Task, tags: readonly TaskTag[] = []): TaskDto {
     return {
       // ...all existing fields unchanged...
       updatedAt: serializeDate(task.updated_at),
       tags: tags.map(serializeTaskTag)
     };
   }
   ```

   (Confirm `serializeTaskTag` is already exported from `serialize.ts`; it is the mapper used by the
   existing tag responses. T14 only *uses* this signature from new call sites — it does not re-declare
   it.)

   e. **In the same commit**, add `tags: []` to `tests/e2e/mock-api.ts` `createMockTask` (before the
   `...overrides` spread) so the mock object literal satisfies the new required field and the web/e2e
   typecheck stays green (the richer mock handlers land in T25):

   ```ts
   updatedAt: "2026-06-06T12:00:00.000Z",
   tags: [],
   ...overrides
   ```

4. Run and SEE pass — AND run the FULL typecheck, which **must be green** now (contract + serializer
   default + mock literal all landed together):

   ```sh
   pnpm test:unit -- tests/unit/tasks-contract-tags.test.ts && pnpm typecheck
   ```

   If typecheck is red, a `serializeTask` caller is passing a positional arg that conflicts, or a DTO
   literal elsewhere is missing `tags` — fix it in THIS commit (grep `serializeTask(` and `: TaskDto`)
   so no red commit is created.

5. Commit:

   ```sh
   git add packages/shared/src/tasks-api.ts packages/tasks/src/serialize.ts tests/e2e/mock-api.ts tests/unit/tasks-contract-tags.test.ts
   git commit -m "feat(shared): TaskDto.tags + serializeTask default + reorder schema (typecheck green) (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 13 — Add assign/unassign + rename/delete contract schemas

**Files:** modify `packages/shared/src/tasks-api.ts`.

**Steps:**

1. Add a failing unit assertion in `tests/unit/tasks-contract-tags.test.ts`:

   ```ts
   import {
     assignTaskTagRequestSchema,
     assignTaskTagRouteSchema,
     unassignTaskTagRouteSchema,
     renameTaskListRequestSchema,
     deleteTaskListRequestSchema,
     renameTaskTagRequestSchema,
     taskTagParamsSchema
   } from "@jarv1s/shared";

   it("exposes the assign/rename/delete schemas", () => {
     expect(assignTaskTagRequestSchema.required).toContain("tagId");
     expect(deleteTaskListRequestSchema.properties).toHaveProperty("reassignToListId");
     expect(renameTaskListRequestSchema.required).toContain("name");
     expect(renameTaskTagRequestSchema.required).toContain("name");
     expect(taskTagParamsSchema.required).toEqual(["id", "tagId"]);
     expect(assignTaskTagRouteSchema.response[200]).toBeDefined();
     expect(unassignTaskTagRouteSchema.response[200]).toBeDefined();
   });
   ```

2. Run and SEE fail.

3. Implementation — append to `packages/shared/src/tasks-api.ts` (COMPLETE code):

   ```ts
   // --- Tag assignment ---

   export interface AssignTaskTagRequest {
     readonly tagId: string;
   }

   export const assignTaskTagRequestSchema = {
     type: "object",
     additionalProperties: false,
     required: ["tagId"],
     properties: { tagId: { type: "string" } }
   } as const;

   // params for DELETE /api/tasks/:id/tags/:tagId
   export const taskTagParamsSchema = {
     type: "object",
     additionalProperties: false,
     required: ["id", "tagId"],
     properties: { id: { type: "string" }, tagId: { type: "string" } }
   } as const;

   export const assignTaskTagRouteSchema = {
     params: taskParamsSchema,
     body: assignTaskTagRequestSchema,
     response: { 200: getTaskResponseSchema }
   } as const;

   export const unassignTaskTagRouteSchema = {
     params: taskTagParamsSchema,
     response: { 200: getTaskResponseSchema }
   } as const;

   // --- List/tag rename + delete ---

   export interface RenameTaskListRequest {
     readonly name: string;
   }
   export interface DeleteTaskListRequest {
     readonly reassignToListId?: string;
   }
   export interface RenameTaskTagRequest {
     readonly name: string;
   }

   export const renameTaskListRequestSchema = {
     type: "object",
     additionalProperties: false,
     required: ["name"],
     properties: { name: { type: "string" } }
   } as const;

   export const deleteTaskListRequestSchema = {
     type: "object",
     additionalProperties: false,
     properties: { reassignToListId: { type: "string" } }
   } as const;

   export const renameTaskTagRequestSchema = {
     type: "object",
     additionalProperties: false,
     required: ["name"],
     properties: { name: { type: "string" } }
   } as const;

   // params for /api/tasks/lists/:listId/tags/:tagId
   export const taskListTagParamsSchema = {
     type: "object",
     additionalProperties: false,
     required: ["listId", "tagId"],
     properties: { listId: { type: "string" }, tagId: { type: "string" } }
   } as const;

   export const renameTaskListRouteSchema = {
     params: taskListParamsSchema,
     body: renameTaskListRequestSchema,
     response: { 200: createTaskListResponseSchema }
   } as const;

   export const deleteTaskListRouteSchema = {
     params: taskListParamsSchema,
     body: deleteTaskListRequestSchema,
     response: { 200: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean" } } } }
   } as const;

   export const renameTaskTagRouteSchema = {
     params: taskListTagParamsSchema,
     body: renameTaskTagRequestSchema,
     response: { 200: createTaskTagResponseSchema }
   } as const;

   export const deleteTaskTagRouteSchema = {
     params: taskListTagParamsSchema,
     response: { 200: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean" } } } }
   } as const;
   ```

   These reference `taskParamsSchema`, `taskListParamsSchema`, `getTaskResponseSchema`,
   `createTaskListResponseSchema`, `createTaskTagResponseSchema` — all already defined above.

4. Run and SEE pass:

   ```sh
   pnpm test:unit -- tests/unit/tasks-contract-tags.test.ts
   ```

5. Commit:

   ```sh
   git add packages/shared/src/tasks-api.ts tests/unit/tasks-contract-tags.test.ts
   git commit -m "feat(shared): assign/unassign + list/tag rename/delete contract schemas (#40 #41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase E — Tag assignment: repository + serialize + read join

### Task 14 — tag-join helpers (serializer default already in T12)

**Files:** modify `packages/tasks/src/repository.ts`. (The `serializeTask` default-`tags` signature
landed in Task 12; do not re-edit `serialize.ts` here.)

**Steps:**

1. Add a failing integration test (DB-backed, proves the join + serialize):

   This test must be **runnable at Task 14's position** — `assignTag` does NOT exist until Task 17, so
   the assignment row is created with a **direct insert** (Codex finding: the snippet must not call a
   method that does not yet exist):

   ```ts
   it("getById and listVisible return joined tags (direct-insert assignment)", async () => {
     const list = await dataContext.withDataContext(userAContext(), (db) =>
       listsRepo.getOrCreate(db, "Travel")
     );
     const tag = await dataContext.withDataContext(userAContext(), (db) =>
       listsRepo.createTag(db, list.id, "Urgent")
     );
     const task = await dataContext.withDataContext(userAContext(), (db) =>
       repository.create(db, { title: "book flights", listId: list.id })
     );
     // assignTag lands in Task 17; insert the assignment directly so Task 14 runs in order.
     await dataContext.withDataContext(userAContext(), (db) =>
       db.db
         .insertInto("app.task_tag_assignments")
         .values({ task_id: task.id, tag_id: tag.id })
         .execute()
     );

     const tags = await dataContext.withDataContext(userAContext(), (db) =>
       repository.getTagsForTask(db, task.id)
     );
     expect(tags.map((t) => t.id)).toContain(tag.id);

     const map = await dataContext.withDataContext(userAContext(), (db) =>
       repository.getTagsForTasks(db, [task.id])
     );
     expect(map.get(task.id)?.length).toBe(1);
   });
   ```

   (`listsRepo` is the existing `TaskListsRepository` instance in the suite. The same-list-trigger
   behavior of `assignTag` is proven separately in Task 17, which owns that method.)

2. Run and SEE fail (`getTagsForTask`/`getTagsForTasks` missing):

   ```sh
   pnpm test:tasks
   ```

3. Implementation:

   > **`serializeTask(task, tags = [])` already landed in Task 12** (with the contract, to keep
   > typecheck green). This task does NOT re-declare it — it only adds the repository join helpers and
   > the integration test that proves the join feeds `serializeTask`. (If, for any reason, T12 was not
   > yet applied when you reach here, apply the serializer default first — but do not duplicate it.)

   In `packages/tasks/src/repository.ts`, add the join helpers (COMPLETE):

   ```ts
   import type { TaskTag } from "@jarv1s/db";
   // ...
   async getTagsForTask(scopedDb: DataContextDb, taskId: string): Promise<TaskTag[]> {
     assertDataContextDb(scopedDb);
     return scopedDb.db
       .selectFrom("app.task_tag_assignments as a")
       .innerJoin("app.task_tags as g", "g.id", "a.tag_id")
       .selectAll("g")
       .where("a.task_id", "=", taskId)
       .orderBy("g.name")
       .execute();
   }

   /** Batch fetch tags for many tasks in ONE grouped query (avoids N+1). */
   async getTagsForTasks(
     scopedDb: DataContextDb,
     taskIds: readonly string[]
   ): Promise<Map<string, TaskTag[]>> {
     assertDataContextDb(scopedDb);
     const map = new Map<string, TaskTag[]>();
     if (taskIds.length === 0) return map;
     const rows = await scopedDb.db
       .selectFrom("app.task_tag_assignments as a")
       .innerJoin("app.task_tags as g", "g.id", "a.tag_id")
       .select([
         "a.task_id as task_id",
         "g.id as id",
         "g.owner_user_id as owner_user_id",
         "g.list_id as list_id",
         "g.name as name",
         "g.created_at as created_at"
       ])
       .where("a.task_id", "in", taskIds as string[])
       .orderBy("g.name")
       .execute();
     for (const row of rows) {
       const { task_id, ...tag } = row;
       const arr = map.get(task_id) ?? [];
       arr.push(tag as unknown as TaskTag);
       map.set(task_id, arr);
     }
     return map;
   }
   ```

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/repository.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): batched tag-join helpers (getTagsForTask/getTagsForTasks, no N+1) (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 15 — Wire tags into the assistant tools (read-only) call sites

**Files:** modify `packages/tasks/src/tools.ts`.

**Steps:**

1. Add a failing integration test in `tests/integration/tasks-tools.test.ts` (or `tasks.test.ts` if
   the tools suite imports differ) asserting `tasks.get` returns the task's tags:

   ```ts
   it("tasks.get returns the task's tags", async () => {
     // set up a tag-assigned task (reuse helper / direct insert), then:
     const result = await dataContext.withDataContext(userAContext(), (db) =>
       taskGetExecute(db, { taskId: task.id }, ctx)
     );
     const data = result.data as { task: { tags: { id: string }[] } };
     expect(data.task.tags.map((t) => t.id)).toContain(tag.id);
   });
   ```

2. Run and SEE fail.

3. Implementation in `packages/tasks/src/tools.ts` — pass joined tags at every `serializeTask` call
   site (COMPLETE pattern; apply to `taskListExecute`, `taskGetExecute`, focus/at-risk/overdue,
   subtasks within `taskGetExecute`):

   For list-shaped executors, batch:

   ```ts
   const tagMap = await repository.getTagsForTasks(scopedDb, tasks.map((t) => t.id));
   return {
     data: { items: tasks.map((t) => serializeTask(t, tagMap.get(t.id) ?? [])) },
     columnOrder: ["id", "title", "status", "dueAt", "priority"]
   };
   ```

   For `taskGetExecute`:

   ```ts
   const [tags, subtaskTagMap] = await Promise.all([
     repository.getTagsForTask(scopedDb, taskId),
     repository.getTagsForTasks(scopedDb, subtasks.map((s) => s.id))
   ]);
   return {
     data: {
       task: serializeTask(task, tags),
       subtasks: subtasks.map((s) => serializeTask(s, subtaskTagMap.get(s.id) ?? [])),
       activity: activity.slice(-10).map(serializeTaskActivity)
     }
   };
   ```

   The tools stay **read-only** — no new write tool is added (foundation decision).

4. Run and SEE pass:

   ```sh
   pnpm test:tasks-tools
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/tools.ts tests/integration/tasks-tools.test.ts
   git commit -m "feat(tasks): assistant read tools serialize tags (no N+1) (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 16 — Wire tags into all route `serializeTask` call sites + lazy-on-view roll-forward

**Files:** modify `packages/tasks/src/routes.ts`, `packages/tasks/src/repository.ts`.

**Steps:**

1. Add a failing integration test hitting the HTTP layer (the suite has a Fastify `server`) — assert
   `GET /api/tasks` returns `tags` on each task and that opening the list rolls a stale series forward
   (lazy-on-view):

   ```ts
   it("GET /api/tasks returns tags and rolls a stale recurring series forward (lazy-on-view)", async () => {
     const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
     const today = new Date().toISOString().slice(0, 10);
     const made = await dataContext.withDataContext(userAContext(), (db) =>
       repository.create(db, {
         title: "lazy roll",
         recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
       })
     );
     const res = await server.inject({
       method: "GET",
       url: "/api/tasks",
       headers: { /* the suite's userA auth headers */ }
     });
     expect(res.statusCode).toBe(200);
     const body = res.json() as { tasks: { id: string; tags: unknown[] }[] };
     expect(body.tasks.every((t) => Array.isArray(t.tags))).toBe(true);

     const live = await dataContext.withDataContext(userAContext(), (db) =>
       db.db.selectFrom("app.tasks").selectAll()
         .where("recurrence_series_id", "=", made.recurrence_series_id!)
         .where("status", "=", "todo").execute()
     );
     const occ = (live[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
     expect(occ >= today).toBe(true);
   });
   ```

   (Use the suite's existing auth-header pattern for `server.inject`; copy from an existing
   `server.inject` task call in `tasks.test.ts`.)

2. Run and SEE fail.

3. Implementation:

   a. In `packages/tasks/src/repository.ts`, make `listVisible` run roll-forward first (lazy-on-view
   safety net), then read, returning tasks (tags are joined at the route via `getTagsForTasks`):

   ```ts
   async listVisible(scopedDb: DataContextDb): Promise<Task[]> {
     assertDataContextDb(scopedDb);
     await rollForwardOwnedSeries(scopedDb); // lazy-on-view freshness; no-op when nothing stale
     return scopedDb.db
       .selectFrom("app.tasks")
       .selectAll()
       .orderBy("updated_at", "desc")
       .orderBy("id")
       .execute();
   }
   ```

   Add the import: `import { generateNext, rollForwardOwnedSeries } from "./recurrence.js";`.

   Also call `rollForwardOwnedSeries(scopedDb)` once at the start of the drift reads' shared path so
   focus/at-risk/overdue see corrected rows — add it to `TaskDriftRepository.getFocus`/`getAtRisk`/
   `getOverdue` (or a shared private prelude) in `packages/tasks/src/drift.ts`. Keep it a single call
   per request.

   b. In `packages/tasks/src/routes.ts`, update **every** `serializeTask` / `tasks.map(serializeTask)`
   call site to pass joined tags. For list responses, batch with `getTagsForTasks`; for single-task
   responses (`POST`, `GET /:id`, `PATCH /:id`), use `getTagsForTask`. The call sites to fix (8):
   `GET /api/tasks` (after `filterByQuadrant`), `POST /api/tasks`, `GET /api/tasks/:id`,
   `PATCH /api/tasks/:id`, `GET /api/tasks/:id/subtasks`, `POST /api/tasks/:id/breakdown`,
   `GET /api/tasks/focus`, `GET /api/tasks/at-risk`, `GET /api/tasks/overdue`.

   Pattern for the list route (do the tag fetch INSIDE the same `withDataContext` as the read so it is
   RLS-scoped; refactor the handler to return both tasks and tagMap, or fetch tags in a second
   `withDataContext` call keyed off the returned ids — prefer the former for a single scope):

   ```ts
   const { tasks, tagMap } = await dependencies.dataContext.withDataContext(
     accessContext,
     async (scopedDb) => {
       const rows = await repository.listVisible(scopedDb);
       const map = await repository.getTagsForTasks(scopedDb, rows.map((r) => r.id));
       return { tasks: rows, tagMap: map };
     }
   );
   const filtered = quadrant ? filterByQuadrant(tasks, quadrant) : tasks;
   return { tasks: filtered.map((t) => serializeTask(t, tagMap.get(t.id) ?? [])) };
   ```

   For single-task routes:

   ```ts
   const { task, tags } = await dependencies.dataContext.withDataContext(
     accessContext,
     async (scopedDb) => {
       const row = await repository.getById(scopedDb, request.params.id);
       const t = row ? await repository.getTagsForTask(scopedDb, row.id) : [];
       return { task: row, tags: t };
     }
   );
   if (!task) return reply.code(404).send({ error: "Task not found" });
   return { task: serializeTask(task, tags) };
   ```

4. Run and SEE pass; then run the FULL typecheck — it now goes green (all `serializeTask` callers
   updated):

   ```sh
   pnpm test:tasks && pnpm typecheck
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/routes.ts packages/tasks/src/repository.ts packages/tasks/src/drift.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): routes serialize tags + lazy-on-view roll-forward (#40 #48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase F — Tag assignment routes + tagId filter

### Task 17 — `assignTag` / `unassignTag` repository methods

**Files:** modify `packages/tasks/src/lists.ts`; modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Failing test — assign a same-list tag succeeds; a cross-list tag throws (trigger):

   ```ts
   it("assignTag enforces same-list via trigger; unassignTag removes", async () => {
     const listA = await dataContext.withDataContext(userAContext(), (db) => listsRepo.getOrCreate(db, "A"));
     const listB = await dataContext.withDataContext(userAContext(), (db) => listsRepo.getOrCreate(db, "B"));
     const tagB = await dataContext.withDataContext(userAContext(), (db) => listsRepo.createTag(db, listB.id, "X"));
     const task = await dataContext.withDataContext(userAContext(), (db) => repository.create(db, { title: "t", listId: listA.id }));

     await expect(
       dataContext.withDataContext(userAContext(), (db) => listsRepo.assignTag(db, task.id, tagB.id))
     ).rejects.toThrow(); // cross-list rejected by task_tag_list_match trigger

     const tagA = await dataContext.withDataContext(userAContext(), (db) => listsRepo.createTag(db, listA.id, "Y"));
     await dataContext.withDataContext(userAContext(), (db) => listsRepo.assignTag(db, task.id, tagA.id));
     let tags = await dataContext.withDataContext(userAContext(), (db) => repository.getTagsForTask(db, task.id));
     expect(tags.map((t) => t.id)).toContain(tagA.id);

     await dataContext.withDataContext(userAContext(), (db) => listsRepo.unassignTag(db, task.id, tagA.id));
     tags = await dataContext.withDataContext(userAContext(), (db) => repository.getTagsForTask(db, task.id));
     expect(tags).toHaveLength(0);

     // Deterministic 404 for a missing task / missing tag (not a raw 500).
     await expect(
       dataContext.withDataContext(userAContext(), (db) =>
         listsRepo.assignTag(db, "00000000-0000-0000-0000-000000000000", tagA.id)
       )
     ).rejects.toMatchObject({ statusCode: 404 });
     await expect(
       dataContext.withDataContext(userAContext(), (db) =>
         listsRepo.assignTag(db, task.id, "00000000-0000-0000-0000-000000000000")
       )
     ).rejects.toMatchObject({ statusCode: 404 });
   });
   ```

   (`HttpError` is `@jarv1s/module-sdk`'s class with a positional ctor `new HttpError(statusCode,
   message)` and a `.statusCode` field — verified at `packages/module-sdk/src/route-errors.ts:12`.
   All `HttpError(409, …)` / `HttpError(404, …)` calls in this plan are correct positional usage.)

2. Run and SEE fail.

3. Implementation — add to `TaskListsRepository` in `packages/tasks/src/lists.ts` (COMPLETE):

   ```ts
   import { HttpError } from "./errors.js";
   // ...
   async assignTag(db: DataContextDb, taskId: string, tagId: string): Promise<void> {
     assertDataContextDb(db);

     // Deterministic precheck (Codex finding): map a missing/foreign task or tag to 404 instead
     // of letting a raw RLS/FK failure surface as a 500. The task precheck requires OWNERSHIP
     // (owner_user_id = app.current_actor_user_id()), NOT mere visibility — the
     // task_tag_assignments_rw policy (0062_task_tag_assignments_ownership.sql) gates the INSERT
     // on parent-task OWNERSHIP, so a manage-SHARED task is visible via tasks_select yet would
     // fail the assignment WITH CHECK as a raw 500. Prechecking ownership returns a clean 404.
     const task = await db.db
       .selectFrom("app.tasks")
       .select("id")
       .where("id", "=", taskId)
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .executeTakeFirst();
     if (!task) throw new HttpError(404, "Task not found or not accessible");
     const tag = await db.db
       .selectFrom("app.task_tags")
       .select("id")
       .where("id", "=", tagId)
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .executeTakeFirst();
     if (!tag) throw new HttpError(404, "Tag not found or not accessible");

     try {
       await db.db
         .insertInto("app.task_tag_assignments")
         .values({ task_id: taskId, tag_id: tagId })
         .onConflict((oc) => oc.doNothing())
         .execute();
     } catch (err: unknown) {
       if (err instanceof HttpError) throw err;
       const message = err instanceof Error ? err.message : String(err);
       // task_tag_list_match trigger message is exactly: tag must belong to the task's list
       if (message.includes("tag must belong to the task")) {
         throw new HttpError(400, "tag must belong to the task's list");
       }
       throw err;
     }
   }

   async unassignTag(db: DataContextDb, taskId: string, tagId: string): Promise<void> {
     assertDataContextDb(db);
     // Ownership precheck (Codex finding): a visible-but-not-owned task would otherwise yield a
     // silent no-op delete + misleading 200. Require ownership and surface 404 deterministically.
     const owned = await db.db
       .selectFrom("app.tasks")
       .select("id")
       .where("id", "=", taskId)
       .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
       .executeTakeFirst();
     if (!owned) throw new HttpError(404, "Task not found or not accessible");
     await db.db
       .deleteFrom("app.task_tag_assignments")
       .where("task_id", "=", taskId)
       .where("tag_id", "=", tagId)
       .execute();
   }
   ```

   > **Import note:** `assignTag`/`unassignTag` now use `sql` — ensure `lists.ts` imports it:
   > `import { sql } from "kysely";` (add if not already present; verify with
   > `grep -n "from \"kysely\"" packages/tasks/src/lists.ts`).

   > Note: the test asserts `rejects.toThrow()` for the cross-list case. Depending on whether the PG
   > trigger message survives to the catch, the throw may be a raw error or the mapped `HttpError(400)`.
   > Either satisfies `rejects.toThrow()`. At the route layer (Task 18) `HttpError(400)` is surfaced.

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/lists.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): assignTag/unassignTag repository methods (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 17b — Moving a task to another list drops its foreign tags (integrity gap)

**Files:** modify `packages/tasks/src/repository.ts`; modify `tests/integration/tasks.test.ts`.

> **Same-list integrity is enforced only at assignment time (Codex finding, verified against
> `packages/tasks/sql/0039_tasks_foundation.sql:116-130` and `packages/tasks/src/repository.ts:172`).**
> The `task_tag_list_match` trigger fires only on `INSERT OR UPDATE` of `app.task_tag_assignments`.
> `TasksRepository.update` lets the caller change `list_id` (a task move) but does **not** touch
> assignments — so after a move, the task keeps tags belonging to its OLD list, silently violating the
> "a task's tags belong to its list" invariant. The delete-with-reassign path (Task 19) already drops
> foreign tags; the ordinary move path must do the same for consistency.

**Steps:**

1. Failing integration test — moving a task to a new list drops tags not present in the destination:

   ```ts
   it("moving a task to another list drops tags foreign to the destination", async () => {
     const listA = await dataContext.withDataContext(userAContext(), (db) => listsRepo.getOrCreate(db, "A1"));
     const listB = await dataContext.withDataContext(userAContext(), (db) => listsRepo.getOrCreate(db, "B1"));
     const tagA = await dataContext.withDataContext(userAContext(), (db) => listsRepo.createTag(db, listA.id, "only-A"));
     const task = await dataContext.withDataContext(userAContext(), (db) => repository.create(db, { title: "mover", listId: listA.id }));
     await dataContext.withDataContext(userAContext(), (db) => listsRepo.assignTag(db, task.id, tagA.id));

     await dataContext.withDataContext(userAContext(), (db) =>
       repository.update(db, task.id, { listId: listB.id })
     );

     const tags = await dataContext.withDataContext(userAContext(), (db) =>
       repository.getTagsForTask(db, task.id)
     );
     expect(tags).toHaveLength(0); // tagA belonged to listA, dropped on move to listB
   });
   ```

2. Run and SEE fail (the move currently leaves the foreign assignment, which would also make a later
   re-assert trip the trigger).

3. Implementation — in `packages/tasks/src/repository.ts` `update`, when `input.listId` changes the
   task's list, the foreign-tag drop and the `list_id` move MUST be **atomic** (Codex finding): a
   committed move with a failed cleanup would leave the task moved with foreign tags.

   > **ATOMICITY IS ALREADY PROVIDED — do NOT open a nested transaction (verified against
   > `packages/db/src/data-context.ts:48-53`).** `withDataContext` runs its whole callback inside a
   > single `rootDb.transaction().execute(...)`, and `scopedDb.db` **IS** that `Transaction` object
   > (the actor GUC is `set_local` on it). So every statement in `repository.update` already shares one
   > transaction — the foreign-tag delete and the `list_id` update commit or roll back together with
   > no extra ceremony. Calling `scopedDb.db.transaction()` would attempt an **unsupported nested
   > transaction** — do not do it. The only required change is **ordering**: drop foreign tags **before**
   > the `list_id` update so a failure of either rolls the whole ambient transaction back cleanly.

   Add the drop immediately **before** the existing `updateTable("app.tasks").set(updates)` statement,
   guarded on a real list change (COMPLETE):

   ```ts
   // List move: drop assignments whose tag does not belong to the destination list, BEFORE the
   // move. Same ambient transaction as the rest of update() (withDataContext wraps the callback
   // in one transaction; scopedDb.db is that Transaction), so this is atomic with the move —
   // no nested transaction. Preserves the same-list invariant the task_tag_list_match trigger
   // enforces at assignment time. Matches the delete-with-reassign drop rule (Task 19).
   if (input.listId !== undefined) {
     await scopedDb.db
       .deleteFrom("app.task_tag_assignments")
       .where("task_id", "=", taskId)
       .where((eb) =>
         eb(
           "tag_id",
           "not in",
           eb.selectFrom("app.task_tags").select("id").where("list_id", "=", input.listId!)
         )
       )
       .execute();
   }

   // ...then the EXISTING update statement, unchanged:
   // const updated = await scopedDb.db.updateTable("app.tasks").set(updates)
   //   .where("id", "=", taskId).returningAll().executeTakeFirst();
   ```

   > Use the same Kysely expression-builder subquery form as Task 19's `deleteList` reassign drop; if
   > the `eb(...)` form differs in this Kysely version, fall back to a two-step fetch-then-delete (still
   > inside the ambient transaction). The delete is RLS-scoped and only touches THIS task's assignments.
   > Keep the existing downstream `updated` uses (completion cascade, `generateNext`) intact.

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/repository.ts tests/integration/tasks.test.ts
   git commit -m "fix(tasks): moving a task to another list drops foreign tags (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 18 — Tag assign/unassign routes + `tagId` list filter + manifest registration

**Files:** modify `packages/tasks/src/routes.ts`, `packages/tasks/src/manifest.ts`;
modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Failing HTTP tests:
   - `POST /api/tasks/:id/tags { tagId }` returns the task with `tags` containing it.
   - `DELETE /api/tasks/:id/tags/:tagId` returns the task without it.
   - cross-list assign returns `400`.
   - `GET /api/tasks?tagId=` returns only tasks carrying that assignment.

   (Model these on the existing `server.inject` patterns in the suite.)

2. Run and SEE fail.

3. Implementation:

   a. In `packages/tasks/src/routes.ts`, import the new schemas and add routes. Assign:

   ```ts
   server.post<{ Params: TaskParams }>(
     "/api/tasks/:id/tags",
     { schema: assignTaskTagRouteSchema },
     async (request, reply) => {
       try {
         const accessContext = await dependencies.resolveAccessContext(request);
         const body = requireObject(request.body);
         const tagId = requiredString(body["tagId"], "tagId");
         const { task, tags } = await dependencies.dataContext.withDataContext(
           accessContext,
           async (scopedDb) => {
             await listsRepository.assignTag(scopedDb, request.params.id, tagId);
             const row = await repository.getById(scopedDb, request.params.id);
             const t = row ? await repository.getTagsForTask(scopedDb, row.id) : [];
             return { task: row, tags: t };
           }
         );
         if (!task) return reply.code(404).send({ error: "Task not found" });
         return { task: serializeTask(task, tags) };
       } catch (error) {
         return handleRouteError(error, reply);
       }
     }
   );
   ```

   Unassign (`DELETE /api/tasks/:id/tags/:tagId`) — note the params type now includes `tagId`:

   ```ts
   server.delete<{ Params: { id: string; tagId: string } }>(
     "/api/tasks/:id/tags/:tagId",
     { schema: unassignTaskTagRouteSchema },
     async (request, reply) => {
       try {
         const accessContext = await dependencies.resolveAccessContext(request);
         const { task, tags } = await dependencies.dataContext.withDataContext(
           accessContext,
           async (scopedDb) => {
             await listsRepository.unassignTag(scopedDb, request.params.id, request.params.tagId);
             const row = await repository.getById(scopedDb, request.params.id);
             const t = row ? await repository.getTagsForTask(scopedDb, row.id) : [];
             return { task: row, tags: t };
           }
         );
         if (!task) return reply.code(404).send({ error: "Task not found" });
         return { task: serializeTask(task, tags) };
       } catch (error) {
         return handleRouteError(error, reply);
       }
     }
   );
   ```

   b. `tagId` filter on `GET /api/tasks` — parse alongside `quadrant`, filter inside the same
   `withDataContext`. **Validate the tag is visible/owned first (Codex finding):** a nonexistent or
   foreign `tagId` must yield a deterministic, documented result — here an **empty list** (the tag is
   not visible, so no task carries it under RLS). Probe the tag under RLS; if it does not resolve,
   short-circuit to an empty result rather than silently collapsing through the assignment join:

   ```ts
   const tagId = optionalString(query["tagId"], "tagId");
   // inside withDataContext, after listVisible:
   let rows = await repository.listVisible(scopedDb);
   if (tagId) {
     // RLS-scoped visibility probe: a foreign/nonexistent tag returns no row -> empty result.
     const tag = await scopedDb.db
       .selectFrom("app.task_tags")
       .select("id")
       .where("id", "=", tagId)
       .executeTakeFirst();
     if (!tag) {
       rows = [];
     } else {
       const tagged = await scopedDb.db
         .selectFrom("app.task_tag_assignments")
         .select("task_id")
         .where("tag_id", "=", tagId)
         .execute();
       const taggedSet = new Set(tagged.map((r) => r.task_id));
       rows = rows.filter((r) => taggedSet.has(r.id));
     }
   }
   const map = await repository.getTagsForTasks(scopedDb, rows.map((r) => r.id));
   ```

   The Task 18 failing tests add: `GET /api/tasks?tagId=<foreign/nonexistent>` returns `{ tasks: [] }`
   (documented empty semantics), and `?tagId=<owned>` returns only the tagged tasks.

   c. Register the two routes in `tasksModuleManifest.routes` with `permissionId: "tasks.update"`:

   ```ts
   {
     method: "POST",
     path: "/api/tasks/:id/tags",
     requestSchema: assignTaskTagRequestSchema,
     responseSchema: getTaskResponseSchema,
     permissionId: "tasks.update"
   },
   {
     method: "DELETE",
     path: "/api/tasks/:id/tags/:tagId",
     responseSchema: getTaskResponseSchema,
     permissionId: "tasks.update"
   }
   ```

   Import the new schemas in `manifest.ts` (`assignTaskTagRequestSchema`) and `routes.ts`
   (`assignTaskTagRouteSchema`, `unassignTaskTagRouteSchema`).

4. Run and SEE pass:

   ```sh
   pnpm test:tasks && pnpm typecheck
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/routes.ts packages/tasks/src/manifest.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): tag assign/unassign routes + tagId list filter (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase G — List/tag rename + delete: repository

### Task 19 — `renameList` + `deleteList` (409 + reassign + drop-foreign-tags + last-list guard)

**Files:** modify `packages/tasks/src/lists.ts`; modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Failing tests:
   - rename succeeds; duplicate name → `409`; not-owned → `404`.
   - delete a non-empty list without reassign → `409`.
   - delete with `reassignToListId` → tasks moved; tags from the OLD list dropped; list deleted.
   - delete the last remaining list → `409`.
   - delete a **non-existent/foreign** list (while the actor still has another list) → `404`, NOT 409
     (ordering: existence check precedes the last-list guard).
   - delete with `reassignToListId === listId` (self-reassign) → `400`, not a fall-through RESTRICT 409.

2. Run and SEE fail.

3. Implementation — add to `TaskListsRepository` (COMPLETE):

   ```ts
   async renameList(db: DataContextDb, listId: string, name: string): Promise<TaskList> {
     assertDataContextDb(db);
     try {
       const row = await db.db
         .updateTable("app.task_lists")
         .set({ name, updated_at: new Date() })
         .where("id", "=", listId)
         .returningAll()
         .executeTakeFirst();
       if (!row) throw new HttpError(404, "List not found or not accessible");
       return row;
     } catch (err: unknown) {
       const message = err instanceof Error ? err.message : String(err);
       if (message.includes("task_lists_owner_name_idx") || message.includes("unique")) {
         throw new HttpError(409, "A list with that name already exists");
       }
       throw err;
     }
   }

   async deleteList(
     db: DataContextDb,
     listId: string,
     reassignToListId?: string
   ): Promise<void> {
     // NOTE: this runs inside the ambient withDataContext transaction (db.db is the RLS-scoped
     // Transaction — data-context.ts:48-53), so the reassign drop + task move + list delete below
     // are already atomic. Do NOT open a nested transaction.
     assertDataContextDb(db);

     // 1. EXISTENCE/OWNERSHIP FIRST (Codex finding): a missing/foreign target must be 404,
     //    not a misleading 409 from the last-list guard below.
     const all = await db.db.selectFrom("app.task_lists").select("id").execute();
     if (!all.some((l) => l.id === listId)) {
       throw new HttpError(404, "List not found or not accessible");
     }

     // 2. Reject a no-op self-reassign (Codex finding): reassigning to the same list would
     //    be a no-op move that then falls through to an ON DELETE RESTRICT 409 — surface 400.
     if (reassignToListId !== undefined && reassignToListId === listId) {
       throw new HttpError(400, "Cannot reassign a list's tasks to itself");
     }

     // 3. Guard: refuse to delete the last remaining list.
     if (all.length <= 1) {
       throw new HttpError(409, "Cannot delete your only list");
     }

     if (reassignToListId) {
       const ownsDest = await this.isOwnedByActor(db, reassignToListId);
       if (!ownsDest) throw new HttpError(404, "Destination list not found or not accessible");

       // Drop assignments whose tag is not in the destination list (list move drops
       // foreign tags — foundation "List move" rule), THEN move the tasks.
       await db.db
         .deleteFrom("app.task_tag_assignments")
         .where((eb) =>
           eb(
             "task_id",
             "in",
             eb.selectFrom("app.tasks").select("id").where("list_id", "=", listId)
           )
         )
         .where((eb) =>
           eb(
             "tag_id",
             "not in",
             eb.selectFrom("app.task_tags").select("id").where("list_id", "=", reassignToListId)
           )
         )
         .execute();

       await db.db
         .updateTable("app.tasks")
         .set({ list_id: reassignToListId, updated_at: new Date() })
         .where("list_id", "=", listId)
         .execute();
     }

     try {
       const deleted = await db.db
         .deleteFrom("app.task_lists")
         .where("id", "=", listId)
         .returning("id")
         .executeTakeFirst();
       if (!deleted) throw new HttpError(404, "List not found or not accessible");
     } catch (err: unknown) {
       if (err instanceof HttpError) throw err;
       const message = err instanceof Error ? err.message : String(err);
       // ON DELETE RESTRICT (app.tasks.list_id FK) raises on a non-empty list.
       if (message.includes("foreign key") || message.includes("violates")) {
         throw new HttpError(409, "List is not empty");
       }
       throw err;
     }
   }
   ```

   > Verify the Kysely subquery-in-`where` syntax against the project's Kysely version; if the
   > `eb(...)` expression-builder form differs, use a raw `sql` predicate or two-step fetch-then-delete.
   > Keep behavior identical: delete only old-list assignments whose tag is absent from the dest list.

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/lists.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): renameList + deleteList (409/reassign/drop-foreign-tags/last-list guard) (#41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 20 — `renameTag` + `deleteTag` (cascade)

**Files:** modify `packages/tasks/src/lists.ts`; modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Failing tests: rename succeeds; duplicate name → `409`; delete cascades assignment rows.

2. Run and SEE fail.

3. Implementation — add to `TaskListsRepository` (COMPLETE):

   ```ts
   async renameTag(
     db: DataContextDb,
     listId: string,
     tagId: string,
     name: string
   ): Promise<TaskTag> {
     assertDataContextDb(db);
     try {
       const row = await db.db
         .updateTable("app.task_tags")
         .set({ name })
         .where("id", "=", tagId)
         .where("list_id", "=", listId)
         .returningAll()
         .executeTakeFirst();
       if (!row) throw new HttpError(404, "Tag not found or not accessible");
       return row;
     } catch (err: unknown) {
       if (err instanceof HttpError) throw err;
       const message = err instanceof Error ? err.message : String(err);
       if (message.includes("task_tags_list_name_idx") || message.includes("unique")) {
         throw new HttpError(409, "A tag with that name already exists in this list");
       }
       throw err;
     }
   }

   async deleteTag(db: DataContextDb, listId: string, tagId: string): Promise<void> {
     assertDataContextDb(db);
     const deleted = await db.db
       .deleteFrom("app.task_tags")
       .where("id", "=", tagId)
       .where("list_id", "=", listId)
       .returning("id")
       .executeTakeFirst();
     if (!deleted) throw new HttpError(404, "Tag not found or not accessible");
     // task_tag_assignments.tag_id FK is ON DELETE CASCADE — assignments are gone.
   }
   ```

4. Run and SEE pass:

   ```sh
   pnpm test:tasks
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/lists.ts tests/integration/tasks.test.ts
   git commit -m "feat(tasks): renameTag + deleteTag (cascade assignments) (#41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

> **File-size watch:** after Tasks 17–20, check `wc -l packages/tasks/src/lists.ts`. It started at
> 117 lines; the six new methods add ~150–200 lines — comfortably under 1000. If `routes.ts`
> (started 601) approaches the cap after Phase F/H, extract the tag-assign + list/tag CRUD handlers
> into a `packages/tasks/src/tags-routes.ts` invoked from `registerTasksRoutes`. Run
> `pnpm check:file-size` after each phase.

---

## Phase H — List/tag rename + delete: routes + schedule reconcile wiring

### Task 21 — Rename/delete routes + recurrence-schedule reconcile on create + list-load

**Files:** modify `packages/tasks/src/routes.ts`, `packages/tasks/src/manifest.ts`;
modify `tests/integration/tasks.test.ts`.

**Steps:**

1. Failing HTTP tests for the four routes:
   - `PATCH /api/tasks/lists/:listId { name }` → renamed list; duplicate → `409`; not-owned → `404`.
   - `DELETE /api/tasks/lists/:listId` → `409` when non-empty; with `{ reassignToListId }` → `200 { deleted: true }`.
   - `PATCH /api/tasks/lists/:listId/tags/:tagId { name }` → renamed tag; duplicate → `409`.
   - `DELETE /api/tasks/lists/:listId/tags/:tagId` → `200 { deleted: true }`, assignments cascaded.

   Plus a test that creating a recurring task triggers a schedule reconcile **without failing the
   request** even if `boss.schedule` throws (inject a boss stub whose `schedule` rejects; assert the
   create still returns 201). For the integration suite, simplest is a unit test of
   `reconcileRecurrenceSchedule` swallowing errors — already covered by its design; add a focused unit
   test in `tests/unit/`:

   ```ts
   it("reconcileRecurrenceSchedule swallows boss.schedule errors", async () => {
     const boss = { schedule: async () => { throw new Error("boom"); } } as unknown as PgBoss;
     await expect(reconcileRecurrenceSchedule(boss, ids.userA)).resolves.toBeUndefined();
   });

   it("reconcileRecurrenceSchedule upserts exactly one schedule row per actor", async () => {
     // Observability/cardinality (Codex finding): repeated reconciles keep ONE row per actor
     // (pgboss.schedule PRIMARY KEY (name, key=actorUserId)).
     await reconcileRecurrenceSchedule(workerBoss, ids.userA);
     await reconcileRecurrenceSchedule(workerBoss, ids.userA);
     const client = new Client({ connectionString: connectionStrings.bootstrap });
     await client.connect();
     try {
       const { rows } = await client.query(
         `SELECT count(*)::int AS n FROM pgboss.schedule
          WHERE name = 'tasks-recurrence-materialize' AND key = $1`,
         [ids.userA]
       );
       expect(rows[0].n).toBe(1);
     } finally {
       await client.end();
     }
   });
   ```

   > Confirm the `pgboss.schedule` table has a `key` column in the pinned pg-boss `^12.18.2` schema
   > (`SELECT column_name FROM information_schema.columns WHERE table_schema='pgboss' AND
   > table_name='schedule'`). If the column is named differently in this version, adjust the query and
   > the `ScheduleOptions` field in Task 9 to match the real schema — do not assume.

2. Run and SEE fail.

3. Implementation:

   a. In `packages/tasks/src/routes.ts`, add the four routes (rename list, delete list, rename tag,
   delete tag) mirroring the assign/unassign pattern — each inside `withDataContext`, returning the
   schema-shaped body (`{ list }`, `{ deleted: true }`, `{ tag }`, `{ deleted: true }`). Parse
   `name` via `requiredString`; parse `reassignToListId` via `optionalString`. Import the four route
   schemas.

   b. **Schedule reconcile after a recurring create** — in the `POST /api/tasks` handler, after the
   task is created, if it is recurring, reconcile (outside `withDataContext`, using
   `accessContext.actorUserId` and `dependencies.boss`):

   ```ts
   const task = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
     repository.create(scopedDb, input)
   );
   if (task.recurrence != null) {
     await reconcileRecurrenceSchedule(dependencies.boss, accessContext.actorUserId);
   }
   const tags = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
     repository.getTagsForTask(scopedDb, task.id)
   );
   return reply.code(201).send({ task: serializeTask(task, tags) });
   ```

   (Update the `POST /api/tasks` serialize call to pass `tags` — folds into the Task 16 ripple if not
   already done.)

   c. **Per-session self-heal** — in the `GET /api/tasks/lists` handler (loaded on Tasks page mount),
   reconcile opportunistically after returning lists is risky for latency; instead fire-and-forget
   BEFORE returning is also fine since `reconcileRecurrenceSchedule` never throws. Add:

   ```ts
   await reconcileRecurrenceSchedule(dependencies.boss, accessContext.actorUserId);
   ```

   right after `resolveAccessContext` in the lists handler. It is failure-isolated and cheap (one
   upsert). Import `reconcileRecurrenceSchedule` in `routes.ts`.

   d. Register the four routes in `tasksModuleManifest.routes` with `permissionId: "tasks.update"`
   (rename/delete are an update surface; create uses `tasks.create`). Import the request schemas in
   `manifest.ts`.

4. Run and SEE pass:

   ```sh
   pnpm test:tasks && pnpm test:unit && pnpm typecheck
   ```

5. Commit:

   ```sh
   git add packages/tasks/src/routes.ts packages/tasks/src/manifest.ts tests/integration/tasks.test.ts tests/unit/tasks-recurrence-rollforward.test.ts
   git commit -m "feat(tasks): list/tag rename+delete routes + recurrence schedule reconcile (#41 #48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase I — Web client + UI

### Task 22 — API client functions + `listTasks({ tagId? })`

**Files:** modify `apps/web/src/api/client.ts`.

**Steps:**

1. Failing test — the e2e/web has no direct client unit test harness; the proof is typecheck + the
   e2e in Task 25. For TDD discipline, add a tiny type-level usage in a new
   `apps/web/src/tasks/__tests__`? The web app uses Playwright e2e, not unit. So gate this task on
   `pnpm typecheck` (web typecheck is in the `typecheck` script) and the e2e in Task 25. Write the
   client functions, then `pnpm typecheck`.

2. Implementation — add to `apps/web/src/api/client.ts` (COMPLETE):

   ```ts
   // imports
   import type {
     AssignTaskTagRequest,
     RenameTaskListRequest,
     DeleteTaskListRequest,
     RenameTaskTagRequest,
     GetTaskResponse,
     CreateTaskListResponse,
     CreateTaskTagResponse
   } from "@jarv1s/shared";

   export async function listTasks(params?: { readonly tagId?: string }): Promise<ListTasksResponse> {
     const qs = params?.tagId ? `?tagId=${encodeURIComponent(params.tagId)}` : "";
     return requestJson<ListTasksResponse>(`/api/tasks${qs}`);
   }

   export async function assignTaskTag(
     taskId: string,
     input: AssignTaskTagRequest
   ): Promise<GetTaskResponse> {
     return requestJson<GetTaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
       method: "POST",
       body: input
     });
   }

   export async function unassignTaskTag(taskId: string, tagId: string): Promise<GetTaskResponse> {
     return requestJson<GetTaskResponse>(
       `/api/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`,
       { method: "DELETE" }
     );
   }

   export async function renameTaskList(
     listId: string,
     input: RenameTaskListRequest
   ): Promise<CreateTaskListResponse> {
     return requestJson<CreateTaskListResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}`, {
       method: "PATCH",
       body: input
     });
   }

   export async function deleteTaskList(
     listId: string,
     input?: DeleteTaskListRequest
   ): Promise<{ deleted: boolean }> {
     return requestJson<{ deleted: boolean }>(`/api/tasks/lists/${encodeURIComponent(listId)}`, {
       method: "DELETE",
       body: input ?? {}
     });
   }

   export async function renameTaskTag(
     listId: string,
     tagId: string,
     input: RenameTaskTagRequest
   ): Promise<CreateTaskTagResponse> {
     return requestJson<CreateTaskTagResponse>(
       `/api/tasks/lists/${encodeURIComponent(listId)}/tags/${encodeURIComponent(tagId)}`,
       { method: "PATCH", body: input }
     );
   }

   export async function deleteTaskTag(listId: string, tagId: string): Promise<{ deleted: boolean }> {
     return requestJson<{ deleted: boolean }>(
       `/api/tasks/lists/${encodeURIComponent(listId)}/tags/${encodeURIComponent(tagId)}`,
       { method: "DELETE" }
     );
   }
   ```

   > `listTasks` gains an optional arg — its existing call sites pass none, so they remain valid.
   > Verify no caller positionally passes something incompatible (`grep -rn "listTasks(" apps/web/src`).

3. Run:

   ```sh
   pnpm typecheck
   ```

4. Commit:

   ```sh
   git add apps/web/src/api/client.ts
   git commit -m "feat(web): task tag + list/tag rename/delete client fns; listTasks(tagId) (#40 #41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 23 — Read-only tag chips in the list view

**Files:** modify `apps/web/src/tasks/task-list-view.tsx`, `apps/web/src/tasks/tasks.css`.

**Steps:**

1. Add an e2e assertion deferred to Task 25 (chips render). For this task, implement + `pnpm typecheck`.

2. Implementation — in `TaskLine` (`task-list-view.tsx`), render `props.task.tags` as chips using the
   existing `tag-chip` class (already defined, used in `tasks-page.tsx:259`):

   ```tsx
   {props.task.tags.length > 0 ? (
     <span className="task-line-tags">
       {props.task.tags.map((tag) => (
         <span className="tag-chip" key={tag.id}>{tag.name}</span>
       ))}
     </span>
   ) : null}
   ```

   Add minimal layout CSS for `.task-line-tags` to `tasks.css` (flex gap, inline) — reuse existing
   spacing variables/classes; no new tokens.

3. Run:

   ```sh
   pnpm typecheck
   ```

4. Commit:

   ```sh
   git add apps/web/src/tasks/task-list-view.tsx apps/web/src/tasks/tasks.css
   git commit -m "feat(web): read-only tag chips in the task list view (#40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 24 — Detail-page Tags section (assign/unassign) + sidebar rename/delete affordances

**Files:** modify `apps/web/src/tasks/task-detail-page.tsx`, `apps/web/src/tasks/tasks-page.tsx`,
`apps/web/src/tasks/tasks.css`.

**Steps:**

1. Implement + `pnpm typecheck`; behavior verified by e2e in Task 25.

2. Implementation:

   a. **Detail page Tags section** — in `task-detail-page.tsx`, add a `panel` section that:
   - reads the task's own list's tags via `useQuery({ queryKey: queryKeys.tasks.tags(task.listId), queryFn: () => listTaskTags(task.listId) })`,
   - shows the task's current `task.tags` as removable chips (each with an unassign button calling a
     `useMutation` on `unassignTaskTag(taskId, tag.id)`),
   - offers a select/add control over the list's tags NOT already assigned, calling a `useMutation` on
     `assignTaskTag(taskId, { tagId })`,
   - on success invalidates `queryKeys.tasks.detail(taskId)` and `queryKeys.tasks.list`.

   b. **Sidebar rename/delete** — in `ListSidebar` (`tasks-page.tsx`), for each list row add a rename
   (inline edit → `renameTaskList`) and delete (confirm → `deleteTaskList`; on a `409`/`ApiError`
   surface "List is not empty" and offer reassign by re-calling with `{ reassignToListId }`). For each
   tag row add rename (`renameTaskTag`) and delete (`deleteTaskTag`). Invalidate `queryKeys.tasks.lists`
   and `queryKeys.tasks.tags(listId)` on success. Use `ApiError.status === 409` to drive the reassign
   flow.

   Add minimal CSS to `tasks.css` for the new controls (reuse existing button/icon-button classes).

3. Run:

   ```sh
   pnpm typecheck
   ```

4. Commit:

   ```sh
   git add apps/web/src/tasks/task-detail-page.tsx apps/web/src/tasks/tasks-page.tsx apps/web/src/tasks/tasks.css
   git commit -m "feat(web): detail-page tag assign/unassign + sidebar list/tag rename+delete (#40 #41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

### Task 25 — e2e: mocks + spec coverage

**Files:** modify `tests/e2e/mock-api.ts`, `tests/e2e/tasks.spec.ts`.

**Steps:**

1. Add failing e2e assertions in `tests/e2e/tasks.spec.ts`:
   - assign a tag from the detail page → a chip appears,
   - rename a list in the sidebar → the new name renders,
   - delete a tag → it disappears.

2. Run and SEE fail:

   ```sh
   pnpm test:e2e -- tasks.spec.ts
   ```

3. Implementation:

   a. `createMockTask` already returns `tags: []` (landed in Task 12). Do NOT re-add it here; if Task
   12 was applied, this is already present. (Verify with `grep -n "tags:" tests/e2e/mock-api.ts`.)

   b. Add mock route handlers + registrations. **PLAYWRIGHT ROUTE PRECEDENCE IS REVERSE REGISTRATION
   ORDER — the LAST matching `page.route` registered wins (Codex finding, verified against the existing
   file).** In `tests/e2e/mock-api.ts` the generic `**/api/tasks` (line 129) and `/api/tasks/[^/]+$`
   (line 130) are registered FIRST, and the more-specific `**/api/tasks/*/activity`,
   `**/api/tasks/focus`, `**/api/tasks/lists/*/tags`, etc. are registered AFTER so they take
   precedence. Therefore the new, more-specific mutation routes MUST be registered **AFTER** (below)
   the existing generic task routes — register them near the end of the tasks block, after line 159:

   ```ts
   // Registered AFTER the generic task routes so reverse-order precedence selects these for the
   // more-specific paths. Most-specific LAST among these too.
   await page.route("**/api/tasks/lists/*/tags/*", (route) => handleTaskTagMutateRoute(route, state));
   await page.route("**/api/tasks/lists/*", (route) => handleTaskListMutateRoute(route, state));
   await page.route("**/api/tasks/*/tags", (route) => handleTaskTagAssignmentRoute(route, state));
   await page.route("**/api/tasks/*/tags/*", (route) => handleTaskTagAssignmentRoute(route, state));
   ```

   > **Caution: do not shadow the existing GET/POST `**/api/tasks/lists/*/tags` handler**
   > (`handleTaskTagsRoute`, line 157) which serves the list's tag picker. Because the new
   > `**/api/tasks/lists/*/tags/*` is registered later and is more specific (extra `/*`), it only
   > captures the `:tagId` sub-path (PATCH/DELETE a specific tag) and does NOT shadow the bare
   > `.../tags` GET/POST. Keep `handleTaskTagsRoute` registered. If a path genuinely overlaps, have one
   > handler switch on `route.request().method()` rather than registering two competing patterns.

   Implement `handleTaskTagAssignmentRoute` (POST assign → return the task with a tag in `tags`;
   DELETE unassign → return the task with `tags: []`), `handleTaskListMutateRoute` (PATCH rename →
   `{ list }`; DELETE → `{ deleted: true }`), `handleTaskTagMutateRoute` (PATCH → `{ tag }`; DELETE →
   `{ deleted: true }`). Keep them minimal and consistent with `TaskDto.tags` shape. Each handler MUST
   assert/branch on `route.request().method()` so a wrong method falls through clearly rather than
   silently returning the wrong shape.

4. Run and SEE pass:

   ```sh
   pnpm test:e2e -- tasks.spec.ts
   ```

5. Commit:

   ```sh
   git add tests/e2e/mock-api.ts tests/e2e/tasks.spec.ts
   git commit -m "test(e2e): tag assign chip, list rename, tag delete; createMockTask tags (#40 #41)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Phase J — Hardening + remaining test coverage

### Task 26 — Multi-skip + month-boundary unit coverage; payload-guard worker test

**Files:** modify `tests/unit/tasks-recurrence-rollforward.test.ts`, `tests/integration/tasks.test.ts`.

**Steps:**

1. Add unit tests (the monthly clamp itself is ALREADY fixed in Task 1; these exercise multi-skip and
   boundaries on top of the corrected helper):
   - monthly multi-skip across a year boundary advances to the next occurrence ≥ today in one pass,
   - monthly multi-skip starting from a month-end date (e.g. Jan 31) keeps clamping correctly across
     several skips (Feb 28 → Mar 31 → Apr 30 …) — proves the clamp composes through `nextOccurrenceAtOrAfter`,
   - the "already current" no-op,
   - the today-boundary (occurrence == today is NOT rolled).

   Add an integration test: a recurrence job with an extra payload key is rejected by the worker
   (`isRecurrenceMaterializePayloadMetadataOnly` throws → job fails, no roll). Assert the guard
   directly (already in Task 8) and, if feasible, that a malformed payload does not advance the series.

2. Run and SEE pass (the clamp/guard already landed; these are confirming/edge coverage). Any genuine
   red here means an earlier task's routine is wrong — fix the routine, not the test:

   ```sh
   pnpm test:unit && pnpm test:tasks
   ```

3. Do not weaken tests. If a multi-skip month-end test fails, the Task 1 clamp or the Task 2 loop is
   the defect — fix it there.

4. Commit:

   ```sh
   git add tests/unit/tasks-recurrence-rollforward.test.ts tests/integration/tasks.test.ts
   git commit -m "test(tasks): multi-skip/month-boundary roll-forward + payload-guard coverage (#48)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```

---

## Self-Review

Run this review BEFORE the final gate. Do not skip it.

### Spec §-by-§ coverage

| Spec component / criterion | Plan task(s) | Covered |
| --- | --- | --- |
| A. Roll-forward routine (`rollForwardRecurringSeries`/`rollForwardOwnedSeries`) | T1, T2, T3 | ✅ |
| B. Queue + payload (`TASKS_RECURRENCE_QUEUE`, `RecurrenceMaterializePayload`, guard) | T7, T8 | ✅ |
| C. Per-actor schedule reconcile (`recurrence-schedule.ts`, failure-isolated, self-heal) | T9, T21 | ✅ |
| D. Worker handler (second worker, RLS-scoped, metadata guard) | T10 | ✅ |
| E. Lazy-on-view safety net (`listVisible` + drift reads) | T16 | ✅ |
| F. Migration — worker grant (`00NN` next free number, idempotent, manifest entry) | T6 | ✅ (clarified: grant already exists from 0003 → defensive/idempotent; `0065` is taken → renumber) |
| G. Tag contract (`TaskDto.tags`, reorder schema, assign/rename/delete schemas) | T12, T13 | ✅ |
| H. Repository + serialize (`serializeTask(tags)`, batched join, assign/unassign) | T14, T17 | ✅ |
| I. Tag routes + `tagId` filter + manifest | T18 | ✅ |
| J. List/tag rename+delete repository (409/reassign/drop-foreign-tags/cascade/last-list guard) | T19, T20 | ✅ |
| K. Rename/delete routes + schemas + manifest | T21 | ✅ |
| L. Web UI (chips, detail assign/unassign, sidebar rename/delete, tagId filter) | T22, T23, T24 | ✅ |
| M. Test mocks (`createMockTask` tags, new handlers) | T25 | ✅ |
| Shared cron engine (`{ schedule: true }` in worker, idempotent) | T11 | ✅ |
| Acceptance #1–#5 (recurrence cron/lazy/multi-skip/idempotent/metadata-RLS) | T2–T10, T16 | ✅ |
| Acceptance #6 (migration next-free-number, idempotent, 0039/0062 unedited) | T6 | ✅ |
| Acceptance #7–#10 (tags contract, no-N+1, routes, owner-scoped, detail/list UI) | T12–T18, T23, T24 | ✅ |
| Acceptance #11–#13 (list/tag rename/delete + sidebar affordances) | T19–T21, T24 | ✅ |
| Acceptance #14 (full gate + e2e + file-size) | T27 (final gate) | ✅ |
| Testing strategy: integration/unit/e2e enumerated | T2–T26 | ✅ |
| Out of scope honored (no per-user tz, no completion-relative, no bulk tags, no AI write tool, no unschedule) | by omission | ✅ |
| Design-direction mockup gate | N/A — different slice; documented in header | ✅ (explicitly out of scope) |

### Placeholder scan

Grep the plan and (after build) the diff for the words `TODO`, `FIXME`, `placeholder`, `...`,
`<your`, `tbd`. There must be **none** in shipped code. Every code block in this plan is complete and
copy-ready; the only "verify against version" notes are for Kysely expression-builder syntax (T19) and
pg-boss `ScheduleOptions` field names (T9) — resolve those by reading `node_modules` types, never by
guessing.

### Type consistency

- `TaskDto.tags: readonly TaskTagDto[]` matches `serializeTask`'s `tags.map(serializeTaskTag)` output.
- `taskDtoSchema.required` includes `"tags"` and `taskDtoSchema.properties.tags.items === taskTagDtoSchema`
  (which is now declared **above** `taskDtoSchema` — T12).
- `serializeTask(task, tags = [])` default keeps unported callers compiling mid-build; all callers
  (routes T16, tools T15, e2e mock T25) are updated to pass real tags by the end.
- `RecurrenceMaterializePayload extends ActorScopedJobPayload` → `{ actorUserId, idempotencyKey? }`;
  every key is in `ALLOWED_PAYLOAD_KEYS` (no `pg-boss.ts` change) and in
  `RECURRENCE_MATERIALIZE_PAYLOAD_KEYS`.
- `registerTasksJobWorkers` returns `[deferredId, recurrenceId]`; `module-registry` consumes the array
  unchanged.
- Web client return types match the contract response shapes (`GetTaskResponse`,
  `CreateTaskListResponse`, `CreateTaskTagResponse`, `{ deleted: boolean }`).

### Hard Invariant audit (CLAUDE.md)

- **No admin bypass / private by default:** all new reads/writes go through `withDataContext`; the cron
  carries only `actorUserId`; **no cross-user sweep**. No `BYPASSRLS`. ✅
- **DataContextDb only:** `rollForward*`, tag joins, all rename/delete methods accept the branded
  handle + `assertDataContextDb`; `reconcileRecurrenceSchedule` takes `boss` + a plain `actorUserId`
  string (pg-boss is not RLS-scoped, runs outside `withDataContext`). ✅
- **AccessContext shape unchanged** (`{ actorUserId, requestId }`); worker builds it via
  `toAccessContext`. ✅
- **Metadata-only payloads:** `{ actorUserId, idempotencyKey? }`; guard + `ALLOWED_PAYLOAD_KEYS`;
  series id discovered under RLS, never in payload. ✅
- **Secrets never escape:** tags carry id/name/listId only; schedule errors logged name+message only. ✅
- **Module isolation:** all work inside `tasks` + its shared contract + its web surface; cron reuses
  the generic `@jarv1s/jobs` engine, not another module's internals. ✅
- **Never edit applied migrations / module SQL in owning dir:** the only DDL is the NEW
  `packages/tasks/sql/00NN_*.sql` (next free number, NOT `0065`); `0003`/`0019`/`0039`/`0062`/`0063`
  untouched. ✅
- **pgvector image / provider-agnostic AI:** untouched; no AI calls; read tools stay read-only. ✅
- **1000-line cap:** monitored each phase; `tags-routes.ts` extraction is the pre-planned escape valve. ✅

### Adversarial (Codex) review revisions — accepted & rejected

This plan was hardened against an adversarial cross-model (Codex) review. Material findings accepted:

- **Owner-only roll-forward, not RLS-default** — `tasks_update` is owner-OR-share, so roll-forward now
  carries an explicit `owner_user_id = app.current_actor_user_id()` predicate on every select/update;
  a manage-share-isolation test was added (T2/T3/T5).
- **Single-row update** — the in-place UPDATE targets `WHERE id = live.id`, never `WHERE
  recurrence_series_id` (a whole-series update could trip the unique index on duplicate live rows) (T2).
- **Monthly end-of-month clamp** — the pre-existing `setUTCMonth` overflow bug (Jan 31 → Mar 3) is
  fixed in T1 (add-clamp), so all downstream multi-skip math is correct.
- **Task move drops foreign tags** — new T17b closes the integrity gap where `repository.update`
  changes `list_id` without dropping tags belonging to the old list (the trigger only fires at
  assignment time).
- **`deleteList` ordering** — existence/ownership check precedes the last-list guard (404 not 409 for a
  missing list); self-reassign (`reassignToListId === listId`) rejected with 400 (T19).
- **`assignTag` deterministic errors** — precheck owned task + owned tag → 404; cross-list → 400; no
  raw 500 (T17).
- **Typecheck green per commit** — `TaskDto.tags`, the `serializeTask` default, and `createMockTask`
  `tags:[]` land atomically in T12; no red commits across the overnight build.
- **`tagId` filter** — validates tag visibility first; foreign/nonexistent tag → documented empty
  result (T18).
- **Worker cron knob** — a non-flaky seam unit test proves default `schedule:false` and override
  `true` (T11); plus a `pgboss.schedule` cardinality assertion (one row per actor) and a success log
  (T9/T21).
- **e2e route precedence** — corrected to Playwright's reverse-registration order (specific routes
  registered AFTER the generic ones) (T25).
- **Re-grounding** — on `phase2-portable-deploy@28ab5b6`; migration renumbered off the taken `0065`.

Round-2 refinements accepted:

- **`status='todo'` re-check on the roll-forward UPDATE** — without it a concurrent completion could
  flip the row to `done` between SELECT and UPDATE and we would mutate a completed historical row (T2).
- **pg-boss mock uses the NAMED export** (`{ PgBoss }`, not `default`) — matches the real import in
  `pg-boss.ts` (T11).
- **`assignTag`/`unassignTag` precheck OWNERSHIP, not visibility** — `0062_task_tag_assignments_ownership.sql`
  gates the assignment table on parent-task ownership, so a manage-shared task must be rejected with a
  clean 404 before hitting the assignment RLS as a raw 500 (T17).
- **Task-move foreign-tag drop is atomic via the AMBIENT transaction** — `withDataContext` already wraps
  the whole callback in one RLS-scoped transaction (`scopedDb.db` IS that `Transaction`), so the drop +
  move commit together; the fix is ordering (drop BEFORE move), NOT a nested transaction (which is
  unsupported) (T17b, T19).
- **Task 14 test is runnable in order** — uses a direct `task_tag_assignments` insert instead of
  `assignTag` (which lands in T17) (T14).

Findings **rejected** with reason:

- **"Add `additionalProperties: false` to the `taskDtoSchema` response DTO."** Rejected. Fastify
  response serialization already strips to the declared property allowlist (the existing response DTOs
  in this file deliberately omit `additionalProperties` on responses; request schemas all carry it).
  Adding it to a response schema is not a security fix here and changing the existing schema's
  strictness posture is out of this slice's scope and risks other response paths. The new **request**
  schemas (assign/rename/delete) all correctly include `additionalProperties: false`.
- **"Make lazy-on-view a full transaction-per-GET with locking."** Partially rejected. The convergent
  update-by-id with the `(recurrence->>'occurrence_date') < today` predicate is already race-safe
  (a concurrent advance wins; the loser matches zero rows). A heavyweight transaction/lock on every
  `GET /api/tasks` would add latency without correctness benefit. The wording was strengthened to make
  the convergent semantics explicit; the heavy mechanism was not adopted.

---

## Final Gate

### Task 27 — `pnpm verify:foundation` + `pnpm audit:release-hardening` green

**Files:** none (verification only); fix-forward only if a check fails.

**Steps:**

1. Clean-tree check (stage nothing that is not yours):

   ```sh
   git status
   ```

2. Run the full gate and SEE real exit codes (never `| tail`, never swallow):

   ```sh
   pnpm check:file-size
   pnpm verify:foundation      # lint, format:check, check:file-size, typecheck, test:unit, db:migrate, test:integration
   pnpm test:e2e
   pnpm audit:release-hardening
   ```

3. If any check fails, fix the root cause (do not weaken a test or a check), re-run the affected
   focused suite, then re-run the full gate. Repeat until green.

4. Confirm `pnpm db:migrate` is idempotent:

   ```sh
   pnpm db:migrate && pnpm db:migrate    # second run MUST exit 0
   ```

5. Final commit if any fix-forward edits were made (explicit paths only), then push the branch and
   open the PR. PR body MUST include: "grounded on `<sha>`" (the `git rev-parse HEAD` of the build
   base), the closed issues (#40, #41), the parent epic (#48), and the
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer. Do NOT touch the
   board/milestone/merge — that is the coordinator's job.

   ```sh
   git push -u origin p3-task-verticals
   gh pr create --base main --title "Phase 3: task verticals finished — recurrence scheduling, tag assignment, list/tag rename+delete (#40 #41)" --body "<body with grounded-on sha, Part of #48, Closes #40 #41>"
   ```
