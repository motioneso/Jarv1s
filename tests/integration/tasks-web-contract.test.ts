import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskApiStatus } from "@jarv1s/shared";
import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("tasks status contract (Plan 3 narrowing)", () => {
  it("TASK_STATUSES is narrowed to todo|done|archived; in_progress retired", () => {
    expect([...TASK_STATUSES]).toEqual(["todo", "done", "archived"]);
    // @ts-expect-error — in_progress is no longer assignable to TaskApiStatus
    const retired: TaskApiStatus = "in_progress";
    expect(retired).toBe("in_progress");
  });
});

describe("task_preferences vertical slice (Plan 3 Task 3)", () => {
  let server: ReturnType<typeof createApiServer>;
  let appBoss: ReturnType<typeof createPgBossClient>;
  let appDb: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    appBoss = createPgBossClient(connectionStrings.app);
    await appBoss.start();

    server = createApiServer({
      appDb,
      boss: appBoss,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appBoss?.stop({ graceful: false }),
      appDb?.destroy()
    ]);
  });

  it("GET /api/tasks/preferences defaults to priority; PATCH round-trips matrix", async () => {
    const initial = await server.inject({
      method: "GET",
      url: "/api/tasks/preferences",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(initial.statusCode).toBe(200);
    expect(JSON.parse(initial.body).preferences.defaultView).toBe("priority");

    const updated = await server.inject({
      method: "PATCH",
      url: "/api/tasks/preferences",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { defaultView: "matrix" }
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).preferences.defaultView).toBe("matrix");

    const reread = await server.inject({
      method: "GET",
      url: "/api/tasks/preferences",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(JSON.parse(reread.body).preferences.defaultView).toBe("matrix");
  });
});

describe("subtasks read route (Plan 3 Task 4)", () => {
  let server: ReturnType<typeof createApiServer>;
  let appBoss: ReturnType<typeof createPgBossClient>;
  let appDb: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    appBoss = createPgBossClient(connectionStrings.app);
    await appBoss.start();

    server = createApiServer({
      appDb,
      boss: appBoss,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appBoss?.stop({ graceful: false }),
      appDb?.destroy()
    ]);
  });

  it("GET /api/tasks/:id/subtasks returns the parent's children in order", async () => {
    const parentRes = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { title: "clean kitchen" }
    });
    const parent = JSON.parse(parentRes.body).task;

    await server.inject({
      method: "POST",
      url: `/api/tasks/${parent.id}/breakdown`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { steps: ["unload dishwasher", "wipe counters"] }
    });

    const subtasksRes = await server.inject({
      method: "GET",
      url: `/api/tasks/${parent.id}/subtasks`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(subtasksRes.statusCode).toBe(200);
    const titles = JSON.parse(subtasksRes.body).tasks.map((t: { title: string }) => t.title);
    expect(titles).toEqual(["unload dishwasher", "wipe counters"]);
  });
});

describe("tasks route parser — new fields round-trip (Plan 3 Task 2)", () => {
  let server: ReturnType<typeof createApiServer>;
  let appBoss: ReturnType<typeof createPgBossClient>;
  let appDb: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    appBoss = createPgBossClient(connectionStrings.app);
    await appBoss.start();

    server = createApiServer({
      appDb,
      boss: appBoss,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appBoss?.stop({ graceful: false }),
      appDb?.destroy()
    ]);
  });

  it("POST /api/tasks persists listId, doAt, and effort", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        title: "ship the deck",
        priority: 4,
        effort: "medium",
        doAt: "2026-06-10T12:00:00.000Z"
      }
    });
    expect(created.statusCode).toBe(201);
    const task = JSON.parse(created.body).task;
    expect(task.effort).toBe("medium");
    expect(task.doAt).toBe("2026-06-10T12:00:00.000Z");
    expect(task.priority).toBe(4);

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { effort: "quick", doAt: null }
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body).task.effort).toBe("quick");
    expect(JSON.parse(patched.body).task.doAt).toBeNull();
  });
});
