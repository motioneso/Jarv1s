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
