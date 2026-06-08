# Tasks Foundation — Design

**Status:** Approved for build — rev 3 (two adversarial verification passes — Gemini 2.5 Pro + Claude critic — both returned *ready-with-fixes*; all fixes folded in below, 2026-06-08)
**Date:** 2026-06-08
**Owner:** Ben
**Depends on:** M-A3 (real AI providers / chat runtime) merged to `main`.
**Informs:** M-A4 (vault-grounded briefings) — the briefing reads tasks; this spec defines
the read contract it will rely on.
**Related (separate specs):** *AI write-tool execution surface* (in progress, owned by a
separate effort) — a prerequisite for Jarv1s **creating/updating** tasks; **@Jarvis-in-task**
(later) — a task-scoped assistant conversation. Both are explicitly out of this milestone
(see Scope).

---

## Context

Jarv1s ships a minimal Tasks module (`packages/tasks/`): a flat `app.tasks` table (title,
description, status, nullable `priority` smallint with no defined meaning, due/completed
timestamps), an append-only `app.task_activity` feed (free-text type), CRUD + async
`deferred-status` routes, owner-or-share RLS, and exactly two assistant tools
(`tasks.listVisible`, `tasks.updateStatus`). The briefing's *entire* current coupling is
calling `tasks.listVisible` and reading task **titles**.

The north-star — verified in the design interview — is to **excel for people with
executive-function (EF) challenges**: make capture, prioritization, breakdown, and "what do
I do next" low-effort and low-overwhelm. Future areas (briefings, meetings, chores) hang off
Tasks, so the task model must be designed out *now* as the single dependable substrate.

This spec is the output of a `grill-with-docs` session. Domain language is in the repo-root
[`CONTEXT.md`](../../../CONTEXT.md); the core conceptual decision is recorded in
[ADR 0004](../../architecture/decisions/0004-tasks-single-action-surface.md).

### Scope was corrected by adversarial review

Two independent model reviews (Gemini 2.5 Pro, unanchored; Claude critic) converged on the
same blockers in rev 1, and this rev acts on them:

1. **There is no AI write-tool execution path today.** `AiAssistantToolExecutor` exposes only
   `invokeReadTool`; the chat runtime records tool metadata *without executing*. So Jarv1s
   *creating/updating* tasks (and the chat "make me a task" flow) depends on a generic
   write-tool execution surface that does not exist. That is a **separate foundational spec**
   (in progress elsewhere). This milestone ships **read** tools only.
2. **@Jarvis-in-task is not "a thin layer over the chat runtime."** The chat runtime's
   pg-boss payload is rigidly `{actorUserId, threadId, assistantMessageId}` (metadata-only,
   enforced), reads/writes only `chat_messages`, and has no path to `task_activity`. A
   task-scoped assistant turn is a **new queue + worker**, sequenced after the write-tool
   surface. Deferred.

The result: this milestone delivers the full **human-and-system** task model and its
**read/query** contract. Jarv1s *operating on* tasks layers on cleanly afterward through the
provenance and tool seams built here.

---

## Goals

1. **One unified action surface.** Everything to do — typed manually, or (later) created by
   Jarv1s/meetings/chores — is a **Task**. Never a parallel "commitments" or "chores" list.
2. **EF-first ergonomics.** Capture needs only a title. Breakdown into ordered steps is
   first-class (Goblin-Tools style). Priority is assisted via derived views, not busywork.
   Nothing nags below Medium priority.
3. **A dependable read/query contract** — list/filter, focus ("what's next"), drift
   (overdue/at-risk), and per-task activity — that the briefing and any future surface
   (including a heartbeat) consume unchanged.
4. **Provenance + idempotency seams** so meetings, chores, and commitment-detection can create
   tasks later **without reshaping the schema or editing the tasks module**.
5. **Forward-compatible** with list-level sharing, Jarv1s write-tools, @Jarvis-in-task, and a
   heartbeat-driven drift push — without building any of them now.

**Headline exit criterion:** a single Tasks surface where I capture, break down, prioritize,
organize, and track tasks; recurring tasks repeat without piling up; the activity feed is the
living status; and the drift/focus queries are ready for the briefing to consume in M-A4.

---

## Non-Goals (deferred, seam preserved)

- **Jarv1s write actions on tasks** (`tasks.create`/`update`/`complete`/`breakDown` *as
  assistant tools*, and the chat "create a task for me" flow) — depend on the separate
  **AI write-tool execution** spec. This milestone ships read tools only; the *human* REST/UI
  paths do all writes.
- **@Jarvis-in-task conversation** — a new task-scoped assistant queue/worker writing
  `jarvis_reply` activity. After the write-tool surface.
- **Chores area** — a *separate* future module that automates task creation through the
  `source` seam. Tasks hold no chore logic.
- **Completion-relative recurrence** and **subtasks-on-recurrence** — v1 is fixed-schedule,
  flat instances. (A recurring task may therefore **not** also be a parent — see Behavior.)
- **Commitment detection** (auto-creating tasks from email/meetings) — needs meetings/
  connectors. Seam built; legacy `app.commitments` left untouched (retiring it is separate).
- **Heartbeat registration registry** (proactive mid-day drift push) — next design session.
  Drift ships as a pure query the heartbeat will reuse.
- **List-level sharing** — per-task sharing only; list-level is additive later.
- **Counterparty as a structured field** — "who's waiting" lives in the task description.

---

## Resolved Decisions

| #   | Decision | Rationale |
| --- | -------- | --------- |
| 1   | Task is the **single action surface**; manual now, Jarv1s/sources later. | One place to look (EF). |
| 2   | **Commitment = a Task with inferred `source`** (later). No field/table/module; counterparty context in the description. | Chief-of-staff rule; reverses 0031's comment (ADR 0004). |
| 3   | **One-level hierarchy**; children ordered but **not gated**. | Deep trees overwhelm; gating punishes the motivated. |
| 4   | Parent is a **real task** (mark done directly *or* auto-close when all children done). **Breakdown augments.** | "Hired someone → done" without the steps. |
| 5   | **Exactly one List per task** (required, default "Personal", user-managed, no cap). **Tags scoped within a List.** No "Project" concept. | One home + light labels. |
| 6   | **Priority = 5 named levels** (Someday=1 … Critical=5). | Small clear buckets. |
| 7   | **Matrix** is a derived view; **default view = single list grouped by Priority**; user may set Matrix as default (per-user pref). | Importance×urgency lens, opt-in. |
| 8   | Optional **due-date**, **do-date**, **effort** (quick/medium/large). Only **title** required. | Capture-minimal. |
| 9   | **Recurrence v1 = fixed-schedule, one live instance, missed rolls forward without stacking.** | Repeats without a guilt pile. |
| 10  | **Provenance:** `source` (open string) + `source_ref` + `external_key`; external-source idempotency on `(owner, source, external_key)`. | New sources plug in without editing Tasks. |
| 11  | **Drift = task-level computed query** (overdue / at-risk, **Medium+**); no column, no job. | The seam briefing + a heartbeat reuse. |
| 12  | **Statuses: Open / Done / Archived.** `in_progress` retired (no manual toggle, no auto-derive); shared contract narrowed. | Just work; progress lives in Activity. |
| 13  | **Activity stream = living status + work-notes** (human + system now; **@Jarvis conversation later**); records `actor_kind`; open-string types. **Briefing must read it.** | Transparent status (EF). |
| 14  | **Sharing: per-task now**; list-level deferred but forward-compatible; **subtasks inherit parent sharing**. | Honors "private by default". |

---

## Architecture

### Domain model (target)

```
List (1) ──< Task >── (0..1) parent Task            Task ──< Activity (actor_kind: user|system; jarvis later)
  │            │
  └─< Tag      ├─ priority 1..5, due_at, do_at, effort, status(todo=Open|done|archived)
  (scoped to   ├─ recurrence (fixed), recurrence_series_id
   their List) └─ source / source_ref / external_key   (provenance)
```

### Schema deltas — new migration `0039_tasks_foundation.sql` (additive; never edits 0003/0019)

All module SQL stays in `packages/tasks/sql/`. **Migration order is chosen so the data
backfill runs before RLS is in force on the new tables**, and the one backfill that touches
the already-FORCE-RLS `app.tasks` uses a temporary migration-scoped policy (precedent:
`shares_internal_select`, infra `0017`):

1. **Create new tables (no RLS yet):**
   - `app.task_lists(id, owner_user_id → users, name check(len>0), position int default 0,
     created_at, updated_at)`, **`UNIQUE (owner_user_id, lower(name))`** (prevents duplicate
     "Personal", makes get-or-create a safe `ON CONFLICT DO NOTHING`).
   - `app.task_tags(id, owner_user_id, list_id → task_lists on delete cascade, name,
     created_at)`, `UNIQUE (list_id, lower(name))`.
   - `app.task_tag_assignments(task_id → tasks on delete cascade, tag_id → task_tags on
     delete cascade, PRIMARY KEY (task_id, tag_id))`.
   - `app.task_preferences(owner_user_id PK → users, default_view text not null default
     'priority' check (default_view in ('priority','matrix')))` — **tasks-owned** per-user
     setting. This is a *conscious* duplication of the generic `app.preferences` KV table in
     `structured-state`: the module-isolation invariant forbids Tasks reading another module's
     table, so Tasks owns its own preference store rather than reach into `app.preferences`.
2. **Seed** a "Personal" list for **every** existing user:
   `INSERT INTO app.task_lists(owner_user_id, name) SELECT id, 'Personal' FROM app.users ON CONFLICT DO NOTHING;`
   (runs as migration owner; these tables have no RLS yet).
3. **Alter `app.tasks`** — add nullable columns: `list_id uuid → task_lists ON DELETE
   RESTRICT` (a List cannot be deleted while it holds tasks — safer than cascading task
   deletion; the UI must require emptying/reassigning first), `parent_task_id uuid →
   tasks(id) on delete cascade`, `position int not null default 0`, `do_at timestamptz`,
   `effort text`, `source text not null default 'manual'`, `source_ref text`,
   `external_key text`, `recurrence jsonb`, `recurrence_series_id uuid`. The `recurrence`
   jsonb shape is pinned as `{freq:'daily'|'weekly'|'monthly', interval:int, occurrence_date:date}`
   (`occurrence_date` is the per-instance field the dedup index reads).
4. **Backfill `app.tasks` under a temporary policy:** create a transient
   `CREATE POLICY tasks_migration_backfill ON app.tasks TO jarvis_migration_owner USING(true) WITH CHECK(true)`
   (the schema-owning, `NOBYPASSRLS` migration role — a plain UPDATE by it matches zero rows
   under FORCE RLS without this policy);
   then `UPDATE app.tasks t SET list_id = l.id FROM app.task_lists l WHERE l.owner_user_id =
   t.owner_user_id AND l.name='Personal'`; `UPDATE app.tasks SET status='todo' WHERE
   status='in_progress'`; normalize `priority` into `1..5` or `NULL`; finally
   `DROP POLICY tasks_migration_backfill`.
5. **Constrain `app.tasks`:** `ALTER ... ALTER list_id SET NOT NULL`;
   `CHECK (priority IS NULL OR priority BETWEEN 1 AND 5)`;
   `CHECK (effort IS NULL OR effort IN ('quick','medium','large'))`;
   partial unique index `UNIQUE (owner_user_id, source, external_key) WHERE external_key IS NOT NULL`;
   **recurrence dedup** index `UNIQUE (recurrence_series_id, (recurrence->>'occurrence_date')) WHERE recurrence_series_id IS NOT NULL`
   (dedicated — `external_key` is left purely for *external* sources, not overloaded);
   index `(owner_user_id, status, priority, due_at)` to back drift/focus queries.
6. **Triggers (BEFORE INSERT/UPDATE on `app.tasks`)** — each is a row trigger doing a
   lookup, not a column check:
   - **No grandchildren:** when `NEW.parent_task_id IS NOT NULL`, reject if
     `NEW.id = NEW.parent_task_id` (self-parent) or if the referenced parent itself has a
     parent: `EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.parent_task_id IS NOT NULL)`.
   - **Recurring task may not be a parent (bidirectional)** — subtasks-on-recurrence is
     deferred, so both directions must be guarded:
     (a) when `NEW.recurrence IS NOT NULL`, reject if
     `EXISTS (SELECT 1 FROM app.tasks c WHERE c.parent_task_id = NEW.id)`;
     (b) when `NEW.parent_task_id IS NOT NULL`, reject if the parent is recurring:
     `EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.recurrence IS NOT NULL)`.
   - **Trigger on `task_tag_assignments`:** reject a tag whose `list_id` ≠ the task's `list_id`.
7. **Enable RLS + policies + grants** on the four new tables (owner-only, `FORCE ROW LEVEL
   SECURITY`), mirroring `app.tasks`/`commitments`. **Grants:** `SELECT, INSERT, UPDATE,
   DELETE` to `jarvis_app_runtime` on `task_lists`/`task_tags`/`task_tag_assignments`/
   `task_preferences`; `SELECT` to `jarvis_worker_runtime` on all four (worker reads list/
   tag/pref context for focus/drift composition). `app.task_lists` forward-compat: the
   owner-only `SELECT` policy is written so a future `OR app.has_share('list', id, 'view')`
   disjunct is purely additive.

> Note: `app.task_activity` already grants `SELECT, INSERT` to both runtimes and is in both
> RLS policies (0003) — no new grant needed there. Add column
> `actor_kind text not null default 'user' check (actor_kind in ('user','jarvis','system'))`.

### Status contract change (shared)

`@jarv1s/shared` `taskStatusSchema` / `TASK_STATUSES` and `@jarv1s/db` `TaskStatus` are
**narrowed to `todo | done | archived`** (UI labels: *Open / Done / Archived*). The DB enum
value persists (Postgres can't drop it cleanly) but is never written. **Callers to update
(in scope — they currently reference `in_progress`):**
- `packages/shared/src/tasks-api.ts` (`TASK_STATUSES`/`taskStatusSchema`) and
  `packages/db/src/types.ts` (`TaskStatus`).
- `packages/tasks/src/routes.ts` `optionalTaskStatus`/`parseDeferredStatusBody` → reject
  `in_progress`.
- `apps/web/src/tasks/task-format.ts` (`in_progress: "Doing"`) and `tasks-page.tsx` (status
  filter, dropdown, count map) → drop the `in_progress` option.
- `tests/integration/tasks.test.ts` (~ll. 356–396) currently **asserts** a PATCH to
  `in_progress` round-trips 200 — this assertion is **inverted** to expect rejection.

### Behavior rules (repository/service layer)

- **Default list:** create flows resolve-or-create the owner's "Personal" list (idempotent
  upsert on `UNIQUE(owner, lower(name))`) when none is given. Every existing user was seeded
  one in the migration, so this is normally a select.
- **Breakdown:** the original becomes the parent; each step inserts as an ordered child
  inheriting the parent's `list_id`; emits a `broken_down` activity entry.
- **Position:** ordered within the task's container — siblings under a `parent_task_id`, or
  top-level tasks within a `list_id`.
- **Completion cascade (repository, not trigger, so activity is emitted):** all children done
  → parent auto-closes; parent done/archived → open children close. A parent cannot be
  recurring (trigger-enforced), so no parent-completion ↔ recurrence interaction exists.
- **Recurrence:** completing a recurring task creates the next instance (same series, advanced
  `due_at`/`do_at`), `source='recurrence'`, deduped by `(recurrence_series_id, occurrence_date)`.
  One live instance per series; a missed occurrence stays as the single overdue instance until
  done or superseded.
- **List move:** moving a task to a different list drops tag assignments absent from the
  destination list (emits an `edited` note). **Moving a parent cascades the new `list_id` to
  its children** (each child's tags reconciled likewise) — a parent and its children are
  always in the same list.

### Drift — pure computed query (no column, no job)

- `getOverdue`: open tasks with `due_at < now()`.
- `getAtRisk`: open tasks, **priority ≥ 3 (Medium+)**, where `due_at` is within a proximity
  window **or** `do_at` has passed, **and** progress is lacking (no completed child / no recent
  activity). Thresholds are a documented constant; backed by the
  `(owner, status, priority, due_at)` index + the existing `task_activity(task_id, created_at)`.
- `getFocus`: the "what's next today" ordering = Do-quadrant ∪ at-risk ∪ due-today, ranked by
  (priority, urgency, drift, effort).

**Honest status:** in *this* milestone these queries ship as a **read seam with no live
consumer yet** — the briefing rewires to them in **M-A4**, and the heartbeat reuses them
later. They are exercised by tests and the read tools now; user-visible *proactive* drift
arrives with those consumers.

### Assistant-tool contract — READ ONLY this milestone

Wired through the existing `AiAssistantToolExecutor.invokeReadTool` path (the only execution
surface that exists). **Note:** that executor is a hardcoded `switch (tool.name)`, not
manifest-driven — so **each read tool below is real new work: a new `case` in
`invokeReadTool` plus a backing repository/query method**, and the `@jarv1s/ai` package gains
a dependency on the new tasks query surface. `risk:"read"`: `tasks.list` (filters: list, tag,
status, priority, due-range, **matrix quadrant**), `tasks.get` (incl. subtasks + recent
activity), `tasks.focus`, `tasks.atRisk`, `tasks.overdue`, `tasks.listLists`, `tasks.listTags`,
`tasks.activity`. The legacy `tasks.updateStatus` write tool is **removed** until the AI
write-tool execution surface exists; status/all writes go through REST/UI. **Write** tools
(`tasks.create`/`update`/`complete`/`archive`/`breakDown`/`addActivity`/list+tag mutations)
are specified as the **next** milestone's surface, gated on that separate spec.

### Web / REST + UI (human paths — all writes live here this milestone)

Routes for tasks CRUD (extended for the new fields), subtasks/breakdown, list & tag CRUD,
activity add/list, recurrence toggle, and the read queries (list w/ filters, focus, drift).
UI: capture (title-only fast path), task detail (fields + subtasks + activity feed),
**priority-grouped default list view**, and the **Matrix** alternative view with the
`default_view` preference.

### Briefing dependency (what this spec owes M-A4)

The briefing **must read a task's recent activity before describing it** ("you bought the
tires" over "still open") and will consume `tasks.focus`/`tasks.atRisk`/`tasks.get`. De-dup is
structural: sources become tasks, so an obligation has exactly one representation.

---

## Reliability / Degradation

| Concern | Behavior |
| --- | --- |
| External source double-fires (future chore/meeting retry) | `external_key` idempotency → one task. |
| Recurrence double-generation | `(recurrence_series_id, occurrence_date)` unique → one live instance. |
| Missed recurring occurrence | Single instance rolls forward (overdue), never stacks. |
| Parent/child consistency | Repository cascade emits activity; FK cascade prevents orphans; parent+children share a list. |
| Migration on existing data | Backfill runs pre-RLS on new tables and under a transient policy on `app.tasks`; all existing rows get a Personal list before `NOT NULL`. |

---

## Security / Isolation (hard invariants honored)

- **Private by default / owner-or-share.** New tables are owner-scoped with `FORCE ROW LEVEL
  SECURITY`; per-task sharing via `app.has_share('task', id, level)` is unchanged. No
  `BYPASSRLS`, no admin bypass.
- **DataContextDb only / AccessContext shape unchanged.** All access via `withDataContext`.
- **Metadata-only job payloads.** This milestone adds **no new job type** (the deferred
  @Jarvis turn is what would have risked smuggling task content into a payload — explicitly
  out of scope; when built it must read task context in-worker under RLS, never via payload).
- **Module isolation.** `source`/`activity_type` are **open strings** so new source modules
  plug in without editing Tasks or its enums. View preference persists in tasks-owned
  `app.task_preferences` — no read of another module's tables. The `structured-state`
  commitments table is neither imported nor queried.
- **Never edit applied migrations.** All changes ship as new `0039_tasks_foundation.sql`.
- **1000-line limit.** Decompose into `repository.ts` (lean), `drift.ts`, `recurrence.ts`,
  `breakdown.ts`, `lists.ts`.

---

## Testing

**Integration (`tests/integration/tasks.test.ts`, extended):**
- Capture-minimal create (title only → owner's "Personal" list).
- **Migration**: existing rows backfilled to Personal; `in_progress` mapped to `todo`; legacy
  priority normalized; `list_id` NOT NULL holds; transient backfill policy dropped.
- Hierarchy: breakdown augments; grandchild rejected; self-parent rejected; ordered-not-gated;
  all-children-done auto-closes parent; parent done closes children; recurring-parent rejected.
- Organization: one list required; list `UNIQUE(owner,lower(name))`; get-or-create-Personal is
  idempotent under concurrency; tags scoped to list (cross-list assignment rejected); list move
  drops foreign tags; **parent move cascades list to children**; no list cap.
- Priority 1..5 CHECK + Matrix quadrant filter; default-view preference round-trips.
- Recurrence: completing generates one next instance; `(series_id, occurrence_date)` dedup;
  missed occurrence doesn't stack.
- Provenance: `(owner, source, external_key)` idempotency; manual default; `source_ref`
  round-trips; "added by you/Jarv1s" label derives from `source='manual'`.
- Drift: `getOverdue`/`getAtRisk` (Medium+ only), `getFocus` ordering; no stored drift.
- Statuses: only `todo|done|archived` accepted via REST; `in_progress` write rejected.
- Activity: `actor_kind` recorded (user/system); briefing-style read of recent activity.
- RLS/isolation: per-task share works; subtasks inherit parent visibility; lists/tags/prefs
  owner-only; new-table worker SELECT grants present; no cross-user read.

**Unit:** matrix classification; drift thresholds (due/do-date edges); recurrence next-occurrence
(month/DST edges); list-move tag reconciliation.

**Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

---

## Milestone breakdown

**This milestone (core foundation):** schema `0039` (with the safe backfill); List/Tag/
preference model + default Personal list; one-level hierarchy + breakdown; 5-level priority +
Matrix + priority-grouped default view; due/do/effort; **fixed-schedule recurrence**;
Open/Done/Archived (+ shared-contract narrowing); **human/system** Activity feed; **read**
assistant tools; drift/focus **queries** (unconsumed seam); REST + web UI for all human writes.

**Next (separate spec, in progress elsewhere):** AI **write-tool execution surface** → then
the tasks **write** tools (`tasks.create`/`update`/`complete`/`breakDown`…) and the chat
"create a task for me" flow.

**Then:** **@Jarvis-in-task** (new task-scoped assistant queue/worker writing `jarvis_reply`,
reading task context in-worker under RLS); **heartbeat registration registry** (registers the
drift query for proactive push).

**Later (seams preserved):** Chores area; commitment detection; list-level sharing;
completion-relative recurrence; subtasks-on-recurrence.

---

## Hard Invariants Honored (from CLAUDE.md)

- Private by default / no admin bypass / no `BYPASSRLS` ✓
- DataContextDb only / AccessContext shape unchanged ✓
- Secrets never escape / metadata-only payloads (no new job type this milestone) ✓
- Provider-agnostic AI (no AI execution added this milestone; future tools reuse the router) ✓
- Module isolation (open-string seams; tasks-owned preferences; no cross-module table reads) ✓
- Spec before build (this document) ✓
- Never edit applied migrations (new `0039` only; SQL in module `sql/`) ✓
- 1000-line limit (decompose recurrence/drift/breakdown/lists) ✓
