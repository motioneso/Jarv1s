# Tasks Agency Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let assistant task writes run automatically when explicitly declared non-destructive, while delete-like task tools still require confirmation.

**Architecture:** Add one manifest-level execution policy for `write` tools; default stays confirm, `destructive` always confirms. Reuse existing task repositories and shared DTO schemas for the task agency tools. Keep all calls behind `AssistantToolGateway` so `DataContextRunner.withDataContext`, input validation, output projection, and RLS stay central.

**Tech Stack:** TypeScript, Fastify gateway tests, Vitest integration tests, Kysely repositories, module manifests.

---

## File Structure

- Modify `packages/module-sdk/src/index.ts`: add `ModuleAssistantToolExecutionPolicy = "auto" | "confirm"` and optional `executionPolicy` on `ModuleAssistantToolManifest`.
- Modify `packages/ai/src/gateway/policy.ts`: resolve policy from a full tool manifest; `read` runs, `write:auto` runs, `write:confirm` confirms, `destructive` confirms.
- Modify `packages/ai/src/gateway/gateway.ts`: pass the tool manifest into `resolvePolicy`.
- Modify `tests/integration/fixtures/example-tool-module.ts`: add one `example.autoWrite` fixture.
- Modify `tests/integration/mcp-gateway.test.ts`: prove `write:auto` runs without `action_request`; prove `destructive` ignores `executionPolicy`.
- Modify `packages/tasks/src/tools.ts`: add executors for `tasks.create`, `tasks.update`, `tasks.breakDown`, `tasks.addActivity`, tag assignment, list/tag create and rename, plus destructive list/tag delete if included.
- Modify `packages/tasks/src/manifest.ts`: declare the new task tools with schemas, `risk`, `executionPolicy`, outputs, and confirmation summaries for destructive tools.
- Modify `tests/integration/tasks-tools.test.ts`: direct executor tests for task mutation summaries and RLS/owner behavior.
- Modify `tests/integration/mcp-gateway.test.ts` or add `tests/integration/tasks-agency-tools.test.ts`: gateway-level proof that task writes auto-run and destructive task deletes confirm.

## Task 1: Gateway Execution Policy

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Modify: `packages/ai/src/gateway/policy.ts`
- Modify: `packages/ai/src/gateway/gateway.ts`
- Modify: `tests/integration/fixtures/example-tool-module.ts`
- Modify: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write failing gateway policy tests**

Add to `tests/integration/fixtures/example-tool-module.ts`:

```ts
{
  name: "example.autoWrite",
  description: "Auto write fixture.",
  permissionId: "example.update",
  risk: "write",
  executionPolicy: "auto",
  inputSchema: {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } }
  },
  execute: (db, input, ctx) => record("example.autoWrite", db as DataContextDb, input, ctx)
}
```

Add to `tests/integration/mcp-gateway.test.ts`:

```ts
it("runs a write:auto tool immediately without an action_request", async () => {
  const token = tokens.mint({
    actorUserId: ids.userA,
    chatSessionId: "s-auto-write",
    allowedToolNames: null
  });

  const res = await gateway.callTool(token, "example.autoWrite", { value: "quiet" });

  expect(res.ok).toBe(true);
  expect(exampleToolCalls).toEqual([
    { name: "example.autoWrite", input: { value: "quiet" }, actorUserId: ids.userA }
  ]);
  expect(emitted).toHaveLength(0);
});

it("always confirms destructive tools even if executionPolicy is auto", async () => {
  const destructiveAutoModule = {
    ...exampleToolModule,
    assistantTools: exampleToolModule.assistantTools?.map((tool) =>
      tool.name === "example.destroy" ? { ...tool, executionPolicy: "auto" as const } : tool
    )
  };
  const destructiveGateway = new AssistantToolGateway({
    resolveActiveModules: async () => [destructiveAutoModule],
    repository,
    runner,
    tokens,
    confirmations,
    notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
    confirmTimeoutMs: 30_000
  });
  const token = tokens.mint({
    actorUserId: ids.userA,
    chatSessionId: "s-destructive-auto",
    allowedToolNames: null
  });

  const call = destructiveGateway.callTool(token, "example.destroy", { value: "boom" });
  await tick();

  expect(firstActionRequest().toolName).toBe("example.destroy");
  expect(exampleToolCalls).toHaveLength(0);
  await destructiveGateway.resolveActionRequest(
    ids.userA,
    firstActionRequest().actionRequestId,
    "cancelled"
  );
  await call;
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
vitest run tests/integration/mcp-gateway.test.ts --testNamePattern "write:auto|destructive tools"
```

Expected: TypeScript or runtime failure because `executionPolicy` and new policy behavior do not exist.

- [ ] **Step 3: Implement minimal policy**

In `packages/module-sdk/src/index.ts` add:

```ts
export type ModuleAssistantToolExecutionPolicy = "auto" | "confirm";
```

Add to `ModuleAssistantToolManifest`:

```ts
readonly executionPolicy?: ModuleAssistantToolExecutionPolicy;
```

Replace `packages/ai/src/gateway/policy.ts` with:

```ts
import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

export function resolvePolicy(tool: ModuleAssistantToolManifest): PolicyDecision {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";
  return tool.executionPolicy === "auto" ? "run" : "confirm";
}
```

In `packages/ai/src/gateway/gateway.ts`, replace `resolvePolicy(found.tool.risk)` and `resolvePolicy(tool.risk)` calls with `resolvePolicy(found.tool)` / `resolvePolicy(tool)`.

- [ ] **Step 4: Run policy tests**

Run:

```bash
vitest run tests/integration/mcp-gateway.test.ts --testNamePattern "write:auto|destructive tools|blocks a write"
```

Expected: PASS. Existing `example.write` still confirms.

- [ ] **Step 5: Commit**

```bash
git add packages/module-sdk/src/index.ts packages/ai/src/gateway/policy.ts packages/ai/src/gateway/gateway.ts tests/integration/fixtures/example-tool-module.ts tests/integration/mcp-gateway.test.ts
git commit -m "feat: add assistant tool execution policy" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 2: Task Mutation Executors

**Files:**

- Modify: `packages/tasks/src/tools.ts`
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `tests/integration/tasks-tools.test.ts`

- [ ] **Step 1: Write failing direct executor tests**

Add tests to `tests/integration/tasks-tools.test.ts`:

```ts
it("tasks.create: creates owner-scoped task and returns a safe summary", async () => {
  const tool = getTool("tasks.create");
  const result = await dataContext.withDataContext(userAContext(), (db) =>
    tool!.execute!(db, { title: "agency create" }, toolCtx(ids.userA))
  );

  expect(result.data.summary).toBe("Created task: agency create");
  const task = result.data.task as TaskDto;
  expect(task.title).toBe("agency create");
  expect(task.ownerUserId).toBe(ids.userA);
});

it("tasks.update: cannot mutate another actor's private task", async () => {
  const tool = getTool("tasks.update");
  const privateTask = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "private agency task" })
  );

  const result = await dataContext.withDataContext(userBContext(), (db) =>
    tool!.execute!(db, { taskId: privateTask.id, title: "stolen" }, toolCtx(ids.userB))
  );

  expect(result.data.error).toBe("Task not found");
  const unchanged = await dataContext.withDataContext(userAContext(), (db) =>
    repository.getById(db, privateTask.id)
  );
  expect(unchanged?.title).toBe("private agency task");
});

it("tasks.updateStatus: completes and archives with normal agency summaries", async () => {
  const tool = getTool("tasks.updateStatus");
  const task = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "status agency task" })
  );

  const done = await dataContext.withDataContext(userAContext(), (db) =>
    tool!.execute!(db, { taskId: task.id, status: "done" }, toolCtx(ids.userA))
  );
  const archived = await dataContext.withDataContext(userAContext(), (db) =>
    tool!.execute!(db, { taskId: task.id, status: "archived" }, toolCtx(ids.userA))
  );

  expect(done.data.summary).toBe("Completed task: status agency task");
  expect(archived.data.summary).toBe("Archived task: status agency task");
});

it("tasks.breakDown and tasks.addActivity return concise mutation summaries", async () => {
  const breakDownTool = getTool("tasks.breakDown");
  const activityTool = getTool("tasks.addActivity");
  const task = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "breakdown agency task" })
  );

  const brokenDown = await dataContext.withDataContext(userAContext(), (db) =>
    breakDownTool!.execute!(db, { taskId: task.id, steps: ["first", "second"] }, toolCtx(ids.userA))
  );
  const activity = await dataContext.withDataContext(userAContext(), (db) =>
    activityTool!.execute!(db, { taskId: task.id, body: "note" }, toolCtx(ids.userA))
  );

  expect(brokenDown.data.summary).toBe("Added 2 subtasks.");
  expect(activity.data.summary).toBe("Added note/activity to breakdown agency task.");
});
```

- [ ] **Step 2: Run failing task tool tests**

Run:

```bash
vitest run tests/integration/tasks-tools.test.ts --testNamePattern "tasks.create|tasks.update: cannot|tasks.updateStatus: completes|tasks.breakDown"
```

Expected: FAIL because tools are not declared/executors do not return summaries yet.

- [ ] **Step 3: Implement task executors**

In `packages/tasks/src/tools.ts`, import `TaskBreakdownRepository`, instantiate it, and add these executors:

```ts
const breakdown = new TaskBreakdownRepository();

function taskSummaryForStatus(status: "todo" | "done" | "archived", title: string): string {
  if (status === "done") return `Completed task: ${title}`;
  if (status === "archived") return `Archived task: ${title}`;
  return `Reopened task: ${title}`;
}
```

Add executors using existing repositories only:

```ts
export const taskCreateExecute: ToolExecute = async (scopedDb, input) => {
  assertDataContextDb(scopedDb);
  const task = await repository.create(scopedDb, input as Parameters<TasksRepository["create"]>[1]);
  const tags = await repository.getTagsForTask(scopedDb, task.id);
  return { data: { summary: `Created task: ${task.title}`, task: serializeTask(task, tags) } };
};
```

Implement `taskUpdateExecute`, `taskBreakDownExecute`, `taskAddActivityExecute`, `taskAssignTagExecute`, `taskUnassignTagExecute`, `taskCreateListExecute`, `taskRenameListExecute`, `taskCreateTagExecute`, `taskRenameTagExecute` the same way: call the existing repository method, refetch the task/list/tag if needed, and return `{ summary, ...dto }`. For missing tasks, return `{ data: { error: "Task not found" } }` instead of throwing.

- [ ] **Step 4: Declare task tools**

In `packages/tasks/src/manifest.ts`, import the new executors and add output schemas:

```ts
const taskMutationToolOutputSchema = {
  type: "object",
  required: ["summary", "task"],
  properties: { summary: { type: "string" }, task: taskDtoSchema }
} as const;

const taskListMutationToolOutputSchema = {
  type: "object",
  required: ["summary", "list"],
  properties: { summary: { type: "string" }, list: taskListDtoSchema }
} as const;

const taskTagMutationToolOutputSchema = {
  type: "object",
  required: ["summary", "tag"],
  properties: { summary: { type: "string" }, tag: taskTagDtoSchema }
} as const;
```

Declare non-destructive tools with `risk: "write"` and `executionPolicy: "auto"`:

```ts
{
  name: "tasks.create",
  description: "Create a task owned by the active actor.",
  permissionId: "tasks.create",
  risk: "write",
  executionPolicy: "auto",
  inputSchema: createTaskRequestSchema,
  outputSchema: taskMutationToolOutputSchema,
  execute: taskCreateExecute
}
```

Repeat for `tasks.update`, `tasks.updateStatus`, `tasks.breakDown`, `tasks.addActivity`, `tasks.assignTag`, `tasks.unassignTag`, `tasks.createList`, `tasks.renameList`, `tasks.createTag`, `tasks.renameTag`.

- [ ] **Step 5: Run task tool tests**

Run:

```bash
vitest run tests/integration/tasks-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/tools.ts packages/tasks/src/manifest.ts tests/integration/tasks-tools.test.ts
git commit -m "feat: add task agency write tools" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 3: Gateway Tests For Real Task Agency

**Files:**

- Create: `tests/integration/tasks-agency-tools.test.ts`

- [ ] **Step 1: Write gateway tests**

Create `tests/integration/tasks-agency-tools.test.ts` with:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord
} from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { TasksRepository, tasksModuleManifest } from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Tasks agency tools through AssistantToolGateway", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let aiRepository: AiRepository;
  let tasksRepository: TasksRepository;
  let tokens: SessionTokenRegistry;
  let confirmations: ConfirmationRegistry;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];
  let gateway: AssistantToolGateway;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    runner = new DataContextRunner(appDb);
    aiRepository = new AiRepository();
    tasksRepository = new TasksRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  beforeEach(() => {
    emitted = [];
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
    gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [tasksModuleManifest],
      repository: aiRepository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 1000
    });
  });

  function tokenFor(userId: string) {
    return tokens.mint({
      actorUserId: userId,
      chatSessionId: `tasks-${userId}`,
      allowedToolNames: null
    });
  }

  it("auto-runs non-destructive task writes without action_request", async () => {
    const response = await gateway.callTool(tokenFor(ids.userA), "tasks.create", {
      title: "gateway agency task"
    });

    expect(response.ok).toBe(true);
    expect(emitted).toHaveLength(0);
    if (!response.ok) throw new Error("expected ok");
    expect((response.data as { text: string }).text).toContain("Created task: gateway agency task");
  });

  it("auto-runs archive because archive is reversible normal agency", async () => {
    const task = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "seed-task-archive" },
      (db) => tasksRepository.create(db, { title: "archive via gateway" })
    );

    const response = await gateway.callTool(tokenFor(ids.userA), "tasks.updateStatus", {
      taskId: task.id,
      status: "archived"
    });

    expect(response.ok).toBe(true);
    expect(emitted).toHaveLength(0);
    if (!response.ok) throw new Error("expected ok");
    expect((response.data as { text: string }).text).toContain(
      "Archived task: archive via gateway"
    );
  });

  it("does not let one actor update another actor's private task", async () => {
    const task = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "seed-task-private" },
      (db) => tasksRepository.create(db, { title: "private task unchanged" })
    );

    await gateway.callTool(tokenFor(ids.userB), "tasks.update", {
      taskId: task.id,
      title: "changed by b"
    });

    const unchanged = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "check-task-private" },
      (db) => tasksRepository.getById(db, task.id)
    );
    expect(unchanged?.title).toBe("private task unchanged");
  });
});
```

- [ ] **Step 2: Run gateway task tests**

Run:

```bash
vitest run tests/integration/tasks-agency-tools.test.ts
```

Expected: PASS after Task 2.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/tasks-agency-tools.test.ts
git commit -m "test: cover task agency gateway writes" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 4: Destructive List/Tag Tools

**Files:**

- Modify: `packages/tasks/src/tools.ts`
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `tests/integration/tasks-agency-tools.test.ts`

- [ ] **Step 1: Add destructive gateway tests**

Add to `tests/integration/tasks-agency-tools.test.ts`:

```ts
it("requires confirmation for destructive task list deletion and does not execute before approval", async () => {
  const created = await gateway.callTool(tokenFor(ids.userA), "tasks.createList", {
    name: "delete confirmation list"
  });
  if (!created.ok) throw new Error("expected create list ok");
  const listId = JSON.parse((created.data as { text: string }).text).list.id as string;

  const call = gateway.callTool(tokenFor(ids.userA), "tasks.deleteList", { listId });
  await tick();

  const request = emitted.find((entry) => entry.record.kind === "action_request")?.record;
  expect(request).toMatchObject({ kind: "action_request", toolName: "tasks.deleteList" });

  const stillThere = await runner.withDataContext(
    { actorUserId: ids.userA, requestId: "check-list-before-confirm" },
    (db) =>
      db.db.selectFrom("app.task_lists").select("id").where("id", "=", listId).executeTakeFirst()
  );
  expect(stillThere).toBeDefined();

  if (!request || request.kind !== "action_request") throw new Error("expected request");
  await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "cancelled");
  await call;
});
```

- [ ] **Step 2: Implement destructive executors and manifests**

Add to `packages/tasks/src/tools.ts`:

```ts
export const taskDeleteListExecute: ToolExecute = async (scopedDb, input) => {
  assertDataContextDb(scopedDb);
  const { listId, reassignToListId } = input as { listId: string; reassignToListId?: string };
  await lists.deleteList(scopedDb, listId, reassignToListId);
  return { data: { summary: "Deleted task list.", deleted: true } };
};

export const taskDeleteTagExecute: ToolExecute = async (scopedDb, input) => {
  assertDataContextDb(scopedDb);
  const { listId, tagId } = input as { listId: string; tagId: string };
  await lists.deleteTag(scopedDb, listId, tagId);
  return { data: { summary: "Deleted task tag.", deleted: true } };
};
```

Add `tasks.deleteList` and `tasks.deleteTag` manifest entries with `risk: "destructive"` and no `executionPolicy`. Add `summarize` functions that name the target ids and reassignment id if supplied.

Do not add `tasks.delete` in this slice: no existing route/repository supports task deletion, and the approved spec allows destructive tools as follow-up when slice room is tight.

- [ ] **Step 3: Run destructive tests**

Run:

```bash
vitest run tests/integration/tasks-agency-tools.test.ts --testNamePattern "destructive"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/tasks/src/tools.ts packages/tasks/src/manifest.ts tests/integration/tasks-agency-tools.test.ts
git commit -m "feat: gate destructive task list and tag tools" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 5: Focused Gate And Cleanup

**Files:**

- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
vitest run tests/integration/mcp-gateway.test.ts tests/integration/tasks-tools.test.ts tests/integration/tasks-agency-tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required local checks**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 3: Report to Coordinator**

Message Coordinator with commit list, test evidence, and known follow-up: `tasks.delete` left out because there is no existing task delete surface and spec explicitly made destructive tools optional for this slice.

## Self-Review

- Spec coverage: Gateway policy implemented in manifest/policy layer; task create/update/status/archive/breakdown/activity/list/tag tools covered; RLS scoped through gateway and direct tests; destructive list/tag delete confirmation-gated. `tasks.delete` is the only explicit gap and is allowed by spec follow-up language.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Chosen field name is `executionPolicy`; policy values are `"auto"` and `"confirm"` across SDK, gateway, manifests, and tests.
