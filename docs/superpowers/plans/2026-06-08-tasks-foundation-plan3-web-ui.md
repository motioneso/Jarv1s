# M-A5 Tasks Foundation — Plan 3 of 3 (Web UI + status narrowing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Build agents run on Sonnet; each task commits green; `git add` only that task's files (NEVER `-A`). Files stay < 1000 lines (`pnpm check:file-size`).**

**Goal:** Ship the human-facing Tasks web UI — capture, priority-grouped default view, Eisenhower Matrix view, task detail with subtasks + activity, and lists/tags — plus the carried-over atomic `TaskStatus` narrowing, closing M-A5 (epic #6).

**Architecture:** Mostly `apps/web` (React + React Query + react-router), but with **four thin backend-completion slices** the UI requires and that Plans 1–2 left unbuilt (see "Backend reality" below): wiring the new task fields through the REST parsers, a `task_preferences` vertical slice (the `default_view` toggle), a subtasks read route, and extending the request DTOs. Matrix/priority logic lives once in a new `@jarv1s/shared/tasks-view` module shared by the web layer. New CSS lives in a new `apps/web/src/tasks/tasks.css` (NOT `styles.css`, which is at 945/1000 lines).

**Tech Stack:** TypeScript, Fastify + Kysely (backend slices), React 19 + @tanstack/react-query + react-router (web), Vitest (integration + pure-unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` (rev 3). **Decision:** ADR `docs/architecture/decisions/0004-tasks-single-action-surface.md`. **Plan 1 doc:** `docs/superpowers/plans/2026-06-08-tasks-foundation.md` (read its Tasks 2 & 3 deferred-narrowing notes).

---

## Backend reality (verified against `origin/main` cda9f23 — read before reviewing)

The kickoff framed Plan 3 as "UI on top of a done backend." That is **mostly** true, but the following named exit criteria have **no REST path yet** and are completed here as thin slices:

1. **Create/update parsers drop new fields.** `packages/tasks/src/routes.ts:348-370` (`parseCreateTaskBody`/`parseUpdateTaskBody`) parse only `title/description/status/priority/dueAt` — they silently discard `listId/doAt/effort/parentTaskId/recurrence`, even though the JSON schemas accept them and `TasksRepository.create/update` fully support them. → **Task 2.**
2. **Request DTOs lack the new fields.** `CreateTaskRequest`/`UpdateTaskRequest` interfaces (`packages/shared/src/tasks-api.ts:38-44,54-60`) omit `listId/doAt/effort/parentTaskId/recurrence` (the _schemas_ have them; the _TS interfaces_ don't). → **Task 2.**
3. **`task_preferences` is unbuilt above the table.** Migration 0039 created `app.task_preferences(default_view)`, but there is **no repository, route, contract, or web usage**. The `default_view` per-user preference is a named exit criterion. → **Task 3.**
4. **No subtasks REST route.** `repository.listByParentId` exists and the Plan-2 `tasks.get` _assistant tool_ uses it, but there is no REST endpoint, so the web detail page can't list subtasks. → **Task 4.**

These are confirmed by reading the files, not assumed.

---

## Scope Decision Points (for Coordinator review — resolve before build)

**SDP-1 — Priority level labels.** The spec names only `Someday=1 … Critical=5` (decision #6); `drift.ts:32` confirms `3 = Medium`. The labels for 2 and 4 are undefined. **Proposed:** `1 Someday · 2 Low · 3 Medium · 4 High · 5 Critical`. (Matrix "important" = priority ≥ 4, matching `serialize.ts:12`.) Used in Task 6.

**SDP-2 — Task↔tag _assignment_ (RECOMMEND DEFER).** `app.task_tag_assignments` (table + list-match trigger + RLS) exists but is **entirely unwired**: no repo method, no route, no test, and `TaskDto` has no `tags` field. Wiring it fully means a `TaskDto.tags` contract ripple through `serializeTask` + every mock/test, assign/unassign routes, a tag filter on the list route, and UI chips. **Recommendation:** this milestone ships **tags as create + list _within a list_** (exactly what the backend supports today) and **defers task-level tag assignment + tag filtering to a fast-follow issue.** Lists (one per task, switchable, filterable) carry the organizational weight for M-A5. Coordinator to confirm cut or pull-in.

**SDP-3 — List/tag rename & delete (RECOMMEND DEFER).** No rename/delete routes exist; `list_id` is `ON DELETE RESTRICT`, so list-delete needs an empty-or-reassign UX. **Recommendation:** ship create + list + switch-a-task's-list this milestone; defer rename/delete to a fast-follow.

**SDP-4 — Recurrence editing in UI (RECOMMEND MINIMAL).** Backend supports `{freq,interval,occurrence_date}`. **Recommendation:** a single "Repeats" select (None / Daily / Weekly / Monthly) on capture + detail (interval fixed at 1), no custom cron UI. Coordinator to confirm minimal vs defer.

> If the Coordinator cuts SDP-2/3/4, drop the corresponding sub-steps; the core (capture, priority view, matrix, detail+subtasks, lists, status narrowing, preferences) stands alone and satisfies the remaining exit criteria.

---

## Pre-flight (one-time, before Task 1)

- [ ] Confirm worktree is on `feat/tasks-p3-web-ui` at `cda9f23`: `git -C ~/Jarv1s/jarvis-tasks-p3 log -1 --oneline` shows `cda9f23`. **Work only in `~/Jarv1s/jarvis-tasks-p3`** (the Coordinator runs the shared `~/Jarv1s` tree).
- [ ] `pnpm install` && `pnpm db:up` && `pnpm db:migrate` && `pnpm test:tasks` — confirm the tasks suite is green before changing anything. (Stop any running `dev:worker` first — it steals pg-boss jobs from integration tests.)
- [ ] `pnpm --filter @jarv1s/web typecheck` && `pnpm test:e2e` — confirm web typecheck + e2e green at baseline.

---

## File Structure

| File                                           | Responsibility                                                                                               | Action |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| `packages/shared/src/tasks-api.ts`             | Narrow `TASK_STATUSES`; extend `CreateTaskRequest`/`UpdateTaskRequest`; add Preferences + Subtasks contracts | Modify |
| `packages/db/src/types.ts`                     | Narrow `TaskStatus` to `todo\|done\|archived`                                                                | Modify |
| `packages/tasks/src/routes.ts`                 | Wire new fields in parsers; simplify status guard; preferences + subtasks routes                             | Modify |
| `packages/tasks/src/preferences.ts`            | `TaskPreferencesRepository` (get-or-create-default + update)                                                 | Create |
| `packages/tasks/src/serialize.ts`              | `serializeTaskPreferences`                                                                                   | Modify |
| `packages/tasks/src/index.ts`                  | Export preferences module                                                                                    | Modify |
| `packages/shared/src/tasks-view.ts`            | Priority levels, `quadrantOf(TaskDto)`, `groupByPriority` (single source for FE)                             | Create |
| `packages/shared/src/index.ts`                 | Export `tasks-view`                                                                                          | Modify |
| `apps/web/src/api/client.ts`                   | Client fns: lists, tags, subtasks, focus/at-risk/overdue, breakdown, preferences                             | Modify |
| `apps/web/src/api/query-keys.ts`               | Query keys for the new resources                                                                             | Modify |
| `apps/web/src/tasks/task-format.ts`            | Drop `in_progress`; effort labels; reuse view helpers                                                        | Modify |
| `apps/web/src/tasks/task-capture.tsx`          | Title-first quick-capture component                                                                          | Create |
| `apps/web/src/tasks/task-list-view.tsx`        | Priority-grouped list view                                                                                   | Create |
| `apps/web/src/tasks/task-matrix-view.tsx`      | Eisenhower Matrix view                                                                                       | Create |
| `apps/web/src/tasks/tasks-page.tsx`            | Page shell: view toggle (pref-backed), list/tag sidebar, filters; mounts capture + views                     | Modify |
| `apps/web/src/tasks/task-detail-page.tsx`      | New fields (list/do-date/effort/recurrence) + subtasks + activity                                            | Modify |
| `apps/web/src/tasks/tasks.css`                 | All new Tasks styles (keeps `styles.css` < 1000)                                                             | Create |
| `apps/web/src/main.tsx`                        | Import `tasks.css`                                                                                           | Modify |
| `tests/integration/tasks-web-contract.test.ts` | REST: new-field round-trip, preferences, subtasks, status narrowing guard                                    | Create |
| `tests/integration/tasks-view.test.ts`         | Pure unit: quadrant classification + priority grouping                                                       | Create |
| `tests/e2e/mock-api.ts`                        | Mock lists/tags/subtasks/preferences/focus; drop `in_progress`                                               | Modify |
| `tests/e2e/tasks.spec.ts`                      | e2e: capture, priority view, matrix toggle, detail+subtasks                                                  | Create |
| `tests/e2e/app-shell.spec.ts`                  | Update the existing "creates and updates tasks" test for the new UI                                          | Modify |

> **New tests go in NEW files** (`tasks-web-contract.test.ts`, `tasks-view.test.ts`): `tests/integration/tasks.test.ts` is at 950/1000 lines. Add only the smallest assertions there if unavoidable.

---

## Task 1: Atomic `TaskStatus` narrowing (ONE commit)

Narrowing `TaskStatus`/`TASK_STATUSES` to `todo|done|archived` **must** include the web edits in the same commit, because `pnpm typecheck` includes the web app and the current web pages reference `in_progress`. This is the carried-over task from Plans 1–2.

**Files:**

- Modify: `packages/shared/src/tasks-api.ts:1`
- Modify: `packages/db/src/types.ts` (the `TaskStatus` union — grep for it)
- Modify: `packages/tasks/src/routes.ts:444-459` (`optionalTaskStatus`)
- Modify: `apps/web/src/tasks/task-format.ts:3-8` (`statusLabels`)
- Modify: `apps/web/src/tasks/tasks-page.tsx:19` (`taskStatusFilters`), `:247-250` (dropdown), `:280-292` (`readStatusCounts`)
- Test: `tests/integration/tasks-web-contract.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/integration/tasks-web-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskApiStatus } from "@jarv1s/shared";

describe("tasks status contract (Plan 3 narrowing)", () => {
  it("TASK_STATUSES is narrowed to todo|done|archived; in_progress retired", () => {
    expect([...TASK_STATUSES]).toEqual(["todo", "done", "archived"]);
    // @ts-expect-error — in_progress is no longer assignable to TaskApiStatus
    const retired: TaskApiStatus = "in_progress";
    expect(retired).toBe("in_progress");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @jarv1s/shared typecheck`
      Expected: FAIL — `@ts-expect-error` is **unused** (because `in_progress` is still assignable), so TS reports "Unused '@ts-expect-error' directive". (Also `TASK_STATUSES` still contains `in_progress`, so the runtime `toEqual` would fail.)

- [ ] **Step 3: Narrow the shared contract** — `packages/shared/src/tasks-api.ts:1`:

```ts
export const TASK_STATUSES = ["todo", "done", "archived"] as const;
```

(`taskStatusSchema` already references `TASK_STATUSES`, so its enum narrows automatically. No other change in this file.)

- [ ] **Step 4: Narrow the db type** — `packages/db/src/types.ts`, the `TaskStatus` union:

```ts
export type TaskStatus = "todo" | "done" | "archived";
```

(The Postgres enum keeps `in_progress`; it is simply never written.)

- [ ] **Step 5: Simplify the route guard** — `packages/tasks/src/routes.ts`, replace `optionalTaskStatus` (lines ~444-459) with:

```ts
function optionalTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "todo" || value === "done" || value === "archived") {
    return value;
  }

  throw new HttpError(400, "status is invalid");
}
```

(`in_progress` now falls through to the 400. Fastify schema validation also rejects it pre-handler, so the existing `tasks.test.ts` "in_progress → 400" assertion still passes.)

- [ ] **Step 6: Drop `in_progress` from the web layer.**
  - `apps/web/src/tasks/task-format.ts:3-8`:

```ts
export const statusLabels: Record<TaskApiStatus, string> = {
  todo: "Open",
  done: "Done",
  archived: "Archived"
};
```

- `apps/web/src/tasks/tasks-page.tsx:19`:

```ts
const taskStatusFilters = ["all", "todo", "done", "archived"] as const;
```

- `apps/web/src/tasks/tasks-page.tsx` — remove the `<option value="in_progress">Doing</option>` line (~248) from the `TaskRow` status `<select>`.
- `apps/web/src/tasks/tasks-page.tsx` `readStatusCounts` (~280-292): remove `in_progress: 0` from the `counts` initializer.
- `task-detail-page.tsx` already renders from `statusLabels` via `Object.entries`, so no change there.

- [ ] **Step 7: Run** — `pnpm typecheck && vitest run tests/integration/tasks-web-contract.test.ts && pnpm test:tasks`
      Expected: typecheck green (web included); the narrowing test PASSES; `tasks.test.ts` still green.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/tasks-api.ts packages/db/src/types.ts packages/tasks/src/routes.ts \
  apps/web/src/tasks/task-format.ts apps/web/src/tasks/tasks-page.tsx \
  tests/integration/tasks-web-contract.test.ts
git commit -m "feat(tasks): narrow TaskStatus to todo|done|archived; retire in_progress across web"
```

---

## Task 2: Wire new task fields through REST (create/update)

**Files:**

- Modify: `packages/shared/src/tasks-api.ts:38-44,54-60` (request interfaces)
- Modify: `packages/tasks/src/routes.ts:348-370` (parsers), `:461-473` (`optionalPriority`)
- Test: `tests/integration/tasks-web-contract.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tasks-web-contract.test.ts`. (Follow the harness pattern in `tests/integration/tasks.test.ts` for `buildTestServer`/auth — copy its server-setup helper imports; the executor must mirror that file's `beforeAll`/`afterAll` and authenticated-request helper.)

```ts
// inside a `describe("tasks REST new-field wiring", ...)` that reuses tasks.test.ts's server harness
it("POST /api/tasks persists listId, doAt, and effort", async () => {
  const created = await postJson("/api/tasks", {
    title: "ship the deck",
    priority: 4,
    effort: "medium",
    doAt: "2026-06-10T12:00:00.000Z"
  });
  expect(created.statusCode).toBe(201);
  const task = created.json().task;
  expect(task.effort).toBe("medium");
  expect(task.doAt).toBe("2026-06-10T12:00:00.000Z");
  expect(task.priority).toBe(4);

  const patched = await patchJson(`/api/tasks/${task.id}`, { effort: "quick", doAt: null });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().task.effort).toBe("quick");
  expect(patched.json().task.doAt).toBeNull();
});
```

- [ ] **Step 2: Run** — `vitest run tests/integration/tasks-web-contract.test.ts -t "new-field"`. Expected: FAIL (`effort`/`doAt` come back `null` because the parser drops them).

- [ ] **Step 3: Extend the request interfaces** — `packages/shared/src/tasks-api.ts`:

```ts
export interface CreateTaskRequest {
  readonly title: string;
  readonly description?: string | null;
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
  readonly listId?: string;
  readonly doAt?: string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
}

export interface UpdateTaskRequest {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskApiStatus;
  readonly priority?: number | null;
  readonly dueAt?: string | null;
  readonly listId?: string;
  readonly doAt?: string | null;
  readonly effort?: "quick" | "medium" | "large" | null;
  readonly parentTaskId?: string | null;
  readonly recurrence?: Record<string, unknown> | null;
}
```

- [ ] **Step 4: Wire the parsers** — `packages/tasks/src/routes.ts`. Add helpers and extend both parse functions:

```ts
function optionalEffort(value: unknown): "quick" | "medium" | "large" | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "quick" || value === "medium" || value === "large") return value;
  throw new HttpError(400, "effort must be quick, medium, or large");
}

function optionalRecurrence(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "recurrence must be an object");
  }
  return value as Record<string, unknown>;
}
```

```ts
function parseCreateTaskBody(body: unknown) {
  const value = requireObject(body);

  return {
    title: requiredString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    status: optionalTaskStatus(value.status) ?? "todo",
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt"),
    listId: optionalString(value.listId, "listId"),
    doAt: optionalDate(value.doAt, "doAt"),
    effort: optionalEffort(value.effort),
    parentTaskId: optionalNullableString(value.parentTaskId, "parentTaskId"),
    recurrence: optionalRecurrence(value.recurrence)
  };
}

function parseUpdateTaskBody(body: unknown) {
  const value = requireObject(body);

  return {
    title: optionalString(value.title, "title"),
    description: optionalNullableString(value.description, "description"),
    status: optionalTaskStatus(value.status),
    priority: optionalPriority(value.priority),
    dueAt: optionalDate(value.dueAt, "dueAt"),
    listId: optionalString(value.listId, "listId"),
    doAt: optionalDate(value.doAt, "doAt"),
    effort: optionalEffort(value.effort),
    parentTaskId: optionalNullableString(value.parentTaskId, "parentTaskId"),
    recurrence: optionalRecurrence(value.recurrence)
  };
}
```

Then tighten `optionalPriority` (lines ~461-473) to the 1–5 contract (the schemas already enforce it; this aligns the parser):

```ts
function optionalPriority(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new HttpError(400, "priority must be an integer from 1 to 5");
  }
  return value;
}
```

> `CreateTaskInput`/`UpdateTaskInput` (`repository.ts:17-44`) already accept all of these — no repo change. `doAt`/`dueAt` pass `Date` objects from `optionalDate`; the repo accepts `Date | string | null`.

- [ ] **Step 5: Run** — `vitest run tests/integration/tasks-web-contract.test.ts && pnpm test:tasks`. Expected: PASS. If any `tasks.test.ts` priority assertion used a value outside 1–5, fix that assertion to a valid value.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tasks-api.ts packages/tasks/src/routes.ts tests/integration/tasks-web-contract.test.ts
git commit -m "feat(tasks): wire listId/doAt/effort/parentTaskId/recurrence through create+update REST"
```

---

## Task 3: `task_preferences` vertical slice (default_view)

**Files:**

- Modify: `packages/shared/src/tasks-api.ts` (append Preferences contract)
- Create: `packages/tasks/src/preferences.ts`
- Modify: `packages/tasks/src/serialize.ts`, `packages/tasks/src/routes.ts`, `packages/tasks/src/index.ts`
- Test: `tests/integration/tasks-web-contract.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tasks-web-contract.test.ts`:

```ts
it("GET /api/tasks/preferences defaults to priority; PATCH round-trips matrix", async () => {
  const initial = await getJson("/api/tasks/preferences");
  expect(initial.statusCode).toBe(200);
  expect(initial.json().preferences.defaultView).toBe("priority");

  const updated = await patchJson("/api/tasks/preferences", { defaultView: "matrix" });
  expect(updated.statusCode).toBe(200);
  expect(updated.json().preferences.defaultView).toBe("matrix");

  const reread = await getJson("/api/tasks/preferences");
  expect(reread.json().preferences.defaultView).toBe("matrix");
});
```

- [ ] **Step 2: Run** — Expected: FAIL (404, route absent).

- [ ] **Step 3: Add the contract** — append to `packages/shared/src/tasks-api.ts`:

```ts
// --- Task Preferences ---

export type TaskDefaultView = "priority" | "matrix";

export interface TaskPreferencesDto {
  readonly defaultView: TaskDefaultView;
  readonly updatedAt: string | null;
}

export interface GetTaskPreferencesResponse {
  readonly preferences: TaskPreferencesDto;
}

export interface UpdateTaskPreferencesRequest {
  readonly defaultView: TaskDefaultView;
}

export interface UpdateTaskPreferencesResponse {
  readonly preferences: TaskPreferencesDto;
}

export const taskPreferencesDtoSchema = {
  type: "object",
  required: ["defaultView", "updatedAt"],
  properties: {
    defaultView: { type: "string", enum: ["priority", "matrix"] },
    updatedAt: nullableStringSchema
  }
} as const;

export const getTaskPreferencesResponseSchema = {
  type: "object",
  required: ["preferences"],
  properties: { preferences: taskPreferencesDtoSchema }
} as const;

export const updateTaskPreferencesRequestSchema = {
  type: "object",
  required: ["defaultView"],
  properties: { defaultView: { type: "string", enum: ["priority", "matrix"] } }
} as const;

export const getTaskPreferencesRouteSchema = {
  response: { 200: getTaskPreferencesResponseSchema }
} as const;

export const updateTaskPreferencesRouteSchema = {
  body: updateTaskPreferencesRequestSchema,
  response: { 200: getTaskPreferencesResponseSchema }
} as const;
```

- [ ] **Step 4: Implement the repository** — create `packages/tasks/src/preferences.ts` (mirror the `lists.ts` get-or-create race pattern):

```ts
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type TaskPreferences } from "@jarv1s/db";

export class TaskPreferencesRepository {
  async getOrCreate(db: DataContextDb): Promise<TaskPreferences> {
    assertDataContextDb(db);

    const existing = await db.db.selectFrom("app.task_preferences").selectAll().executeTakeFirst();
    if (existing) return existing;

    const inserted = await db.db
      .insertInto("app.task_preferences")
      .values({ owner_user_id: sql<string>`app.current_actor_user_id()`, default_view: "priority" })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    return inserted ?? this.getOrCreate(db);
  }

  async update(db: DataContextDb, defaultView: "priority" | "matrix"): Promise<TaskPreferences> {
    assertDataContextDb(db);
    await this.getOrCreate(db); // ensure a row exists

    return db.db
      .updateTable("app.task_preferences")
      .set({ default_view: defaultView, updated_at: new Date() })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
```

> `TaskPreferences` is exported from `@jarv1s/db` (`Selectable<TaskPreferencesTable>`, defined in Plan 1). Verify the export name with `grep "TaskPreferences" packages/db/src/types.ts`; if it isn't exported, add `export type TaskPreferences = Selectable<TaskPreferencesTable>;` there in this task.

- [ ] **Step 5: Serializer + index** — `packages/tasks/src/serialize.ts` add:

```ts
import type { /* …existing… */ TaskPreferencesDto } from "@jarv1s/shared";
import type { /* …existing… */ TaskPreferences } from "@jarv1s/db";

export function serializeTaskPreferences(prefs: TaskPreferences): TaskPreferencesDto {
  return {
    defaultView: prefs.default_view,
    updatedAt: serializeDate(prefs.updated_at)
  };
}
```

`packages/tasks/src/index.ts` add: `export * from "./preferences.js";`

- [ ] **Step 6: Routes** — `packages/tasks/src/routes.ts`. Import the new schemas + `TaskPreferencesRepository` + `serializeTaskPreferences`, add `prefsRepository` to the constructed repos, and add two routes (place beside the Lists routes):

```ts
const prefsRepository = dependencies.preferencesRepository ?? new TaskPreferencesRepository();

server.get(
  "/api/tasks/preferences",
  { schema: getTaskPreferencesRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const prefs = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        prefsRepository.getOrCreate(scopedDb)
      );
      return { preferences: serializeTaskPreferences(prefs) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

server.patch(
  "/api/tasks/preferences",
  { schema: updateTaskPreferencesRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = requireObject(request.body);
      const defaultView = body["defaultView"];
      if (defaultView !== "priority" && defaultView !== "matrix") {
        throw new HttpError(400, "defaultView must be priority or matrix");
      }
      const prefs = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        prefsRepository.update(scopedDb, defaultView)
      );
      return { preferences: serializeTaskPreferences(prefs) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Add to `TasksRoutesDependencies` (after `driftRepository?`): `readonly preferencesRepository?: TaskPreferencesRepository;`

> **Route order caveat:** Fastify matches `/api/tasks/preferences` vs the param route `/api/tasks/:id` deterministically (static beats dynamic), so order is safe — but the existing `/api/tasks/lists` and `/api/tasks/focus` already prove this pattern works. No `:id` collision.

- [ ] **Step 7: Run** — `vitest run tests/integration/tasks-web-contract.test.ts -t "preferences" && pnpm typecheck`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/tasks-api.ts packages/tasks/src/preferences.ts \
  packages/tasks/src/serialize.ts packages/tasks/src/routes.ts packages/tasks/src/index.ts \
  tests/integration/tasks-web-contract.test.ts
git commit -m "feat(tasks): task_preferences vertical slice — GET/PATCH default_view"
```

---

## Task 4: Subtasks read route

**Files:**

- Modify: `packages/shared/src/tasks-api.ts` (route schema), `packages/tasks/src/routes.ts`
- Test: `tests/integration/tasks-web-contract.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
it("GET /api/tasks/:id/subtasks returns the parent's children in order", async () => {
  const parent = (await postJson("/api/tasks", { title: "clean kitchen" })).json().task;
  await postJson(`/api/tasks/${parent.id}/breakdown`, {
    steps: ["unload dishwasher", "wipe counters"]
  });

  const subtasks = await getJson(`/api/tasks/${parent.id}/subtasks`);
  expect(subtasks.statusCode).toBe(200);
  expect(subtasks.json().tasks.map((t: { title: string }) => t.title)).toEqual([
    "unload dishwasher",
    "wipe counters"
  ]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (404).

- [ ] **Step 3: Add the route schema** — `packages/shared/src/tasks-api.ts` (reuse the list response shape):

```ts
export const listSubtasksRouteSchema = {
  params: taskParamsSchema,
  response: { 200: listTasksResponseSchema }
} as const;
```

- [ ] **Step 4: Add the route** — `packages/tasks/src/routes.ts` (beside `GET /api/tasks/:id/activity`), importing `listSubtasksRouteSchema`:

```ts
server.get<{ Params: TaskParams }>(
  "/api/tasks/:id/subtasks",
  { schema: listSubtasksRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const tasks = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.listByParentId(scopedDb, request.params.id)
      );
      return { tasks: tasks.map(serializeTask) };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

- [ ] **Step 5: Run** — `vitest run tests/integration/tasks-web-contract.test.ts -t "subtasks" && pnpm test:tasks`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tasks-api.ts packages/tasks/src/routes.ts tests/integration/tasks-web-contract.test.ts
git commit -m "feat(tasks): GET /api/tasks/:id/subtasks read route"
```

---

## Task 5: Shared view helpers (priority + matrix) + unit test

Single source of truth for the FE priority levels and Eisenhower classification. Mirrors `serialize.ts:11-26` (`getQuadrant`) intentionally — backend works on snake_case `Task`, this works on camelCase `TaskDto`.

**Files:**

- Create: `packages/shared/src/tasks-view.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/integration/tasks-view.test.ts` (pure — no DB)

- [ ] **Step 1: Write the failing test** — create `tests/integration/tasks-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { groupByPriority, PRIORITY_LEVELS, quadrantOf, type TaskDto } from "@jarv1s/shared";

function task(partial: Partial<TaskDto>): TaskDto {
  return {
    id: "t",
    ownerUserId: "u",
    listId: "l",
    parentTaskId: null,
    title: "t",
    description: null,
    status: "todo",
    priority: null,
    position: 0,
    dueAt: null,
    doAt: null,
    effort: null,
    source: "manual",
    sourceRef: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    ...partial
  };
}

describe("tasks-view", () => {
  it("PRIORITY_LEVELS is Critical→Someday (5..1)", () => {
    expect(PRIORITY_LEVELS.map((l) => l.value)).toEqual([5, 4, 3, 2, 1]);
    expect(PRIORITY_LEVELS[0].label).toBe("Critical");
    expect(PRIORITY_LEVELS[4].label).toBe("Someday");
  });

  it("quadrantOf classifies important(>=4) × urgent(due<=48h)", () => {
    const soon = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    const far = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    expect(quadrantOf(task({ priority: 5, dueAt: soon }))).toBe("do");
    expect(quadrantOf(task({ priority: 5, dueAt: far }))).toBe("schedule");
    expect(quadrantOf(task({ priority: 2, dueAt: soon }))).toBe("delegate");
    expect(quadrantOf(task({ priority: 1, dueAt: far }))).toBe("eliminate");
    expect(quadrantOf(task({ priority: null, dueAt: null }))).toBe("eliminate");
  });

  it("groupByPriority returns 5..1 then null, each sorted by due then title", () => {
    const groups = groupByPriority([
      task({ id: "a", title: "b", priority: 5 }),
      task({ id: "b", title: "a", priority: 5 }),
      task({ id: "c", title: "n", priority: null })
    ]);
    expect(groups.map((g) => g.value)).toEqual([5, 4, 3, 2, 1, null]);
    const critical = groups.find((g) => g.value === 5)!;
    expect(critical.tasks.map((t) => t.title)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run** — `vitest run tests/integration/tasks-view.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — create `packages/shared/src/tasks-view.ts`:

```ts
import type { TaskDto } from "./tasks-api.js";

export type TaskQuadrant = "do" | "schedule" | "delegate" | "eliminate";

export interface PriorityLevel {
  readonly value: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
}

/** 5..1, highest first (SDP-1: Someday=1 … Critical=5). */
export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  { value: 5, label: "Critical" },
  { value: 4, label: "High" },
  { value: 3, label: "Medium" },
  { value: 2, label: "Low" },
  { value: 1, label: "Someday" }
];

export function priorityLabel(priority: number | null): string {
  return PRIORITY_LEVELS.find((l) => l.value === priority)?.label ?? "No priority";
}

export interface QuadrantMeta {
  readonly key: TaskQuadrant;
  readonly title: string;
  readonly subtitle: string;
}

/** Eisenhower order: important×urgent. */
export const QUADRANTS: readonly QuadrantMeta[] = [
  { key: "do", title: "Do First", subtitle: "Important & urgent" },
  { key: "schedule", title: "Schedule", subtitle: "Important, not urgent" },
  { key: "delegate", title: "Delegate", subtitle: "Urgent, not important" },
  { key: "eliminate", title: "Later", subtitle: "Neither" }
];

/** Mirrors backend serialize.ts getQuadrant: important = priority>=4; urgent = due within 48h (incl. overdue). */
export function quadrantOf(task: TaskDto): TaskQuadrant {
  const important = task.priority !== null && task.priority >= 4;
  let urgent = false;
  if (task.dueAt) {
    const hoursUntilDue = (new Date(task.dueAt).getTime() - Date.now()) / 3_600_000;
    urgent = hoursUntilDue <= 48;
  }
  if (important && urgent) return "do";
  if (important && !urgent) return "schedule";
  if (!important && urgent) return "delegate";
  return "eliminate";
}

export interface PriorityGroup {
  readonly value: 1 | 2 | 3 | 4 | 5 | null;
  readonly label: string;
  readonly tasks: TaskDto[];
}

function byDueThenTitle(a: TaskDto, b: TaskDto): number {
  const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return ad - bd || a.title.localeCompare(b.title);
}

/** Groups into 5..1 then a trailing "No priority" (null) group. Empty groups are kept (UI may hide them). */
export function groupByPriority(tasks: readonly TaskDto[]): PriorityGroup[] {
  const groups: PriorityGroup[] = PRIORITY_LEVELS.map((l) => ({
    value: l.value,
    label: l.label,
    tasks: tasks.filter((t) => t.priority === l.value).sort(byDueThenTitle)
  }));
  groups.push({
    value: null,
    label: "No priority",
    tasks: tasks.filter((t) => t.priority === null).sort(byDueThenTitle)
  });
  return groups;
}

export function quadrantTasks(tasks: readonly TaskDto[], quadrant: TaskQuadrant): TaskDto[] {
  return tasks.filter((t) => quadrantOf(t) === quadrant).sort(byDueThenTitle);
}
```

- [ ] **Step 4: Export** — `packages/shared/src/index.ts` add: `export * from "./tasks-view.js";`

  > Verify `packages/shared/src/index.ts` re-exports `tasks-api.js` already (it must, since the web imports `TaskDto` from `@jarv1s/shared`). Match the existing `.js` extension convention in that file.

- [ ] **Step 5: Run** — `vitest run tests/integration/tasks-view.test.ts && pnpm --filter @jarv1s/shared typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tasks-view.ts packages/shared/src/index.ts tests/integration/tasks-view.test.ts
git commit -m "feat(shared): tasks-view — priority levels, Eisenhower quadrants, grouping helpers"
```

---

## Task 6: Web API client + query-keys plumbing

Add the client functions and query keys the new UI needs. (No new test here — exercised by typecheck + e2e in Task 13. Unused exported functions are fine for lint.)

**Files:**

- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts`

- [ ] **Step 1: Extend the client** — `apps/web/src/api/client.ts`. Add to the `@jarv1s/shared` type import block: `BreakdownTaskRequest, BreakdownTaskResponse, CreateTaskListRequest, CreateTaskListResponse, CreateTaskTagRequest, CreateTaskTagResponse, GetTaskPreferencesResponse, ListTaskListsResponse, ListTaskTagsResponse, UpdateTaskPreferencesRequest, UpdateTaskPreferencesResponse`. Then add these functions near the other task functions:

```ts
export async function listSubtasks(id: string): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>(`/api/tasks/${encodeURIComponent(id)}/subtasks`);
}

export async function breakdownTask(
  id: string,
  input: BreakdownTaskRequest
): Promise<BreakdownTaskResponse> {
  return requestJson<BreakdownTaskResponse>(`/api/tasks/${encodeURIComponent(id)}/breakdown`, {
    method: "POST",
    body: input
  });
}

export async function listFocusTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/focus");
}

export async function listAtRiskTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/at-risk");
}

export async function listOverdueTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/overdue");
}

export async function listTaskLists(): Promise<ListTaskListsResponse> {
  return requestJson<ListTaskListsResponse>("/api/tasks/lists");
}

export async function createTaskList(
  input: CreateTaskListRequest
): Promise<CreateTaskListResponse> {
  return requestJson<CreateTaskListResponse>("/api/tasks/lists", { method: "POST", body: input });
}

export async function listTaskTags(listId: string): Promise<ListTaskTagsResponse> {
  return requestJson<ListTaskTagsResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}/tags`);
}

export async function createTaskTag(
  listId: string,
  input: CreateTaskTagRequest
): Promise<CreateTaskTagResponse> {
  return requestJson<CreateTaskTagResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}/tags`, {
    method: "POST",
    body: input
  });
}

export async function getTaskPreferences(): Promise<GetTaskPreferencesResponse> {
  return requestJson<GetTaskPreferencesResponse>("/api/tasks/preferences");
}

export async function updateTaskPreferences(
  input: UpdateTaskPreferencesRequest
): Promise<UpdateTaskPreferencesResponse> {
  return requestJson<UpdateTaskPreferencesResponse>("/api/tasks/preferences", {
    method: "PATCH",
    body: input
  });
}
```

- [ ] **Step 2: Extend query keys** — `apps/web/src/api/query-keys.ts`, replace the `tasks:` block:

```ts
  tasks: {
    list: ["tasks", "list"] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    activity: (id: string) => ["tasks", "activity", id] as const,
    subtasks: (id: string) => ["tasks", "subtasks", id] as const,
    lists: ["tasks", "lists"] as const,
    tags: (listId: string) => ["tasks", "tags", listId] as const,
    preferences: ["tasks", "preferences"] as const
  }
```

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts
git commit -m "feat(web): api client + query keys for lists, tags, subtasks, preferences, drift"
```

---

## Task 7: Web task-format helpers + Tasks stylesheet bootstrap

Establishes `tasks.css` (so later web tasks append styles here, never to the 945-line `styles.css`) and adds effort labels.

**Files:**

- Modify: `apps/web/src/tasks/task-format.ts`
- Create: `apps/web/src/tasks/tasks.css`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Add effort labels** — `apps/web/src/tasks/task-format.ts`, append:

```ts
export const effortLabels: Record<"quick" | "medium" | "large", string> = {
  quick: "Quick",
  medium: "Medium",
  large: "Large"
};

export function effortLabel(effort: "quick" | "medium" | "large" | null): string | null {
  return effort ? effortLabels[effort] : null;
}
```

- [ ] **Step 2: Create the stylesheet** — create `apps/web/src/tasks/tasks.css` with a header comment (later tasks append rules):

```css
/* Tasks UI styles (M-A5 Plan 3). Kept separate from styles.css to respect the 1000-line cap. */

.tasks-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem;
}
```

- [ ] **Step 3: Import it** — `apps/web/src/main.tsx`, add after `import "./styles.css";`:

```ts
import "./tasks/tasks.css";
```

- [ ] **Step 4: Run** — `pnpm --filter @jarv1s/web typecheck && pnpm check:file-size`. Expected: green (styles.css unchanged, under cap).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tasks/task-format.ts apps/web/src/tasks/tasks.css apps/web/src/main.tsx
git commit -m "feat(web): effort labels + dedicated tasks.css stylesheet"
```

---

## Task 8: Quick-capture component (title-first)

EF-first capture: a single always-focused title field that submits on Enter; optional fields (list, priority, do-date, effort, repeats) live behind a "More" disclosure so the fast path stays one keystroke.

**Files:**

- Create: `apps/web/src/tasks/task-capture.tsx`
- Modify: `apps/web/src/tasks/tasks.css` (append)

- [ ] **Step 1: Implement the component** — create `apps/web/src/tasks/task-capture.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PRIORITY_LEVELS } from "@jarv1s/shared";

import { createTask, listTaskLists } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { fromDateInputValue } from "./task-format";

type Repeats = "" | "daily" | "weekly" | "monthly";

export function TaskCapture(props: { readonly defaultListId?: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [listId, setListId] = useState("");
  const [priority, setPriority] = useState("");
  const [doAt, setDoAt] = useState("");
  const [effort, setEffort] = useState("");
  const [repeats, setRepeats] = useState<Repeats>("");
  const [formError, setFormError] = useState<string | null>(null);

  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });

  const createMutation = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        listId: listId || props.defaultListId || undefined,
        priority: priority ? Number(priority) : null,
        doAt: fromDateInputValue(doAt),
        effort: (effort || null) as "quick" | "medium" | "large" | null,
        recurrence: repeats ? { freq: repeats, interval: 1 } : null
      }),
    onSuccess: async () => {
      setTitle("");
      setPriority("");
      setDoAt("");
      setEffort("");
      setRepeats("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="task-capture" onSubmit={handleSubmit} aria-label="Capture a task">
      <div className="task-capture-row">
        <input
          aria-label="Task title"
          autoFocus
          className="task-capture-input"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task…"
          type="text"
          value={title}
        />
        <button
          className="primary-button"
          disabled={createMutation.isPending || !title.trim()}
          type="submit"
        >
          {createMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
          Add
        </button>
      </div>

      <button
        aria-expanded={showMore}
        className="task-capture-more"
        onClick={() => setShowMore((value) => !value)}
        type="button"
      >
        <ChevronDown size={15} aria-hidden="true" /> More options
      </button>

      {showMore ? (
        <div className="task-capture-fields">
          <label>
            List
            <select onChange={(event) => setListId(event.target.value)} value={listId}>
              <option value="">{props.defaultListId ? "Default" : "Personal"}</option>
              {(listsQuery.data?.lists ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select onChange={(event) => setPriority(event.target.value)} value={priority}>
              <option value="">None</option>
              {PRIORITY_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Do on
            <input onChange={(event) => setDoAt(event.target.value)} type="date" value={doAt} />
          </label>
          <label>
            Effort
            <select onChange={(event) => setEffort(event.target.value)} value={effort}>
              <option value="">—</option>
              <option value="quick">Quick</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Repeats
            <select onChange={(event) => setRepeats(event.target.value as Repeats)} value={repeats}>
              <option value="">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
      ) : null}

      {formError ? <p className="form-error">{formError}</p> : null}
    </form>
  );
}
```

> If the Coordinator cuts SDP-4 (recurrence), remove the `repeats` state + the "Repeats" field + the `recurrence:` line.

- [ ] **Step 2: Append styles** — `apps/web/src/tasks/tasks.css`:

```css
.task-capture {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.task-capture-row {
  display: flex;
  gap: 0.5rem;
}
.task-capture-input {
  flex: 1;
}
.task-capture-more {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--text-muted, #6b7280);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  padding: 0;
}
.task-capture-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.75rem;
}
.task-capture-fields label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}
```

> Reuse existing CSS variables/classes where present (inspect `styles.css` for `--text-muted`, `.primary-button`, `.form-error`, input styling). Match the existing visual language; do not introduce a new palette.

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/task-capture.tsx apps/web/src/tasks/tasks.css
git commit -m "feat(web): title-first quick-capture component with optional fields"
```

---

## Task 9: Priority-grouped list view component

**Files:**

- Create: `apps/web/src/tasks/task-list-view.tsx`
- Modify: `apps/web/src/tasks/tasks.css` (append)

- [ ] **Step 1: Implement** — create `apps/web/src/tasks/task-list-view.tsx`:

```tsx
import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";

import { groupByPriority, type TaskApiStatus, type TaskDto } from "@jarv1s/shared";

import { effortLabel, formatDate } from "./task-format";

export function TaskListView(props: {
  readonly tasks: readonly TaskDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  const groups = groupByPriority(props.tasks).filter((group) => group.tasks.length > 0);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="task-groups">
      {groups.map((group) => (
        <section
          className="task-group"
          key={group.value ?? "none"}
          aria-label={`${group.label} priority`}
        >
          <header className={`task-group-header priority-${group.value ?? "none"}`}>
            <span>{group.label}</span>
            <span className="task-group-count">{group.tasks.length}</span>
          </header>
          <ul className="task-group-list">
            {group.tasks.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                isUpdating={props.isUpdating}
                onToggleDone={props.onToggleDone}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskLine(props: {
  readonly task: TaskDto;
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  const done = props.task.status === "done";
  const effort = effortLabel(props.task.effort);

  return (
    <li className={`task-line ${done ? "done" : ""}`}>
      <button
        aria-label={done ? `Reopen ${props.task.title}` : `Complete ${props.task.title}`}
        className="task-check icon-button"
        disabled={props.isUpdating}
        onClick={() => props.onToggleDone(props.task)}
        type="button"
      >
        {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
      </button>
      <Link className="task-line-title" to={`/tasks/${props.task.id}`}>
        {props.task.title}
      </Link>
      <div className="task-line-meta">
        {props.task.dueAt ? <span className="task-due">{formatDate(props.task.dueAt)}</span> : null}
        {effort ? <span className="task-effort">{effort}</span> : null}
      </div>
    </li>
  );
}

export type { TaskApiStatus };
```

> The `status` filtering (which `tasks` to pass in) is done by the page (Task 11); this component just renders + groups whatever it is given.

- [ ] **Step 2: Append styles** — `apps/web/src/tasks/tasks.css`:

```css
.task-groups {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.task-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.25rem 0;
  border-bottom: 2px solid var(--border, #e5e7eb);
}
.task-group-header.priority-5 {
  border-bottom-color: #dc2626;
}
.task-group-header.priority-4 {
  border-bottom-color: #ea580c;
}
.task-group-header.priority-3 {
  border-bottom-color: #ca8a04;
}
.task-group-header.priority-2 {
  border-bottom-color: #2563eb;
}
.task-group-header.priority-1 {
  border-bottom-color: #6b7280;
}
.task-group-header.priority-none {
  border-bottom-color: #d1d5db;
}
.task-group-count {
  color: var(--text-muted, #6b7280);
  font-weight: 500;
}
.task-group-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.task-line {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-subtle, #f3f4f6);
}
.task-line.done .task-line-title {
  text-decoration: line-through;
  color: var(--text-muted, #9ca3af);
}
.task-line-title {
  flex: 1;
  text-decoration: none;
  color: inherit;
}
.task-line-title:hover {
  text-decoration: underline;
}
.task-line-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted, #6b7280);
}
```

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/task-list-view.tsx apps/web/src/tasks/tasks.css
git commit -m "feat(web): priority-grouped task list view"
```

---

## Task 10: Eisenhower Matrix view component

**Files:**

- Create: `apps/web/src/tasks/task-matrix-view.tsx`
- Modify: `apps/web/src/tasks/tasks.css` (append)

- [ ] **Step 1: Implement** — create `apps/web/src/tasks/task-matrix-view.tsx`:

```tsx
import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";

import { QUADRANTS, quadrantTasks, type TaskDto } from "@jarv1s/shared";

export function TaskMatrixView(props: {
  readonly tasks: readonly TaskDto[];
  readonly isUpdating: boolean;
  readonly onToggleDone: (task: TaskDto) => void;
}) {
  return (
    <div className="task-matrix" role="grid" aria-label="Eisenhower matrix">
      {QUADRANTS.map((quadrant) => {
        const tasks = quadrantTasks(props.tasks, quadrant.key);
        return (
          <section
            className={`matrix-cell matrix-${quadrant.key}`}
            key={quadrant.key}
            role="gridcell"
          >
            <header className="matrix-cell-header">
              <span className="matrix-cell-title">{quadrant.title}</span>
              <span className="matrix-cell-subtitle">{quadrant.subtitle}</span>
            </header>
            {tasks.length === 0 ? (
              <p className="matrix-empty">Nothing here</p>
            ) : (
              <ul className="matrix-cell-list">
                {tasks.map((task) => (
                  <li className={`task-line ${task.status === "done" ? "done" : ""}`} key={task.id}>
                    <button
                      aria-label={
                        task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`
                      }
                      className="task-check icon-button"
                      disabled={props.isUpdating}
                      onClick={() => props.onToggleDone(task)}
                      type="button"
                    >
                      {task.status === "done" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
                    <Link className="task-line-title" to={`/tasks/${task.id}`}>
                      {task.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Append styles** — `apps/web/src/tasks/tasks.css`:

```css
.task-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.matrix-cell {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 0.6rem;
  padding: 0.85rem;
  min-height: 9rem;
}
.matrix-cell.matrix-do {
  border-top: 3px solid #dc2626;
}
.matrix-cell.matrix-schedule {
  border-top: 3px solid #2563eb;
}
.matrix-cell.matrix-delegate {
  border-top: 3px solid #ca8a04;
}
.matrix-cell.matrix-eliminate {
  border-top: 3px solid #9ca3af;
}
.matrix-cell-header {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.5rem;
}
.matrix-cell-title {
  font-weight: 600;
}
.matrix-cell-subtitle {
  font-size: 0.75rem;
  color: var(--text-muted, #6b7280);
}
.matrix-cell-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.matrix-empty {
  color: var(--text-muted, #9ca3af);
  font-size: 0.82rem;
  margin: 0.5rem 0 0;
}
@media (max-width: 720px) {
  .task-matrix {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/task-matrix-view.tsx apps/web/src/tasks/tasks.css
git commit -m "feat(web): Eisenhower matrix view"
```

---

## Task 11: Tasks page assembly — view toggle (pref-backed), list/tag sidebar, filters

Replaces the body of `tasks-page.tsx`. Mounts `TaskCapture` + the two views; a view toggle reads/writes `default_view`; a sidebar lists the user's lists (as filters) with create-list + create-tag forms (SDP-2/3: create + filter only, no assignment/delete this milestone).

**Files:**

- Modify: `apps/web/src/tasks/tasks-page.tsx` (rewrite)
- Modify: `apps/web/src/tasks/tasks.css` (append)

- [ ] **Step 1: Rewrite the page** — replace `apps/web/src/tasks/tasks-page.tsx` with:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDefaultView, TaskDto } from "@jarv1s/shared";
import { LayoutGrid, List as ListIcon, LoaderCircle, Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import {
  createTaskList,
  createTaskTag,
  getTaskPreferences,
  listTaskLists,
  listTasks,
  listTaskTags,
  updateTask,
  updateTaskPreferences
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { TaskCapture } from "./task-capture";
import { TaskListView } from "./task-list-view";
import { TaskMatrixView } from "./task-matrix-view";
import { statusLabels } from "./task-format";

const statusFilters = ["all", "todo", "done", "archived"] as const;
type StatusFilter = (typeof statusFilters)[number];

export function TasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todo");
  const [search, setSearch] = useState("");
  const [activeListId, setActiveListId] = useState<string | null>(null);

  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
  const prefsQuery = useQuery({
    queryKey: queryKeys.tasks.preferences,
    queryFn: getTaskPreferences
  });

  const view: TaskDefaultView = prefsQuery.data?.preferences.defaultView ?? "priority";

  const viewMutation = useMutation({
    mutationFn: (next: TaskDefaultView) => updateTaskPreferences({ defaultView: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.preferences });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (task: TaskDto) =>
      updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.list });
    }
  });

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (tasksQuery.data?.tasks ?? []).filter((task) => {
      if (task.parentTaskId !== null) return false; // subtasks render on the detail page
      if (activeListId && task.listId !== activeListId) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (
        needle &&
        !task.title.toLowerCase().includes(needle) &&
        !(task.description?.toLowerCase().includes(needle) ?? false)
      ) {
        return false;
      }
      return true;
    });
  }, [activeListId, search, statusFilter, tasksQuery.data?.tasks]);

  return (
    <section className="page-stack" aria-labelledby="tasks-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1 id="tasks-title">Tasks</h1>
        </div>
        <div className="segmented-control" role="group" aria-label="View">
          <button
            aria-pressed={view === "priority"}
            className={view === "priority" ? "active" : ""}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("priority")}
            type="button"
          >
            <ListIcon size={16} aria-hidden="true" /> Priority
          </button>
          <button
            aria-pressed={view === "matrix"}
            className={view === "matrix" ? "active" : ""}
            disabled={viewMutation.isPending}
            onClick={() => viewMutation.mutate("matrix")}
            type="button"
          >
            <LayoutGrid size={16} aria-hidden="true" /> Matrix
          </button>
        </div>
      </div>

      <div className="panel">
        <TaskCapture defaultListId={activeListId ?? undefined} />
      </div>

      <div className="tasks-body">
        <aside className="tasks-sidebar" aria-label="Lists">
          <ListSidebar
            activeListId={activeListId}
            lists={listsQuery.data?.lists ?? []}
            onSelect={setActiveListId}
          />
        </aside>

        <div className="tasks-main">
          <section className="task-toolbar" aria-label="Filters">
            <div className="segmented-control wide" aria-label="Status filter">
              {statusFilters.map((status) => (
                <button
                  className={statusFilter === status ? "active" : ""}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  {status === "all" ? "All" : statusLabels[status]}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="Search tasks"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks"
                type="search"
                value={search}
              />
            </label>
          </section>

          {tasksQuery.isLoading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
              <p>Loading tasks</p>
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="empty-state">
              <p>No tasks</p>
            </div>
          ) : view === "matrix" ? (
            <TaskMatrixView
              tasks={visibleTasks}
              isUpdating={updateMutation.isPending}
              onToggleDone={(task) => updateMutation.mutate(task)}
            />
          ) : (
            <TaskListView
              tasks={visibleTasks}
              isUpdating={updateMutation.isPending}
              onToggleDone={(task) => updateMutation.mutate(task)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ListSidebar(props: {
  readonly lists: readonly { readonly id: string; readonly name: string }[];
  readonly activeListId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newList, setNewList] = useState("");
  const [newTag, setNewTag] = useState("");

  const createListMutation = useMutation({
    mutationFn: () => createTaskList({ name: newList.trim() }),
    onSuccess: async () => {
      setNewList("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists });
    }
  });

  const tagsQuery = useQuery({
    enabled: Boolean(props.activeListId),
    queryKey: queryKeys.tasks.tags(props.activeListId ?? ""),
    queryFn: () => listTaskTags(props.activeListId ?? "")
  });

  const createTagMutation = useMutation({
    mutationFn: () => createTaskTag(props.activeListId ?? "", { name: newTag.trim() }),
    onSuccess: async () => {
      setNewTag("");
      if (props.activeListId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.tags(props.activeListId) });
      }
    }
  });

  const submitList = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newList.trim()) createListMutation.mutate();
  };
  const submitTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newTag.trim() && props.activeListId) createTagMutation.mutate();
  };

  return (
    <>
      <h2 className="sidebar-title">Lists</h2>
      <ul className="list-nav">
        <li>
          <button
            className={props.activeListId === null ? "active" : ""}
            onClick={() => props.onSelect(null)}
            type="button"
          >
            All
          </button>
        </li>
        {props.lists.map((list) => (
          <li key={list.id}>
            <button
              className={props.activeListId === list.id ? "active" : ""}
              onClick={() => props.onSelect(list.id)}
              type="button"
            >
              {list.name}
            </button>
          </li>
        ))}
      </ul>

      <form className="sidebar-form" onSubmit={submitList}>
        <input
          aria-label="New list name"
          onChange={(event) => setNewList(event.target.value)}
          placeholder="New list"
          type="text"
          value={newList}
        />
        <button
          className="icon-button"
          disabled={createListMutation.isPending}
          type="submit"
          aria-label="Add list"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </form>

      {props.activeListId ? (
        <div className="sidebar-tags">
          <h3 className="sidebar-subtitle">Tags</h3>
          <ul className="tag-list">
            {(tagsQuery.data?.tags ?? []).map((tag) => (
              <li className="tag-chip" key={tag.id}>
                {tag.name}
              </li>
            ))}
          </ul>
          <form className="sidebar-form" onSubmit={submitTag}>
            <input
              aria-label="New tag name"
              onChange={(event) => setNewTag(event.target.value)}
              placeholder="New tag"
              type="text"
              value={newTag}
            />
            <button
              className="icon-button"
              disabled={createTagMutation.isPending}
              type="submit"
              aria-label="Add tag"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
```

> **Default status filter is `todo`** (Open) so the board opens on the actionable list, not archived clutter. **Subtasks are excluded** from the board (`parentTaskId !== null`) — they live on the parent's detail page.

- [ ] **Step 2: Append styles** — `apps/web/src/tasks/tasks.css`:

```css
.tasks-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 1.25rem;
}
.tasks-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.sidebar-title {
  font-size: 0.95rem;
  margin: 0;
}
.sidebar-subtitle {
  font-size: 0.8rem;
  margin: 0.75rem 0 0.25rem;
  color: var(--text-muted, #6b7280);
}
.list-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.list-nav button {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 0.35rem;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  color: inherit;
}
.list-nav button.active {
  background: var(--surface-active, #eef2ff);
  font-weight: 600;
}
.sidebar-form {
  display: flex;
  gap: 0.35rem;
}
.sidebar-form input {
  flex: 1;
}
.tag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.tag-chip {
  font-size: 0.75rem;
  background: var(--surface-subtle, #f3f4f6);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
}
.tasks-main {
  min-width: 0;
}
@media (max-width: 720px) {
  .tasks-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck && pnpm check:file-size`. Expected: green; `tasks-page.tsx` and `tasks.css` both under 1000.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/tasks-page.tsx apps/web/src/tasks/tasks.css
git commit -m "feat(web): tasks page — pref-backed view toggle, list/tag sidebar, filters"
```

---

## Task 12: Task detail — new fields + subtasks + breakdown

**Files:**

- Modify: `apps/web/src/tasks/task-detail-page.tsx`
- Modify: `apps/web/src/tasks/tasks.css` (append)

- [ ] **Step 1: Extend the detail page.** Add list/do-date/effort/repeats to the Fields form, and a Subtasks panel (list current subtasks + add-by-breakdown). Apply these focused edits to `task-detail-page.tsx`:

  (a) Imports — add to the existing imports:

```tsx
import { ListTree } from "lucide-react";

import { PRIORITY_LEVELS } from "@jarv1s/shared";

import { breakdownTask, listSubtasks, listTaskLists } from "../api/client";
import { effortLabel } from "./task-format";
```

(b) State — add alongside the existing `useState` calls:

```tsx
const [doAt, setDoAt] = useState("");
const [effort, setEffort] = useState("");
const [listId, setListId] = useState("");
const [steps, setSteps] = useState("");
```

(c) Queries — add:

```tsx
const listsQuery = useQuery({ queryKey: queryKeys.tasks.lists, queryFn: listTaskLists });
const subtasksQuery = useQuery({
  enabled: Boolean(taskId),
  queryKey: queryKeys.tasks.subtasks(taskId ?? ""),
  queryFn: () => listSubtasks(taskId ?? "")
});
```

(d) Hydrate — extend the existing `useEffect` that seeds form state from `taskQuery.data?.task`:

```tsx
setDoAt(toDateInputValue(task.doAt));
setEffort(task.effort ?? "");
setListId(task.listId);
```

(e) Save mutation — extend the `updateTask(...)` payload in `saveMutation`:

```tsx
return updateTask(taskId, {
  title,
  description: description || null,
  status,
  dueAt: fromDateInputValue(dueAt),
  doAt: fromDateInputValue(doAt),
  priority: priority ? Number(priority) : null,
  effort: (effort || null) as "quick" | "medium" | "large" | null,
  listId: listId || undefined
});
```

(f) Breakdown mutation — add:

```tsx
const breakdownMutation = useMutation({
  mutationFn: () => {
    if (!taskId) throw new Error("Task id is missing");
    const items = steps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return breakdownTask(taskId, { steps: items });
  },
  onSuccess: async () => {
    setSteps("");
    if (taskId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.subtasks(taskId) });
    }
  }
});
```

(g) Priority `<input type=number>` → replace with a select (the contract is 1–5):

```tsx
<label>
  Priority
  <select onChange={(event) => setPriority(event.target.value)} value={priority}>
    <option value="">None</option>
    {PRIORITY_LEVELS.map((level) => (
      <option key={level.value} value={level.value}>
        {level.label}
      </option>
    ))}
  </select>
</label>
```

(h) Add List / Do-on / Effort fields after the Due field:

```tsx
<label>
  List
  <select onChange={(event) => setListId(event.target.value)} value={listId}>
    {(listsQuery.data?.lists ?? []).map((list) => (
      <option key={list.id} value={list.id}>
        {list.name}
      </option>
    ))}
  </select>
</label>
<label>
  Do on
  <input onChange={(event) => setDoAt(event.target.value)} type="date" value={doAt} />
</label>
<label>
  Effort
  <select onChange={(event) => setEffort(event.target.value)} value={effort}>
    <option value="">—</option>
    <option value="quick">Quick</option>
    <option value="medium">Medium</option>
    <option value="large">Large</option>
  </select>
</label>
```

(i) Subtasks panel — add a third panel inside `.detail-grid`, before the Activity panel (only show breakdown form when the task itself is a top-level task; subtasks can't have children — guard on `taskQuery.data?.task.parentTaskId === null`):

```tsx
<section className="panel" aria-labelledby="subtasks-title">
  <div className="panel-heading">
    <ListTree size={20} aria-hidden="true" />
    <h2 id="subtasks-title">Subtasks</h2>
  </div>
  {subtasksQuery.data && subtasksQuery.data.tasks.length > 0 ? (
    <ul className="subtask-list">
      {subtasksQuery.data.tasks.map((sub) => (
        <li className={`subtask-item ${sub.status === "done" ? "done" : ""}`} key={sub.id}>
          <Link to={`/tasks/${sub.id}`}>{sub.title}</Link>
          {effortLabel(sub.effort) ? (
            <span className="task-effort">{effortLabel(sub.effort)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="empty-hint">No subtasks yet.</p>
  )}
  {taskQuery.data?.task.parentTaskId === null ? (
    <form
      className="subtask-form"
      onSubmit={(event) => {
        event.preventDefault();
        breakdownMutation.mutate();
      }}
    >
      <label>
        Break into steps (one per line)
        <textarea
          onChange={(event) => setSteps(event.target.value)}
          placeholder={"unload dishwasher\nwipe counters"}
          rows={3}
          value={steps}
        />
      </label>
      {breakdownMutation.error ? (
        <p className="form-error">{breakdownMutation.error.message}</p>
      ) : null}
      <button className="secondary-button" disabled={breakdownMutation.isPending} type="submit">
        {breakdownMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <ListTree size={18} aria-hidden="true" />
        )}
        Add steps
      </button>
    </form>
  ) : null}
</section>
```

> `Link` and `LoaderCircle` are already imported in this file. Keep the page title "Edit Task". Watch the file size — if `task-detail-page.tsx` approaches 1000 lines (it starts at 276; these additions are well within budget), it stays one file.

- [ ] **Step 2: Append styles** — `apps/web/src/tasks/tasks.css`:

```css
.subtask-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.subtask-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.subtask-item.done a {
  text-decoration: line-through;
  color: var(--text-muted, #9ca3af);
}
.subtask-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.empty-hint {
  color: var(--text-muted, #9ca3af);
  font-size: 0.85rem;
}
.task-effort {
  font-size: 0.72rem;
  background: var(--surface-subtle, #f3f4f6);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}
```

- [ ] **Step 3: Run** — `pnpm --filter @jarv1s/web typecheck && pnpm check:file-size`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/tasks/task-detail-page.tsx apps/web/src/tasks/tasks.css
git commit -m "feat(web): task detail — list/do-date/effort fields + subtasks & breakdown"
```

---

## Task 13: e2e coverage + full gate + close-out

**Files:**

- Modify: `tests/e2e/mock-api.ts` (add new routes; drop `in_progress`)
- Create: `tests/e2e/tasks.spec.ts`
- Modify: `tests/e2e/app-shell.spec.ts` (the existing tasks test references the old "Task Board" heading + "Add task" button + status dropdown)

- [ ] **Step 1: Extend the e2e mock** — `tests/e2e/mock-api.ts`. Add Playwright route handlers (mirroring the existing `handleTaskListRoute`/`handleTaskDetailRoute` style) for:
  - `GET **/api/tasks/preferences` → `{ preferences: { defaultView: "priority", updatedAt: null } }`; `PATCH` echoes the body's `defaultView`.
  - `GET **/api/tasks/lists` → `{ lists: [{ id: "list-1", ownerUserId: "user-1", name: "Personal", position: 0, createdAt: null, updatedAt: null }] }`; `POST` returns a new list.
  - `GET **/api/tasks/lists/*/tags` → `{ tags: [] }`; `POST` returns a new tag.
  - `GET **/api/tasks/*/subtasks` → `{ tasks: [] }`.
  - `GET **/api/tasks/focus`, `**/api/tasks/at-risk`, `**/api/tasks/overdue` → `{ tasks: state.tasks }`.
    Ensure `createMockTask` includes the new DTO fields (`listId: "list-1"`, `doAt: null`, `effort: null`, `parentTaskId: null`, `position`, `source: "manual"`, `sourceRef: null`) and **no `in_progress`** anywhere. Register the more specific routes (`/preferences`, `/lists`, `/focus`, `*/subtasks`) **before** the generic `/api/tasks/*` detail matcher so Playwright matches them first.

- [ ] **Step 2: Update the existing shell test** — `tests/e2e/app-shell.spec.ts` (lines ~41-62). The new page heading is "Tasks" (not "Task Board"), capture button label is "Add" (not "Add task"), and the title input has `aria-label="Task title"`. Update those selectors:

```ts
test("creates and updates tasks through REST calls", async ({ page }) => {
  await setupMockApi(page, {
    /* …existing state with createMockTask("task-1", "Existing secure task") … */
  });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await page.getByLabel("Task title").fill("Renew passport");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Renew passport")).toBeVisible();
});
```

(Keep the file's existing `setupMockApi`/import structure; only adjust the selectors that changed.)

- [ ] **Step 3: Add a focused tasks spec** — create `tests/e2e/tasks.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { createMockTask, setupMockApi } from "./mock-api";

test.beforeEach(async ({ page }) => {
  await setupMockApi(page, {
    tasks: [
      createMockTask("t-critical", "File taxes", {
        priority: 5,
        dueAt: "2026-06-09T12:00:00.000Z"
      }),
      createMockTask("t-someday", "Learn cello", { priority: 1 })
    ]
  });
});

test("priority view groups tasks and matrix toggle persists via preferences", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Priority" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByRole("heading", { name: "Critical priority" })).toBeVisible();

  await page.getByRole("button", { name: "Matrix" }).click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Do First" })).toBeVisible();
});
```

> Adjust selector specifics to the actual rendered roles/labels if Playwright reports mismatches; the assertions above match the component markup in Tasks 9–11.

- [ ] **Step 4: Run e2e** — `pnpm test:e2e`. Expected: PASS. Fix selector drift if any.

- [ ] **Step 5: Full gate** — run, in the worktree, with no `dev:worker` running:

```bash
pnpm verify:foundation && pnpm test:e2e && pnpm audit:release-hardening
```

Expected: all green. (`verify:foundation` = lint, format:check, check:file-size, typecheck, db:migrate, test:integration.) If `format:check` fails, run `pnpm format` and amend.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/mock-api.ts tests/e2e/tasks.spec.ts tests/e2e/app-shell.spec.ts
git commit -m "test(web): e2e for priority view, matrix toggle, capture; update shell tasks test"
```

- [ ] **Step 7: Close-out (do NOT merge — ping Coordinator).**
  - Tick the Plan-3 exit-criteria boxes on epic #6 (5-level priority + matrix + priority-grouped default view; statuses narrowed; REST + web UI for human writes; due/do/effort capture; one-list-per-task + list-scoped tags per SDP-2 scope).
  - Save an agentmemory note for any non-obvious decision (e.g. the four backend-completion slices Plan 3 had to add; the SDP-2 tag-assignment deferral).
  - Open fast-follow issues for any deferred SDP items the Coordinator approved (tag assignment; list/tag rename+delete).
  - **Ping `Coordinator` (signed `[Tasks P3]`) that the branch is merge-ready**, with the gate output. Await merge-order confirmation; expect to integrate `main` + rebase (M-B1 touches `settings-page.tsx`; Chat Phase 3 touches the shell — neither overlaps the tasks files, but rebase before landing).

---

## Self-Review

**1. Spec coverage** (spec rev 3 §"This milestone"):

- Priority-grouped default view → Tasks 5, 9, 11. ✓
- Matrix view → Tasks 5, 10, 11. ✓
- `default_view` per-user preference → Task 3 (backend) + Task 11 (toggle). ✓
- Capture (title-only fast path) → Task 8. ✓
- Task detail (fields + subtasks + activity) → Task 12 (+ existing activity). ✓
- Lists + list-scoped tags → Task 11 sidebar (create + filter); **assignment deferred — SDP-2**. ⚠ (Coordinator decision)
- due/do/effort → Tasks 2 (REST), 8 + 12 (UI). ✓
- Status narrowing (Open/Done/Archived) → Task 1. ✓
- Recurrence → minimal select, Tasks 8 + (optional) 12; **SDP-4**. ⚠ (Coordinator decision)
- Drift/focus queries → client fns added (Task 6); **not surfaced in UI this milestone** (spec calls them an "unconsumed seam" for briefings/heartbeat) — intentional. Note for Coordinator: no focus/at-risk _view_ is built; flag if one is wanted.
- REST + web UI for all human writes → Tasks 2, 3, 4 + web tasks. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Two intentional executor-judgment notes remain (mock-api route bodies in Task 13 Step 1; e2e selector drift) — both point to the exact existing pattern to copy and concrete payloads, not vague placeholders.

**3. Type consistency:** `TaskDefaultView`, `TaskPreferencesDto.defaultView`, `quadrantOf`/`quadrantTasks`/`groupByPriority`/`PRIORITY_LEVELS`/`QUADRANTS`, `effortLabel`, `listSubtasks`/`breakdownTask`/`getTaskPreferences`/`updateTaskPreferences`/`listTaskLists`/`createTaskList`/`listTaskTags`/`createTaskTag`, and query keys `tasks.subtasks/lists/tags/preferences` are used identically across the tasks that define and consume them. `effort` union `"quick"|"medium"|"large"` matches the DTO. Status set `todo|done|archived` is consistent post-Task-1.

**4. Green-per-commit risk:** Task 1 is the only multi-package atomic commit (required — web typecheck). All later web component tasks compile in isolation (unused-but-exported is lint-clean) and leave the old/new pages serving e2e until Task 11 swaps the page body and Task 13 updates the e2e selectors in the same commit as the spec it covers.

---

## Execution Handoff

**This plan is NOT for immediate execution.** Per the kickoff brief, ping the **Coordinator** (signed `[Tasks P3]`) for a plan review first; resolve SDP-1…SDP-4. After the Coordinator's verdict, execute via **superpowers:subagent-driven-development** (fresh Sonnet subagent per task, two-stage review between tasks).
