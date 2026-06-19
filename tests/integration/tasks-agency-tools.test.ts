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

  function textData(response: Awaited<ReturnType<AssistantToolGateway["callTool"]>>) {
    if (!response.ok) throw new Error("expected ok");
    return JSON.parse((response.data as { text: string }).text) as Record<string, unknown>;
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

  it("requires confirmation for destructive task list deletion", async () => {
    const created = textData(
      await gateway.callTool(tokenFor(ids.userA), "tasks.createList", {
        name: "delete confirmation list"
      })
    );
    const listId = (created.list as { id: string }).id;

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

  it("requires confirmation for destructive task tag deletion", async () => {
    const createdList = textData(
      await gateway.callTool(tokenFor(ids.userA), "tasks.createList", {
        name: "delete confirmation tag list"
      })
    );
    const listId = (createdList.list as { id: string }).id;
    const createdTag = textData(
      await gateway.callTool(tokenFor(ids.userA), "tasks.createTag", {
        listId,
        name: "delete-confirm-tag"
      })
    );
    const tagId = (createdTag.tag as { id: string }).id;

    const call = gateway.callTool(tokenFor(ids.userA), "tasks.deleteTag", { listId, tagId });
    await tick();

    const request = emitted.find((entry) => entry.record.kind === "action_request")?.record;
    expect(request).toMatchObject({ kind: "action_request", toolName: "tasks.deleteTag" });
    const stillThere = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "check-tag-before-confirm" },
      (db) =>
        db.db.selectFrom("app.task_tags").select("id").where("id", "=", tagId).executeTakeFirst()
    );
    expect(stillThere).toBeDefined();

    if (!request || request.kind !== "action_request") throw new Error("expected request");
    await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "cancelled");
    await call;
  });
});
