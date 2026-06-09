import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import type { TaskDto } from "@jarv1s/shared";
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

    const dueInOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const doTask = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "do-quadrant task", priority: 5, dueAt: dueInOneHour })
    );

    const result = await dataContext.withDataContext(userAContext(), (db) =>
      tool!.execute!(db, { quadrant: "do" }, toolCtx(ids.userA))
    );
    const resultIds = (result.data.tasks as TaskDto[]).map((t) => t.id);
    expect(resultIds).toContain(doTask.id);

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

    const parentId = await dataContext.withDataContext(userAContext(), async (db) => {
      const parent = await repository.create(db, { title: "get-tool parent" });
      await breakdown.breakDown(db, parent.id, ["child A", "child B"]);
      await repository.addActivity(db, parent.id, {
        activityType: "comment",
        body: "progress update"
      });
      return parent.id;
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

  it("tasks.get: returns { error } when the task is not visible to the actor", async () => {
    const tool = getTool("tasks.get");

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

    const lowOverdue = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "low-overdue drift task",
        priority: 1,
        dueAt: new Date("2000-01-01")
      })
    );
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
    expect(focusIds).toContain(lowOverdue.id);
    expect(atRiskIds).toContain(highOverdue.id);
    expect(atRiskIds).not.toContain(lowOverdue.id);
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
    expect(activity.at(0)?.body).toBe("first");
    expect(activity.at(1)?.body).toBe("second");
  });
});
