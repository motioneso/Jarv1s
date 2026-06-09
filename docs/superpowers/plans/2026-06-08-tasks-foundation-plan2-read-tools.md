# Tasks Foundation — Plan 2: Assistant Read Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Build agents run on Sonnet; each task commits green; `git add` only that task's files.**

**Goal:** Author the 8 Tasks read/query assistant tools as `execute()` handlers on `ModuleAssistantToolManifest` — module-owned, declared + executed in `packages/tasks`, dispatched by the existing `AssistantToolGateway` in `packages/ai`.

**Architecture:** Extract shared serializers to a new `serialize.ts` to break a potential circular-import chain (routes → manifest → tools → routes). `tools.ts` holds all 8 `execute` handlers. `manifest.ts` is updated to replace the two old declaration-only stubs with 8 real tools. Tests live in a new `tasks-tools.test.ts` to keep `tasks.test.ts` under 1000 lines.

**Tech Stack:** TypeScript, Kysely, Vitest, `@jarv1s/module-sdk` `ModuleAssistantToolManifest` contract.

**Spec:** `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` §"Assistant-tool contract — READ ONLY this milestone". **Plan 1:** `docs/superpowers/plans/2026-06-08-tasks-foundation.md`. **Handoff:** `docs/superpowers/handoffs/2026-06-08-tasks-plan2-read-tools.md`.

**Baseline:** 29/29 tasks tests green on branch `feat/tasks-foundation-p2-read-tools` (confirmed before writing this plan).

---

## Hard constraints (do not relax)

- `risk: "read"` on every tool — gateway runs them without confirmation.
- **Do NOT build write tools.** `tasks.create`/`updateStatus`/`breakDown`/… are out of scope. Remove the existing `tasks.updateStatus` declaration — it has no `execute` handler and must not appear.
- **Do NOT edit applied migrations.** No schema changes in this plan.
- `pnpm check:file-size` enforces the 1000-line cap; `tasks.test.ts` is already 923 lines — new tests go in `tasks-tools.test.ts`.
- Before editing `packages/module-registry/src/index.ts`: ping the "Chat MCP F2" Herdr agent (they're in that file). For this plan you should NOT need to touch module-registry at all — the tools live in `packages/tasks` and are already registered via the tasks manifest.

---

## File structure

| File                                    | Action     | Responsibility                                                        |
| --------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `packages/tasks/src/serialize.ts`       | **Create** | Serializers + quadrant logic extracted from routes.ts                 |
| `packages/tasks/src/tools.ts`           | **Create** | 8 `execute` handlers for read tools                                   |
| `packages/tasks/src/repository.ts`      | **Modify** | Add `listByParentId` method                                           |
| `packages/tasks/src/routes.ts`          | **Modify** | Import serializers from `./serialize.js` instead of defining locally  |
| `packages/tasks/src/manifest.ts`        | **Modify** | Wire execute handlers; replace old stubs with 8 new tool declarations |
| `packages/tasks/src/index.ts`           | **Modify** | Re-export `serialize.ts` and `tools.ts`                               |
| `package.json`                          | **Modify** | Add `test:tasks-tools` script                                         |
| `tests/integration/tasks-tools.test.ts` | **Create** | 8 tool-level integration tests with lean setup                        |

---

## Task 1: Extract serializers to `serialize.ts`, update `routes.ts`

**Why first:** `tools.ts` needs the serializers. If they stay in `routes.ts`, wiring `manifest.ts → tools.ts → routes.ts → manifest.ts` creates a circular import. Moving them to `serialize.ts` breaks the cycle. This task has no behavioral change — it is a pure refactor verified by keeping the existing 29 tests green.

**Files:**

- Create: `packages/tasks/src/serialize.ts`
- Modify: `packages/tasks/src/routes.ts` (replace local definitions with imports)
- Modify: `packages/tasks/src/index.ts` (add re-export)

- [ ] **Step 1: Create `packages/tasks/src/serialize.ts`**

```ts
import type { Task, TaskActivity, TaskList, TaskTag } from "@jarv1s/db";
import type { TaskActivityDto, TaskDto, TaskListDto, TaskTagDto } from "@jarv1s/shared";

export function serializeDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

export function getQuadrant(task: Task): "do" | "schedule" | "delegate" | "eliminate" {
  const important = task.priority !== null && task.priority >= 4;
  let urgent = false;

  if (task.due_at) {
    const dueMs = (task.due_at instanceof Date ? task.due_at : new Date(task.due_at)).getTime();
    const nowMs = Date.now();
    const hoursUntilDue = (dueMs - nowMs) / (1000 * 60 * 60);
    urgent = hoursUntilDue <= 48;
  }

  if (important && urgent) return "do";
  if (important && !urgent) return "schedule";
  if (!important && urgent) return "delegate";
  return "eliminate";
}

export function filterByQuadrant(
  tasks: Task[],
  quadrant: "do" | "schedule" | "delegate" | "eliminate"
): Task[] {
  return tasks.filter((t) => getQuadrant(t) === quadrant);
}

export function serializeTaskList(list: TaskList): TaskListDto {
  return {
    id: list.id,
    ownerUserId: list.owner_user_id,
    name: list.name,
    position: list.position,
    createdAt: serializeDate(list.created_at),
    updatedAt: serializeDate(list.updated_at)
  };
}

export function serializeTaskTag(tag: TaskTag): TaskTagDto {
  return {
    id: tag.id,
    ownerUserId: tag.owner_user_id,
    listId: tag.list_id,
    name: tag.name,
    createdAt: serializeDate(tag.created_at)
  };
}

export function serializeTask(task: Task): TaskDto {
  return {
    id: task.id,
    ownerUserId: task.owner_user_id,
    listId: task.list_id,
    parentTaskId: task.parent_task_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    position: task.position,
    dueAt: serializeDate(task.due_at),
    doAt: serializeDate(task.do_at),
    effort: task.effort,
    source: task.source,
    sourceRef: task.source_ref,
    completedAt: serializeDate(task.completed_at),
    createdAt: serializeDate(task.created_at),
    updatedAt: serializeDate(task.updated_at)
  };
}

export function serializeTaskActivity(activity: TaskActivity): TaskActivityDto {
  return {
    id: activity.id,
    taskId: activity.task_id,
    actorUserId: activity.actor_user_id,
    activityType: activity.activity_type,
    body: activity.body,
    createdAt: serializeDate(activity.created_at)
  };
}
```

- [ ] **Step 2: Update `packages/tasks/src/routes.ts`**

At the top of `routes.ts`, after the existing imports, add:

```ts
import {
  filterByQuadrant,
  serializeDate,
  serializeTask,
  serializeTaskActivity,
  serializeTaskList,
  serializeTaskTag
} from "./serialize.js";
```

Then delete the following local function definitions (they are now imported):

- `function serializeDate(...)` (~lines 604–610)
- `export function serializeTaskList(...)` (~lines 550–559)
- `export function serializeTaskTag(...)` (~lines 561–569)
- `export function serializeTask(...)` (~lines 571–591)
- `function serializeTaskActivity(...)` (~lines 593–602)
- `function getQuadrant(...)` (~lines 526–541)
- `function filterByQuadrant(...)` (~lines 543–548)

Also remove the imports from the `@jarv1s/shared` import that are no longer needed in routes.ts but are now pulled in through serialize.ts. Specifically, `TaskActivityDto`, `TaskDto`, `TaskListDto`, `TaskTagDto` — remove these from the routes.ts `@jarv1s/shared` import since they are now imported in serialize.ts and routes.ts only uses the serializer functions, not the DTO types directly. (Verify by running typecheck — if TypeScript still needs them in routes.ts, keep them.)

- [ ] **Step 3: Add re-export to `packages/tasks/src/index.ts`**

Append to `packages/tasks/src/index.ts`:

```ts
export * from "./serialize.js";
```

- [ ] **Step 4: Run `pnpm test:tasks`**

```bash
pnpm test:tasks > /tmp/t1.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/t1.log
```

Expected: `Tests  29 passed (29)`, `EXIT=0`. Fix any typecheck/import issues before proceeding.

- [ ] **Step 5: Run `pnpm typecheck`**

```bash
pnpm typecheck > /tmp/tc1.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/tc1.log
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/serialize.ts packages/tasks/src/routes.ts packages/tasks/src/index.ts
git commit -m "$(cat <<'EOF'
refactor(tasks): extract serializers + quadrant logic to serialize.ts

Breaks a potential circular import chain that plan 2's tools.ts would
otherwise create (routes → manifest → tools → routes).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `listByParentId` to `TasksRepository`

`tasks.get` must return subtasks. There is no `listByParentId` method yet. This task adds it TDD-style.

**Files:**

- Modify: `packages/tasks/src/repository.ts` (add method after `listActivity`)

- [ ] **Step 1: Write the failing test**

Open `tests/integration/tasks.test.ts`. At the end of the `describe` block (before the closing `}`), append:

```ts
it("repository: listByParentId returns direct children in position order", async () => {
  const breakdown = new TaskBreakdownRepository();

  const parentId = await dataContext.withDataContext(userAContext(), async (db) => {
    const parent = await repository.create(db, { title: "plan the trip" });
    await breakdown.breakDown(db, parent.id, ["book flights", "book hotel", "pack bags"]);
    return parent.id;
  });

  const subtasks = await dataContext.withDataContext(userAContext(), (db) =>
    repository.listByParentId(db, parentId)
  );

  expect(subtasks).toHaveLength(3);
  expect(subtasks.map((t) => t.parent_task_id)).toEqual([parentId, parentId, parentId]);
  expect(subtasks[0].title).toBe("book flights");
  expect(subtasks[1].title).toBe("book hotel");
  expect(subtasks[2].title).toBe("pack bags");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
vitest run tests/integration/tasks.test.ts -t "listByParentId" 2>&1 | tail -15
```

Expected: FAIL — `repository.listByParentId is not a function`.

- [ ] **Step 3: Add `listByParentId` to `packages/tasks/src/repository.ts`**

Find the closing `}` of the `listActivity` method (~line 339) and insert the new method directly after it, before the class-closing `}`:

```ts
  async listByParentId(scopedDb: DataContextDb, parentId: string): Promise<Task[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("parent_task_id", "=", parentId)
      .orderBy("position", "asc")
      .orderBy("id")
      .execute();
  }
```

- [ ] **Step 4: Run to verify it passes**

```bash
vitest run tests/integration/tasks.test.ts -t "listByParentId" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run full suite to confirm no regression**

```bash
pnpm test:tasks > /tmp/t2.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/t2.log
```

Expected: 30 passed, `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/repository.ts tests/integration/tasks.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): add TasksRepository.listByParentId for subtask loading

Required by the tasks.get read tool (plan 2).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `tools.ts`, write tests, wire into manifest

This is the main deliverable. We write the failing tests first, then create the tools, then wire them into the manifest.

**Files:**

- Create: `packages/tasks/src/tools.ts`
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `packages/tasks/src/index.ts`
- Modify: `package.json`
- Create: `tests/integration/tasks-tools.test.ts`

### Step 1: Add `test:tasks-tools` script to `package.json`

In `package.json`, in the `scripts` object, add the new entry after `test:tasks`:

```json
"test:tasks-tools": "vitest run tests/integration/tasks-tools.test.ts",
```

### Step 2: Create the failing test file

Create `tests/integration/tasks-tools.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, type Kysely } from "vitest";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { type TaskDto } from "@jarv1s/shared";
import {
  TaskBreakdownRepository,
  TaskListsRepository,
  TasksRepository,
  tasksModuleManifest
} from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("Tasks module — assistant read tools", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: TasksRepository;
  let listsRepo: TaskListsRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    repository = new TasksRepository();
    listsRepo = new TaskListsRepository();
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  function userAContext(): AccessContext {
    return { actorUserId: ids.userA, requestId: "request:user-a-tools" };
  }

  function userBContext(): AccessContext {
    return { actorUserId: ids.userB, requestId: "request:user-b-tools" };
  }

  function toolCtx(actorUserId: string): ToolContext {
    return { actorUserId, requestId: "test-tool-req", chatSessionId: "test-session" };
  }

  function getTool(name: string) {
    return tasksModuleManifest.assistantTools?.find((t) => t.name === name);
  }

  // ── tasks.list ───────────────────────────────────────────────────────────

  it("tasks.list: execute is defined; returns actor tasks under RLS; supports status filter", async () => {
    const tool = getTool("tasks.list");
    expect(tool?.execute).toBeDefined();

    const made = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "list-tool test task", status: "todo" })
    );

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, {}, toolCtx(ids.userA))
    );

    const returned = result.data.tasks as TaskDto[];
    expect(returned.map((t) => t.id)).toContain(made.id);
    // RLS: user B's private task must not appear
    const bPrivateId = "30000000-0000-4000-8000-000000000002";
    expect(returned.map((t) => t.id)).not.toContain(bPrivateId);

    // status filter
    const doneResult = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { status: "done" }, toolCtx(ids.userA))
    );
    expect((doneResult.data.tasks as TaskDto[]).every((t) => t.status === "done")).toBe(true);
  });

  it("tasks.list: quadrant filter returns only tasks matching the Eisenhower quadrant", async () => {
    const tool = getTool("tasks.list");

    // "do" quadrant: priority >= 4 AND due within 48 h
    const dueInOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const doTask = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "do-quadrant task", priority: 5, dueAt: dueInOneHour })
    );

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { quadrant: "do" }, toolCtx(ids.userA))
    );
    const ids2 = (result.data.tasks as TaskDto[]).map((t) => t.id);
    expect(ids2).toContain(doTask.id);

    // "eliminate" quadrant should not include the high-priority task
    const elimResult = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { quadrant: "eliminate" }, toolCtx(ids.userA))
    );
    expect((elimResult.data.tasks as TaskDto[]).map((t) => t.id)).not.toContain(doTask.id);
  });

  // ── tasks.get ────────────────────────────────────────────────────────────

  it("tasks.get: returns the task, its subtasks, and recent activity", async () => {
    const tool = getTool("tasks.get");
    expect(tool?.execute).toBeDefined();

    const breakdown = new TaskBreakdownRepository();

    const { parentId } = await dataContext.withDataContext(userAContext(), async (db) => {
      const parent = await repository.create(db, { title: "get-tool parent" });
      await breakdown.breakDown(db, parent.id, ["child A", "child B"]);
      await repository.addActivity(db, parent.id, {
        activityType: "comment",
        body: "progress update"
      });
      return { parentId: parent.id };
    });

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { taskId: parentId }, toolCtx(ids.userA))
    );

    const task = result.data.task as TaskDto;
    const subtasks = result.data.subtasks as TaskDto[];
    const activity = result.data.activity as Array<{ activityType: string }>;

    expect(task.id).toBe(parentId);
    expect(subtasks).toHaveLength(2);
    expect(subtasks.map((s) => s.title)).toContain("child A");
    expect(activity.some((a) => a.activityType === "comment")).toBe(true);
  });

  it("tasks.get: returns { error } when the task is not found or not visible to the actor", async () => {
    const tool = getTool("tasks.get");

    // User A's task is invisible to user B (no share)
    const aTask = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "get-rls task" })
    );

    const result = await dataContext.withDataContext(userBContext(), (db) =>
      tool!.execute!(db, { taskId: aTask.id }, toolCtx(ids.userB))
    );

    expect(result.data.error).toBeDefined();
  });

  // ── tasks.focus / tasks.atRisk / tasks.overdue ───────────────────────────

  it("tasks.focus, tasks.atRisk, tasks.overdue: execute defined; overdue task appears in focus+overdue but not in atRisk (priority < 3)", async () => {
    const focusTool = getTool("tasks.focus");
    const atRiskTool = getTool("tasks.atRisk");
    const overdueTool = getTool("tasks.overdue");
    expect(focusTool?.execute).toBeDefined();
    expect(atRiskTool?.execute).toBeDefined();
    expect(overdueTool?.execute).toBeDefined();

    // Low-priority overdue task: appears in overdue + focus but NOT atRisk (priority < 3)
    const lowOverdue = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "low-overdue drift task",
        priority: 1,
        dueAt: new Date("2000-01-01")
      })
    );
    // High-priority overdue task: appears in all three
    const highOverdue = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "high-overdue drift task",
        priority: 4,
        dueAt: new Date("2000-01-01")
      })
    );

    const [focusResult, atRiskResult, overdueResult] = await Promise.all([
      dataContext.withDataContext(userAContext(), (db) =>
        focusTool!.execute!(db, {}, toolCtx(ids.userA))
      ),
      dataContext.withDataContext(userAContext(), (db) =>
        atRiskTool!.execute!(db, {}, toolCtx(ids.userA))
      ),
      dataContext.withDataContext(userAContext(), (db) =>
        overdueTool!.execute!(db, {}, toolCtx(ids.userA))
      )
    ]);

    const focusIds = (focusResult.data.tasks as TaskDto[]).map((t) => t.id);
    const atRiskIds = (atRiskResult.data.tasks as TaskDto[]).map((t) => t.id);
    const overdueIds = (overdueResult.data.tasks as TaskDto[]).map((t) => t.id);

    expect(overdueIds).toContain(lowOverdue.id);
    expect(overdueIds).toContain(highOverdue.id);
    expect(focusIds).toContain(highOverdue.id);
    expect(atRiskIds).toContain(highOverdue.id);
    expect(atRiskIds).not.toContain(lowOverdue.id); // priority 1 < 3
  });

  // ── tasks.listLists ───────────────────────────────────────────────────────

  it("tasks.listLists: returns the actor's Personal list; hides other users' lists", async () => {
    const tool = getTool("tasks.listLists");
    expect(tool?.execute).toBeDefined();

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, {}, toolCtx(ids.userA))
    );

    const taskLists = result.data.lists as Array<{ name: string; ownerUserId: string }>;
    expect(taskLists.some((l) => l.name === "Personal")).toBe(true);
    expect(taskLists.every((l) => l.ownerUserId === ids.userA)).toBe(true);
  });

  // ── tasks.listTags ────────────────────────────────────────────────────────

  it("tasks.listTags: returns tags in the given list", async () => {
    const tool = getTool("tasks.listTags");
    expect(tool?.execute).toBeDefined();

    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreateDefault(db)
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "work")
    );

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { listId: list.id }, toolCtx(ids.userA))
    );

    const tags = result.data.tags as Array<{ name: string }>;
    expect(tags.some((t) => t.name === "work")).toBe(true);
  });

  // ── tasks.activity ────────────────────────────────────────────────────────

  it("tasks.activity: returns the full activity stream for a task in chronological order", async () => {
    const tool = getTool("tasks.activity");
    expect(tool?.execute).toBeDefined();

    const taskId = await dataContext.withDataContext(userAContext(), async (db) => {
      const t = await repository.create(db, { title: "activity-tool task" });
      await repository.addActivity(db, t.id, { activityType: "comment", body: "first" });
      await repository.addActivity(db, t.id, { activityType: "comment", body: "second" });
      return t.id;
    });

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { taskId }, toolCtx(ids.userA))
    );

    const activity = result.data.activity as Array<{ activityType: string; body: string | null }>;
    expect(activity.length).toBeGreaterThanOrEqual(2);
    expect(activity[0].body).toBe("first");
    expect(activity[1].body).toBe("second");
  });
});
```

> **Note on `repository.addActivity`:** The test uses `repository.addActivity(db, taskId, { activityType, body })`. Verify this method exists in `TasksRepository` (it is `addActivity` based on the Plan 1 routes — check `repository.ts` and adjust the call if the method name differs). The integration test for activity at line 299 of `tasks.test.ts` shows the pattern.

- [ ] **Step 3: Run the failing test file**

```bash
vitest run tests/integration/tasks-tools.test.ts 2>&1 | tail -20
```

Expected: Tests fail with `execute` being undefined (e.g., `expected undefined to be defined`). All 8 `expect(tool?.execute).toBeDefined()` assertions fail. This confirms the tests are correctly written against the not-yet-implemented surface.

- [ ] **Step 4: Create `packages/tasks/src/tools.ts`**

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { TaskDriftRepository } from "./drift.js";
import { TaskListsRepository } from "./lists.js";
import { TasksRepository } from "./repository.js";
import {
  filterByQuadrant,
  serializeTask,
  serializeTaskActivity,
  serializeTaskList,
  serializeTaskTag
} from "./serialize.js";

const repository = new TasksRepository();
const drift = new TaskDriftRepository();
const lists = new TaskListsRepository();

export const taskListExecute: ToolExecute = async (scopedDb, input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  let tasks = await repository.listVisible(scopedDb);

  const { listId, tagId, status, priority, dueBefore, dueAfter, quadrant } = input as {
    listId?: string;
    tagId?: string;
    status?: string;
    priority?: number;
    dueBefore?: string;
    dueAfter?: string;
    quadrant?: string;
  };

  if (listId) tasks = tasks.filter((t) => t.list_id === listId);
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (priority !== undefined) tasks = tasks.filter((t) => t.priority === priority);
  if (dueBefore) {
    const before = new Date(dueBefore);
    tasks = tasks.filter((t) => t.due_at !== null && new Date(t.due_at as Date | string) < before);
  }
  if (dueAfter) {
    const after = new Date(dueAfter);
    tasks = tasks.filter((t) => t.due_at !== null && new Date(t.due_at as Date | string) > after);
  }
  if (
    quadrant === "do" ||
    quadrant === "schedule" ||
    quadrant === "delegate" ||
    quadrant === "eliminate"
  ) {
    tasks = filterByQuadrant(tasks, quadrant);
  }
  if (tagId) {
    const tagged = await scopedDb.db
      .selectFrom("app.task_tag_assignments")
      .select("task_id")
      .where("tag_id", "=", tagId)
      .execute();
    const taggedSet = new Set(tagged.map((r) => r.task_id));
    tasks = tasks.filter((t) => taggedSet.has(t.id));
  }

  return { data: { tasks: tasks.map(serializeTask) } };
};

export const taskGetExecute: ToolExecute = async (scopedDb, input, _ctx): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  const { taskId } = input as { taskId: string };

  const [task, subtasks, activity] = await Promise.all([
    repository.getById(scopedDb, taskId),
    repository.listByParentId(scopedDb, taskId),
    repository.listActivity(scopedDb, taskId)
  ]);

  if (!task) {
    return { data: { error: "Task not found" } };
  }

  return {
    data: {
      task: serializeTask(task),
      subtasks: subtasks.map(serializeTask),
      activity: activity.slice(0, 10).map(serializeTaskActivity)
    }
  };
};

export const taskFocusExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getFocus(scopedDb);
  return { data: { tasks: tasks.map(serializeTask) } };
};

export const taskAtRiskExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getAtRisk(scopedDb);
  return { data: { tasks: tasks.map(serializeTask) } };
};

export const taskOverdueExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const tasks = await drift.getOverdue(scopedDb);
  return { data: { tasks: tasks.map(serializeTask) } };
};

export const taskListListsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const taskLists = await lists.list(scopedDb);
  return { data: { lists: taskLists.map(serializeTaskList) } };
};

export const taskListTagsExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { listId } = input as { listId: string };
  const tags = await lists.listTags(scopedDb, listId);
  return { data: { tags: tags.map(serializeTaskTag) } };
};

export const taskActivityExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { taskId } = input as { taskId: string };
  const activity = await repository.listActivity(scopedDb, taskId);
  return { data: { activity: activity.map(serializeTaskActivity) } };
};
```

- [ ] **Step 5: Update `packages/tasks/src/manifest.ts`**

**5a. Add the tools.ts import** (after the existing `@jarv1s/module-sdk` import line — already imported as a type; add a value import for the execute functions):

```ts
import {
  taskActivityExecute,
  taskAtRiskExecute,
  taskFocusExecute,
  taskGetExecute,
  taskListExecute,
  taskListListsExecute,
  taskListTagsExecute,
  taskOverdueExecute
} from "./tools.js";
```

**5b. Remove `taskStatusSchema` from the `@jarv1s/shared` import** — it was only used by the now-removed `tasks.updateStatus` stub. Remove `taskStatusSchema` from the import list.

**5c. Replace the entire `assistantTools: [...]` array** with:

```ts
assistantTools: [
  {
    name: "tasks.list",
    description:
      "List tasks visible to the actor. Optional filters: listId, tagId, status (todo|done|archived), priority (1–5 integer), dueBefore/dueAfter (ISO 8601 date strings), quadrant (do|schedule|delegate|eliminate — Eisenhower matrix).",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        tagId: { type: "string" },
        status: { type: "string", enum: ["todo", "done", "archived"] },
        priority: { type: "integer", minimum: 1, maximum: 5 },
        dueBefore: { type: "string" },
        dueAfter: { type: "string" },
        quadrant: { type: "string", enum: ["do", "schedule", "delegate", "eliminate"] }
      }
    },
    outputSchema: listTasksResponseSchema,
    execute: taskListExecute
  },
  {
    name: "tasks.get",
    description:
      "Get a specific task by ID, including its subtasks and up to 10 most recent activity entries.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" }
      }
    },
    execute: taskGetExecute
  },
  {
    name: "tasks.focus",
    description:
      "Get the focus list — the highest-priority tasks to work on today: overdue tasks plus at-risk tasks (Medium+ priority, due within 48 h or do-date past), ranked by priority, urgency, and effort.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: { type: "object", properties: {} },
    outputSchema: focusTasksRouteSchema.response[200],
    execute: taskFocusExecute
  },
  {
    name: "tasks.atRisk",
    description:
      "Get tasks at risk of slipping: open, Medium+ priority, due within 48 hours or do-date passed, with no completed subtasks.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: { type: "object", properties: {} },
    outputSchema: atRiskTasksRouteSchema.response[200],
    execute: taskAtRiskExecute
  },
  {
    name: "tasks.overdue",
    description:
      "Get all overdue tasks — open tasks whose due date is in the past, most overdue first.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: { type: "object", properties: {} },
    outputSchema: overdueTasksRouteSchema.response[200],
    execute: taskOverdueExecute
  },
  {
    name: "tasks.listLists",
    description: "List all task lists owned by the actor, ordered by position then name.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: { type: "object", properties: {} },
    outputSchema: listTaskListsResponseSchema,
    execute: taskListListsExecute
  },
  {
    name: "tasks.listTags",
    description: "List all tags in a given task list.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: {
      type: "object",
      required: ["listId"],
      properties: {
        listId: { type: "string" }
      }
    },
    outputSchema: listTaskTagsResponseSchema,
    execute: taskListTagsExecute
  },
  {
    name: "tasks.activity",
    description: "Get the full activity stream for a task, in chronological order.",
    permissionId: "tasks.view",
    risk: "read",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" }
      }
    },
    execute: taskActivityExecute
  }
];
```

- [ ] **Step 6: Add `tools.ts` re-export to `packages/tasks/src/index.ts`**

Append to `packages/tasks/src/index.ts`:

```ts
export * from "./tools.js";
```

- [ ] **Step 7: Run the new tool tests**

```bash
vitest run tests/integration/tasks-tools.test.ts 2>&1 | tail -20
```

Expected: All tests pass. If any test references `repository.addActivity` and that method doesn't exist (verify in repository.ts — it may be named `addTaskActivity` or similar), fix the method name in the test to match the actual signature.

- [ ] **Step 8: Run the original suite to confirm no regression**

```bash
pnpm test:tasks > /tmp/t3.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/t3.log
```

Expected: 30 passed, `EXIT=0`.

- [ ] **Step 9: Run typecheck**

```bash
pnpm typecheck > /tmp/tc3.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/tc3.log
```

Expected: `EXIT=0`.

- [ ] **Step 10: Commit**

```bash
git add \
  packages/tasks/src/tools.ts \
  packages/tasks/src/manifest.ts \
  packages/tasks/src/index.ts \
  package.json \
  tests/integration/tasks-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): 8 assistant read tools via ModuleAssistantToolManifest.execute

tasks.list (filters: list/tag/status/priority/due-range/quadrant)
tasks.get (task + subtasks + recent activity)
tasks.focus / tasks.atRisk / tasks.overdue (drift queries)
tasks.listLists / tasks.listTags (lists repository)
tasks.activity (activity stream)

Removes the legacy tasks.listVisible and tasks.updateStatus stubs —
both had no execute handler; updateStatus is removed per spec until the
AI write-tool execution surface exists.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full gate

**Do not claim this plan complete until both commands exit 0.**

- [ ] **Step 1: Run `pnpm verify:foundation`**

```bash
pnpm verify:foundation > /tmp/gate.log 2>&1; echo "EXIT=$?"
```

**Do NOT pipe to `tail`** — that masks the real exit code. Read the file separately:

```bash
cat /tmp/gate.log | grep -E "FAIL|PASS|error|warning|EXIT" | tail -30
echo "Exit was: $(cat /tmp/gate.log | tail -1)"
```

Expected: every step green; `EXIT=0`. Common failure modes:

- `check:file-size` — if any source file exceeds 1000 lines. Fix by decomposing.
- `typecheck` — if the `satisfies JarvisModuleManifest` check in manifest.ts rejects the new shape. Fix the types.
- `test:integration` — re-run the failing suite individually to see the stack trace.

- [ ] **Step 2: Run `pnpm audit:release-hardening`**

```bash
pnpm audit:release-hardening > /tmp/audit.log 2>&1; echo "EXIT=$?"
cat /tmp/audit.log | grep -E "FAIL|PASS|error|✗|✓" | tail -20
```

Expected: `EXIT=0`.

- [ ] **Step 3: If both pass, you're done.**

This plan is complete. The next step (Plan 3) is the web UI — priority-grouped list view, Matrix view, task detail, and `TaskStatus` type narrowing (all deferred from Plan 1).

---

## Self-review (done at plan-write time)

**Spec coverage:**

- `tasks.list` (filters: list, tag, status, priority, due-range, quadrant) ✓ Task 3
- `tasks.get` (incl. subtasks + recent activity) ✓ Task 3
- `tasks.focus` ✓ Task 3
- `tasks.atRisk` ✓ Task 3
- `tasks.overdue` ✓ Task 3
- `tasks.listLists` ✓ Task 3
- `tasks.listTags` ✓ Task 3
- `tasks.activity` ✓ Task 3
- Remove `tasks.listVisible` and `tasks.updateStatus` stubs ✓ Task 3 Step 5c
- All tools `risk: "read"` ✓ Task 3 Step 5c

**Out of scope (verified not built):** write tools, web UI, `TaskStatus` narrowing, module-registry edits.

**Placeholder scan:** All code blocks are complete. No TBD/TODO/placeholder text.

**Type consistency:**

- `listByParentId` defined in Task 2, called in `taskGetExecute` in Task 3 ✓
- `serializeTask`, `serializeTaskActivity`, `serializeTaskList`, `serializeTaskTag` defined in Task 1, used in Task 3 ✓
- `filterByQuadrant` defined in Task 1, used in Task 3 ✓
- `assertDataContextDb` imported from `@jarv1s/db` in tools.ts ✓
- `ToolExecute`, `ToolResult` imported from `@jarv1s/module-sdk` in tools.ts ✓

**Note on `repository.addActivity`:** The test in `tasks-tools.test.ts` (tasks.get and tasks.activity tests) calls `repository.addActivity(db, taskId, { activityType, body })`. Verify the actual method signature in `packages/tasks/src/repository.ts` before running. If the method is named differently (e.g. it may be called `addTaskActivity`), update the test calls to match — the method was added in Plan 1.

**File size check:**

- `tasks.test.ts`: 923 + ~10 lines (Task 2 test) = ~933 lines — under 1000 ✓
- `tasks-tools.test.ts`: ~190 lines — under 1000 ✓
- `routes.ts`: ~634 - ~85 (removed serializers) + ~7 (new import) = ~556 lines ✓
- `serialize.ts`: ~90 lines ✓
- `tools.ts`: ~130 lines ✓
- `manifest.ts`: ~253 - ~20 (old stubs) + ~8 (new import) + ~100 (new tools) = ~341 lines ✓
- `repository.ts`: ~340 + ~10 = ~350 lines ✓
