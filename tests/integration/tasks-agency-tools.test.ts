import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  let agencyPrefs: Record<string, unknown>;

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
    agencyPrefs = {};
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
    gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [tasksModuleManifest],
      repository: aiRepository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 1000,
      agencyPrefs: () => ({
        get: async (key: string) => agencyPrefs[key] ?? null,
        upsert: async (key: string, value: unknown) => {
          agencyPrefs[key] = value as boolean;
        }
      }),
      actionPolicy: () => ({
        getFamilyTier: async (moduleId, familyId) => {
          if (
            moduleId === "tasks" &&
            familyId === "task_changes" &&
            agencyPrefs["tasks.agency_auto_execute"] === true
          ) {
            return "trusted_auto";
          }
          return null;
        },
        getFamilyManifest: async (moduleId, familyId) => {
          if (moduleId === "tasks" && familyId === "task_changes") {
            return {
              id: "task_changes",
              displayName: "Task Changes",
              label: "Task Changes",
              description: "Create and update tasks",
              defaultTier: "ask_each_time",
              allowedTiers: ["ask_each_time", "trusted_auto"]
            };
          }
          return null;
        }
      })
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

  it("confirms task writes until task trust is enabled", async () => {
    const call = gateway.callTool(tokenFor(ids.userA), "tasks.create", {
      title: "gateway agency task"
    });
    await tick();

    const request = emitted.find((entry) => entry.record.kind === "action_request")?.record;
    expect(request?.toolName).toBe("tasks.create");
    if (!request || request.kind !== "action_request") throw new Error("expected request");
    expect(request.summary).toContain("Jarvis now asks before creating tasks");

    const taskBeforeApproval = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "check-before-task-approval" },
      (db) => tasksRepository.listFiltered(db, {})
    );
    expect(taskBeforeApproval.some((task) => task.title === "gateway agency task")).toBe(false);

    await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "confirmed");
    const response = await call;
    if (!response.ok) throw new Error("expected ok");
    expect((response.data as { text: string }).text).toContain("Created task: gateway agency task");
  });

  it("first-run notice appears only once", async () => {
    const call1 = gateway.callTool(tokenFor(ids.userA), "tasks.create", {
      title: "first-run-notice-1"
    });
    await tick();

    const firstRequest = emitted.find((entry) => entry.record.kind === "action_request")?.record;
    if (!firstRequest || firstRequest.kind !== "action_request")
      throw new Error("expected first request");
    expect(firstRequest.summary).toContain("Jarvis now asks before creating tasks");
    await gateway.resolveActionRequest(ids.userA, firstRequest.actionRequestId, "confirmed");
    await call1;

    emitted.length = 0;
    const call2 = gateway.callTool(tokenFor(ids.userA), "tasks.create", {
      title: "first-run-notice-2"
    });
    await tick();

    const secondRequest = emitted.find((entry) => entry.record.kind === "action_request")?.record;
    if (!secondRequest || secondRequest.kind !== "action_request")
      throw new Error("expected second request");
    expect(secondRequest.summary).not.toContain("Jarvis now asks before creating tasks");
    await gateway.resolveActionRequest(ids.userA, secondRequest.actionRequestId, "confirmed");
    await call2;
  });

  it("auto-runs task writes when task trust is enabled", async () => {
    agencyPrefs["tasks.agency_auto_execute"] = true;

    const response = await gateway.callTool(tokenFor(ids.userA), "tasks.create", {
      title: "trusted gateway agency task"
    });

    expect(response.ok).toBe(true);
    expect(emitted).toEqual([
      {
        chatSessionId: `tasks-${ids.userA}`,
        record: expect.objectContaining({
          kind: "action_result",
          toolName: "tasks.create",
          outcome: "executed"
        })
      }
    ]);
    expect(emitted[0]?.record.actionRequestId).toMatch(/^mcp_/);
    if (!response.ok) throw new Error("expected ok");
    expect((response.data as { text: string }).text).toContain(
      "Created task: trusted gateway agency task"
    );
  });

  it("confirms archive until task trust is enabled", async () => {
    const task = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "seed-task-archive" },
      (db) => tasksRepository.create(db, { title: "archive via gateway" })
    );

    const call = gateway.callTool(tokenFor(ids.userA), "tasks.updateStatus", {
      taskId: task.id,
      status: "archived"
    });
    await tick();

    const request = emitted.find((entry) => entry.record.kind === "action_request")?.record;
    expect(request?.toolName).toBe("tasks.updateStatus");

    if (!request || request.kind !== "action_request") throw new Error("expected request");
    await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "confirmed");
    const response = await call;
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
    agencyPrefs["tasks.agency_auto_execute"] = true;
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
    agencyPrefs["tasks.agency_auto_execute"] = true;
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
    await vi.waitFor(() => {
      expect(emitted.some((entry) => entry.record.kind === "action_request")).toBe(true);
    });

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
