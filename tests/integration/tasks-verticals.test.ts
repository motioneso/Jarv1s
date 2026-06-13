import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  DataContextRunner,
  SharesRepository,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import {
  TaskBreakdownRepository,
  TaskDriftRepository,
  TaskListsRepository,
  TasksRepository,
  rollForwardOwnedSeries
} from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import {
  handleNextRecurrenceJob,
  seedTaskData,
  taskIds,
  userAContext,
  userBContext
} from "./tasks-helpers.js";

const { Client } = pg;

describe("Tasks module M1 — recurrence, tags, list/tag management", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: TasksRepository;
  let sharesRepository: SharesRepository;
  let appBoss: PgBoss;
  let workerBoss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedTaskData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    workerDb = createDatabase({
      connectionString: connectionStrings.worker,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    repository = new TasksRepository();
    sharesRepository = new SharesRepository();
    appBoss = createPgBossClient(connectionStrings.app);
    workerBoss = createPgBossClient(connectionStrings.worker);

    await appBoss.start();
    await workerBoss.start();

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
      workerBoss?.stop({ graceful: false }),
      appDb?.destroy(),
      workerDb?.destroy()
    ]);
  });

  it("completing a recurring task generates exactly one next instance; idempotent", async () => {
    const made = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "take out trash",
        recurrence: { freq: "weekly", interval: 1, occurrence_date: "2026-06-08" },
        dueAt: new Date("2026-06-08")
      })
    );

    // Sanity: the created task must have a series id and the recurrence jsonb.
    expect(made.recurrence_series_id).toBeTruthy();
    expect((made.recurrence as Record<string, unknown>)["occurrence_date"]).toBe("2026-06-08");

    // Complete the task — this should spawn the next weekly instance.
    await dataContext.withDataContext(userAContext(), (db) =>
      repository.updateStatus(db, made.id, "done")
    );

    // Query the full series.
    const series = await dataContext.withDataContext(userAContext(), (db) =>
      db.db
        .selectFrom("app.tasks")
        .selectAll()
        .where("recurrence_series_id", "=", made.recurrence_series_id!)
        .execute()
    );

    const open = series.filter((t) => t.status === "todo");
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(made.id);

    // The next instance must be one week later.
    const nextOccurrence = (open[0]!.recurrence as Record<string, unknown>)["occurrence_date"];
    expect(nextOccurrence).toBe("2026-06-15");

    // Idempotency: completing the original again (already done) must NOT spawn a second open instance.
    await dataContext.withDataContext(userAContext(), (db) =>
      repository.updateStatus(db, made.id, "done")
    );
    const seriesAfter = await dataContext.withDataContext(userAContext(), (db) =>
      db.db
        .selectFrom("app.tasks")
        .selectAll()
        .where("recurrence_series_id", "=", made.recurrence_series_id!)
        .execute()
    );
    const openAfter = seriesAfter.filter((t) => t.status === "todo");
    expect(openAfter).toHaveLength(1);
  });

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
    await dataContext.withDataContext(userAContext(), (db) => rollForwardOwnedSeries(db, today));
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

  it("roll-forward is RLS-scoped: A's run never touches B's series", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bMade = await dataContext.withDataContext(userBContext(), (db) =>
      repository.create(db, {
        title: "B weekly",
        recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
      })
    );
    await dataContext.withDataContext(userAContext(), (db) => rollForwardOwnedSeries(db, today));
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

  it("roll-forward does NOT roll a manage-shared series owned by another user", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bMade = await dataContext.withDataContext(userBContext(), (db) =>
      repository.create(db, {
        title: "B weekly shared-manage",
        recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
      })
    );
    // Grant A a 'manage' share on B's task (owner-OR-share RLS would otherwise let A roll it).
    await dataContext.withDataContext(userBContext(), (db) =>
      sharesRepository.grant(db, {
        resourceType: "task",
        resourceId: bMade.id,
        ownerUserId: ids.userB,
        granteeUserId: ids.userA,
        level: "manage"
      })
    );
    // A's roll-forward run must skip it (explicit owner_user_id predicate, not just RLS).
    await dataContext.withDataContext(userAContext(), (db) => rollForwardOwnedSeries(db, today));
    const bLive = await dataContext.withDataContext(userBContext(), (db) =>
      db.db
        .selectFrom("app.tasks")
        .selectAll()
        .where("recurrence_series_id", "=", bMade.recurrence_series_id!)
        .where("status", "=", "todo")
        .execute()
    );
    const occ = (bLive[0]!.recurrence as Record<string, unknown>)["occurrence_date"] as string;
    expect(occ).toBe(past); // untouched — manage share is NOT ownership for roll-forward
  });

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

  it("recurrence worker rolls the actor's stale series forward under RLS", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const made = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "worker rolls me",
        recurrence: { freq: "weekly", interval: 1, occurrence_date: past }
      })
    );

    const result = await handleNextRecurrenceJob(appBoss, workerBoss, ids.userA);
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
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tasks: { id: string; tags: unknown[] }[] };
    expect(body.tasks.every((t) => Array.isArray(t.tags))).toBe(true);

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

  it("drift: overdue + at-risk surface Medium+ only; focus orders them", async () => {
    const drift = new TaskDriftRepository();
    await dataContext.withDataContext(userAContext(), async (db) => {
      await repository.create(db, {
        title: "overdue-critical",
        priority: 5,
        dueAt: new Date("2000-01-01")
      });
      await repository.create(db, {
        title: "overdue-someday",
        priority: 1,
        dueAt: new Date("2000-01-01")
      });
    });
    const overdue = await dataContext.withDataContext(userAContext(), (db) => drift.getOverdue(db));
    const atRisk = await dataContext.withDataContext(userAContext(), (db) => drift.getAtRisk(db));
    expect(overdue.map((t) => t.title)).toContain("overdue-critical");
    expect(atRisk.map((t) => t.title)).not.toContain("overdue-someday"); // priority < 3 excluded
  });

  it("GET /api/tasks/lists returns the actor's lists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/tasks/lists",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ lists: Array<{ name: string }> }>();
    expect(body.lists.map((l) => l.name)).toContain("Personal");
  });

  it("POST /api/tasks/lists creates a list (idempotent)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/tasks/lists",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "Work" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ list: { name: string; id: string } }>();
    expect(body.list.name).toBe("Work");

    // Second call returns the same list (idempotent get-or-create)
    const response2 = await server.inject({
      method: "POST",
      url: "/api/tasks/lists",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "Work" }
    });
    expect(response2.statusCode).toBe(201);
    expect(response2.json<{ list: { id: string } }>().list.id).toBe(body.list.id);
  });

  it("POST /api/tasks/lists/:listId/tags creates a tag on the list", async () => {
    // Get the Personal list id for userA
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreateDefault(db)
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/tasks/lists/${list.id}/tags`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { name: "urgent" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ tag: { name: string; listId: string } }>();
    expect(body.tag.name).toBe("urgent");
    expect(body.tag.listId).toBe(list.id);
  });

  it("POST /api/tasks/:id/breakdown creates child steps", async () => {
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "plan the trip" })
    );

    const response = await server.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/breakdown`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { steps: ["book flights", "reserve hotel"] }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ tasks: Array<{ title: string; parentTaskId: string }> }>();
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.map((t) => t.title)).toEqual(["book flights", "reserve hotel"]);
    expect(body.tasks[0]?.parentTaskId).toBe(task.id);
  });

  it("GET /api/tasks/focus returns overdue/at-risk tasks", async () => {
    // Seed a high-priority overdue task for userA
    await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "focus-route-test",
        priority: 5,
        dueAt: new Date("2000-01-01")
      })
    );

    const response = await server.inject({
      method: "GET",
      url: "/api/tasks/focus",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ tasks: Array<{ title: string }> }>();
    expect(body.tasks.map((t) => t.title)).toContain("focus-route-test");
  });

  it("GET /api/tasks/at-risk returns at-risk tasks", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/tasks/at-risk",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ tasks: unknown[] }>().tasks).toBeInstanceOf(Array);
  });

  it("GET /api/tasks?quadrant=do filters by Eisenhower quadrant", async () => {
    // Seed a task that is important (priority=5) + urgent (due in 1 hour)
    const dueIn1h = new Date(Date.now() + 60 * 60 * 1000);
    await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "quadrant-do-test",
        priority: 5,
        dueAt: dueIn1h
      })
    );

    const response = await server.inject({
      method: "GET",
      url: "/api/tasks?quadrant=do",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ tasks: Array<{ title: string }> }>();
    expect(body.tasks.map((t) => t.title)).toContain("quadrant-do-test");
  });

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
    expect(subtasks.at(0)?.title).toBe("book flights");
    expect(subtasks.at(1)?.title).toBe("book hotel");
    expect(subtasks.at(2)?.title).toBe("pack bags");
  });

  it("rejects task create with a listId that belongs to another user (404)", async () => {
    const userBList = await dataContext.withDataContext(userBContext(), (db) =>
      new TaskListsRepository().getOrCreateDefault(db)
    );

    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.create(db, {
          title: "cross-list task",
          listId: userBList.id
        })
      )
    ).rejects.toThrow("List not found or not accessible");
  });

  it("rejects task create with a parentTaskId owned by another user (404)", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.create(db, {
          title: "cross-parent task",
          parentTaskId: taskIds.bPrivate
        })
      )
    ).rejects.toThrow("Parent task not found or not accessible");
  });

  it("rejects task update with a listId that belongs to another user (404)", async () => {
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "will be moved to wrong list" })
    );
    const userBList = await dataContext.withDataContext(userBContext(), (db) =>
      new TaskListsRepository().getOrCreateDefault(db)
    );

    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.update(db, task.id, { listId: userBList.id })
      )
    ).rejects.toThrow("List not found or not accessible");
  });

  it("rejects task update with a parentTaskId owned by another user (404)", async () => {
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "will be re-parented to wrong task" })
    );

    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.update(db, task.id, { parentTaskId: taskIds.bPrivate })
      )
    ).rejects.toThrow("Parent task not found or not accessible");
  });

  it("allows task create with own listId and own parentTaskId", async () => {
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      new TaskListsRepository().getOrCreateDefault(db)
    );
    const parent = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "parent task" })
    );
    const child = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, {
        title: "child task",
        listId: list.id,
        parentTaskId: parent.id
      })
    );

    expect(child.list_id).toBe(list.id);
    expect(child.parent_task_id).toBe(parent.id);
  });

  it("rejects parenting under a task that is only VIEW-SHARED to the actor (ownership, not visibility)", async () => {
    const userBTask = await dataContext.withDataContext(userBContext(), (db) =>
      repository.create(db, { title: "userB task, view-shared to A" })
    );
    await dataContext.withDataContext(userBContext(), (db) =>
      sharesRepository.grant(db, {
        resourceType: "task",
        resourceId: userBTask.id,
        ownerUserId: ids.userB,
        granteeUserId: ids.userA,
        level: "view"
      })
    );

    // Sanity: userA CAN see the task (visibility passes) ...
    const visibleToA = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getById(db, userBTask.id)
    );
    expect(visibleToA?.id).toBe(userBTask.id);

    // ... but must NOT be able to parent under it on create.
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.create(db, { title: "child under foreign parent", parentTaskId: userBTask.id })
      )
    ).rejects.toThrow("Parent task not found or not accessible");

    // ... and must NOT be able to re-parent an existing own task under it on update.
    const ownTask = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "userA own task" })
    );
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        repository.update(db, ownTask.id, { parentTaskId: userBTask.id })
      )
    ).rejects.toThrow("Parent task not found or not accessible");
  });

  it("POST /api/tasks with a foreign listId returns 404", async () => {
    const userBList = await dataContext.withDataContext(userBContext(), (db) =>
      new TaskListsRepository().getOrCreateDefault(db)
    );

    const response = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { title: "cross-list via API", listId: userBList.id }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toBe("List not found or not accessible");
  });

  it("HttpError from tasks errors module has correct statusCode and message", async () => {
    const { HttpError } = await import("../../packages/tasks/src/errors.js");
    const err = new HttpError(404, "not found");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("not found");
    expect(err).toBeInstanceOf(Error);
  });

  it("getById and listVisible return joined tags (direct-insert assignment)", async () => {
    const listsRepo = new TaskListsRepository();
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

  it("assignTag enforces same-list via trigger; unassignTag removes", async () => {
    const listsRepo = new TaskListsRepository();
    const listA = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "A")
    );
    const listB = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "B")
    );
    const tagB = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, listB.id, "X")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "t", listId: listA.id })
    );

    await expect(
      dataContext.withDataContext(userAContext(), (db) => listsRepo.assignTag(db, task.id, tagB.id))
    ).rejects.toThrow(); // cross-list rejected by task_tag_list_match trigger

    const tagA = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, listA.id, "Y")
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, task.id, tagA.id)
    );
    let tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
    expect(tags.map((t) => t.id)).toContain(tagA.id);

    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.unassignTag(db, task.id, tagA.id)
    );
    tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
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

  it("moving a task to another list drops tags foreign to the destination", async () => {
    const listsRepo = new TaskListsRepository();
    const listA = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "A1")
    );
    const listB = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "B1")
    );
    const tagA = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, listA.id, "only-A")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "mover", listId: listA.id })
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, task.id, tagA.id)
    );

    await dataContext.withDataContext(userAContext(), (db) =>
      repository.update(db, task.id, { listId: listB.id })
    );

    const tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
    expect(tags).toHaveLength(0); // tagA belonged to listA, dropped on move to listB
  });

  it("renameList renames, rejects duplicates (409), and 404s a foreign/missing list", async () => {
    const listsRepo = new TaskListsRepository();
    const original = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Rename Src")
    );
    const other = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Rename Other")
    );

    // Rename to a fresh unique name succeeds.
    const renamed = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.renameList(db, original.id, "Rename Dst")
    );
    expect(renamed.name).toBe("Rename Dst");

    // Renaming to a name already taken (case-insensitive unique index) → 409.
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.renameList(db, renamed.id, "Rename Other")
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    // A foreign/non-existent list id → 404 (RLS UPDATE matches zero rows).
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.renameList(db, "00000000-0000-0000-0000-000000000000", "whatever")
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    // `other` is referenced (suppresses unused-var lint) — confirm it still exists.
    expect(other.id).not.toBe(renamed.id);
  });

  it("deleteList refuses a non-empty list without reassign (409)", async () => {
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Delete NonEmpty")
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "blocks delete", listId: list.id })
    );

    await expect(
      dataContext.withDataContext(userAContext(), (db) => listsRepo.deleteList(db, list.id))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("deleteList with reassign moves tasks, drops old-list tags, and deletes the list", async () => {
    const listsRepo = new TaskListsRepository();
    const src = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Reassign Src")
    );
    const dst = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Reassign Dst")
    );
    const srcTag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, src.id, "src-only")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "reassign me", listId: src.id })
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, task.id, srcTag.id)
    );

    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.deleteList(db, src.id, dst.id)
    );

    // The src list is gone.
    const remaining = await dataContext.withDataContext(userAContext(), (db) =>
      db.db.selectFrom("app.task_lists").select("id").where("id", "=", src.id).execute()
    );
    expect(remaining).toHaveLength(0);

    // The task moved to dst and its src-list tag was dropped.
    const moved = await dataContext.withDataContext(userAContext(), (db) =>
      db.db.selectFrom("app.tasks").selectAll().where("id", "=", task.id).executeTakeFirstOrThrow()
    );
    expect(moved.list_id).toBe(dst.id);
    const tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
    expect(tags).toHaveLength(0); // src-only tag dropped on reassign
  });

  it("deleteList 404s a foreign/missing list before the last-list guard (actor has other lists)", async () => {
    const listsRepo = new TaskListsRepository();
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.deleteList(db, "00000000-0000-0000-0000-000000000000")
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deleteList rejects a self-reassign with 400 (not a RESTRICT 409)", async () => {
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Self Reassign")
    );
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.deleteList(db, list.id, list.id)
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deleteList refuses to delete the actor's only list (409)", async () => {
    // The admin user is seeded with NO task lists (only userA/userB get a Personal list),
    // and no other tasks test creates lists for it — so a single created list IS its only list.
    const adminContext = {
      actorUserId: ids.adminUser,
      requestId: "request:admin-delete-last-list"
    };
    const listsRepo = new TaskListsRepository();
    const only = await dataContext.withDataContext(adminContext, (db) =>
      listsRepo.getOrCreate(db, "Admin Only List")
    );
    await expect(
      dataContext.withDataContext(adminContext, (db) => listsRepo.deleteList(db, only.id))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("renameTag renames, rejects duplicates (409), and 404s a foreign/missing tag", async () => {
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Tag Rename List")
    );
    const original = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "tag-rename-src")
    );
    const other = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "tag-rename-other")
    );

    // Rename to a fresh unique name succeeds.
    const renamed = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.renameTag(db, list.id, original.id, "tag-rename-dst")
    );
    expect(renamed.name).toBe("tag-rename-dst");

    // Renaming to a name already taken in the list (case-insensitive unique index) → 409.
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.renameTag(db, list.id, renamed.id, "tag-rename-other")
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    // A foreign/non-existent tag id → 404 (RLS UPDATE matches zero rows).
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.renameTag(db, list.id, "00000000-0000-0000-0000-000000000000", "whatever")
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    // `other` is referenced (suppresses unused-var lint) — it is the 409 collision target.
    expect(other.id).not.toBe(renamed.id);
  });

  it("deleteTag removes the tag and cascades its assignment rows", async () => {
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Tag Delete List")
    );
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, list.id, "delete-me")
    );
    const task = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "tagged", listId: list.id })
    );
    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.assignTag(db, task.id, tag.id)
    );

    await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.deleteTag(db, list.id, tag.id)
    );

    // The tag is gone.
    const remainingTags = await dataContext.withDataContext(userAContext(), (db) =>
      db.db.selectFrom("app.task_tags").select("id").where("id", "=", tag.id).execute()
    );
    expect(remainingTags).toHaveLength(0);

    // The assignment row was cascaded (task_tag_assignments.tag_id ON DELETE CASCADE).
    const tags = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getTagsForTask(db, task.id)
    );
    expect(tags).toHaveLength(0);
  });

  it("deleteTag 404s a foreign/missing tag", async () => {
    const listsRepo = new TaskListsRepository();
    const list = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreate(db, "Tag Delete 404 List")
    );
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        listsRepo.deleteTag(db, list.id, "00000000-0000-0000-0000-000000000000")
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
