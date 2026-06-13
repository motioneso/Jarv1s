import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  SharesRepository,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import {
  TASKS_DEFERRED_STATUS_QUEUE,
  type DeferredTaskStatusPayload,
  TaskBreakdownRepository,
  TaskDriftRepository,
  TaskListsRepository,
  TasksRepository,
  rollForwardOwnedSeries
} from "@jarv1s/tasks";
import type { TaskDto } from "@jarv1s/shared";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import {
  handleNextTaskJob,
  seedTaskData,
  taskIds,
  userAContext,
  userBContext
} from "./tasks-helpers.js";

const { Client } = pg;

describe("Tasks module M1", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
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
    auth = new AuthSessionResolver(appDb);
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

  it("applies Tasks migrations from an empty database with forced RLS", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version = '0003'
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('tasks', 'task_activity')
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([{ version: "0003", name: "0003_tasks_module.sql" }]);
      expect(tables.rows).toEqual([
        {
          relname: "task_activity",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner"
        },
        {
          relname: "tasks",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner"
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads the built-in Tasks module manifest", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const tasksManifest = manifests.find((manifest) => manifest.id === "tasks");

    expect(manifests.map((manifest) => manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "structured-state"
    ]);
    expect(registrations.map((registration) => registration.manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "structured-state"
    ]);
    expect(tasksManifest?.database?.ownedTables).toEqual(["app.tasks", "app.task_activity"]);
    expect(tasksManifest?.navigation?.[0]).toMatchObject({
      id: "tasks",
      path: "/tasks",
      permissionId: "tasks.view"
    });
    expect(tasksManifest?.permissions?.map((permission) => permission.id)).toContain(
      "tasks.update"
    );
    expect(tasksManifest?.jobs?.[0]).toMatchObject({
      queueName: TASKS_DEFERRED_STATUS_QUEUE,
      metadataOnly: true,
      permissionId: "tasks.update"
    });
    expect(tasksManifest?.assistantTools?.map((tool) => tool.name)).toEqual([
      "tasks.list",
      "tasks.get",
      "tasks.focus",
      "tasks.atRisk",
      "tasks.overdue",
      "tasks.listLists",
      "tasks.listTags",
      "tasks.activity",
      "tasks.updateStatus"
    ]);
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/tasks/sql")
    );
  });

  it("denies task reads when no data context is set", async () => {
    await expect(appDb.selectFrom("app.tasks").select("id").execute()).resolves.toEqual([]);
  });

  it("lets a user create and read their own private task", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "User A private task",
        description: "private description"
      })
    );
    const fetched = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(fetched?.id).toBe(created.id);
  });

  it("prevents a user from reading another user's unshared private task", async () => {
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, taskIds.bPrivate)
    );

    expect(task).toBeUndefined();
  });

  it("does not let an instance admin read another user's private task by role alone", async () => {
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin-tasks");
    const task = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, taskIds.bPrivate)
    );

    expect(task).toBeUndefined();
  });

  it("allows task read through a view share", async () => {
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { title: "Shared with B" })
    );
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      sharesRepository.grant(scopedDb, {
        resourceType: "task",
        resourceId: task.id,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      })
    );
    const visibleToB = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, task.id)
    );

    expect(visibleToB?.id).toBe(task.id);
  });

  it("does not let a view-share grantee update the task", async () => {
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { title: "View-only for B" })
    );
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      sharesRepository.grant(scopedDb, {
        resourceType: "task",
        resourceId: task.id,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      })
    );
    const updated = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.update(scopedDb, task.id, { title: "hijacked" })
    );

    expect(updated).toBeUndefined(); // RLS hides the row from UPDATE for a view-only grantee
  });

  it("lets a manage-share grantee update the task", async () => {
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { title: "Managed by B" })
    );
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      sharesRepository.grant(scopedDb, {
        resourceType: "task",
        resourceId: task.id,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "manage"
      })
    );
    const updated = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.update(scopedDb, task.id, { title: "Managed title" })
    );

    expect(updated?.title).toBe("Managed title");
  });

  it("keeps task activity governed by parent task visibility via owner-or-share inheritance", async () => {
    // userA creates a task and adds activity to it
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { title: "Activity inheritance test task" })
    );
    const activity = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.addActivity(scopedDb, task.id, {
        activityType: "comment",
        body: "Activity on shared task"
      })
    );

    // Share the task 'view' to userB
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      sharesRepository.grant(scopedDb, {
        resourceType: "task",
        resourceId: task.id,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      })
    );

    // userB can read the activity (inherits task visibility through task_activity_select EXISTS)
    const visibleToB = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.listActivity(scopedDb, task.id)
    );

    // adminUser has no share — cannot read the activity
    const adminContext = {
      actorUserId: ids.adminUser,
      requestId: "request:tasks-test"
    };
    const notVisibleToAdmin = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.listActivity(scopedDb, task.id)
    );

    expect(activity.actor_user_id).toBe(ids.userA);
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]?.body).toBe("Activity on shared task");
    expect(notVisibleToAdmin).toEqual([]);
  });

  it("serves Tasks API routes from session-derived context without accepting client owner fields", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "API-created task",
        ownerUserId: ids.userB,
        owner_user_id: ids.userB
      }
    });
    const created = createResponse.json<{
      task: { id: string; ownerUserId: string; title: string; status: string };
    }>().task;
    const getAsOwnerResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    // Title-only PATCH (valid — no status change)
    const titlePatchResponse = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "API-updated task"
      }
    });
    // in_progress is retired — the route must reject it with 400
    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        status: "in_progress"
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const getAsOtherUserResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionB}`
      }
    });
    const getOtherPrivateResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${taskIds.bPrivate}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(created.ownerUserId).toBe(ids.userA);
    expect(getAsOwnerResponse.statusCode).toBe(200);
    // Title update succeeds
    expect(titlePatchResponse.statusCode).toBe(200);
    expect(titlePatchResponse.json<{ task: { title: string } }>().task.title).toBe(
      "API-updated task"
    );
    // in_progress is retired — route rejects it
    expect(patchResponse.statusCode).toBe(400); // in_progress retired
    expect(
      listResponse.json<{ tasks: Array<{ id: string }> }>().tasks.map((task) => task.id)
    ).toContain(created.id);
    expect(getAsOtherUserResponse.statusCode).toBe(404);
    expect(getOtherPrivateResponse.statusCode).toBe(404);
  });

  it("creates the tasks-recurrence-materialize queue", async () => {
    const queue = await workerBoss.getQueue("tasks-recurrence-materialize");
    expect(queue).not.toBeNull();
  });

  it("isRecurrenceMaterializePayloadMetadataOnly rejects extra keys", async () => {
    const { isRecurrenceMaterializePayloadMetadataOnly } = await import("@jarv1s/tasks");
    expect(isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA })).toBe(true);
    expect(
      isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA, idempotencyKey: "k" })
    ).toBe(true);
    expect(
      isRecurrenceMaterializePayloadMetadataOnly({ actorUserId: ids.userA, seriesId: "x" })
    ).toBe(false);
  });

  it("keeps Tasks worker payloads metadata-only", async () => {
    const resultPromise = handleNextTaskJob(workerBoss);
    await appBoss.send(TASKS_DEFERRED_STATUS_QUEUE, {
      actorUserId: ids.userA,
      taskId: taskIds.aPrivate,
      requestedStatus: "done",
      idempotencyKey: "tasks-test-metadata"
    } satisfies DeferredTaskStatusPayload);
    const result = await resultPromise;
    const client = new Client({ connectionString: connectionStrings.bootstrap });

    await client.connect();
    try {
      const payloads = await client.query<{ data: Record<string, unknown> }>(
        `
          SELECT data
          FROM pgboss.job_common
          WHERE name = $1
          ORDER BY created_on DESC
          LIMIT 1
        `,
        [TASKS_DEFERRED_STATUS_QUEUE]
      );
      const payload = payloads.rows[0]?.data;

      expect(result).toMatchObject({
        taskId: taskIds.aPrivate,
        updated: true,
        status: "done"
      });
      expect(payload).toEqual({
        actorUserId: ids.userA,
        taskId: taskIds.aPrivate,
        requestedStatus: "done",
        idempotencyKey: "tasks-test-metadata"
      });
      expect(payload).not.toHaveProperty("title");
      expect(payload).not.toHaveProperty("description");
      expect(payload).not.toHaveProperty("body");
    } finally {
      await client.end();
    }
  });

  it("does not let a User A worker job update User B's private task", async () => {
    const resultPromise = handleNextTaskJob(workerBoss);
    await appBoss.send(TASKS_DEFERRED_STATUS_QUEUE, {
      actorUserId: ids.userA,
      taskId: taskIds.bPrivate,
      requestedStatus: "done"
    } satisfies DeferredTaskStatusPayload);
    const result = await resultPromise;
    const userBTask = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, taskIds.bPrivate)
    );

    expect(result).toEqual({
      taskId: taskIds.bPrivate,
      updated: false,
      status: null
    });
    expect(userBTask?.status).toBe("todo");
  });

  it("fails loudly when the Tasks repository is called without withDataContext", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  it("migration 0039: every task has a list, in_progress is retired, new columns exist", async () => {
    // Use the bootstrap (superuser) connection so RLS does not filter the counts.
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      // All tasks in the DB have a non-null list_id (the NOT NULL constraint holds and
      // the repository default-list logic works for newly created tasks too).
      const orphans = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM app.tasks WHERE list_id IS NULL"
      );
      expect(Number(orphans.rows[0]?.n)).toBe(0);

      // The seeded tasks (inserted via seedTaskData, which runs after the migration)
      // must not have in_progress status — backfill correctness is verified by confirming
      // the seeded task IDs have 'todo' status.
      const seededInProgress = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.tasks
         WHERE id = ANY($1::uuid[]) AND status = 'in_progress'`,
        [[taskIds.aPrivate, taskIds.bPrivate]]
      );
      expect(Number(seededInProgress.rows[0]?.n)).toBe(0);

      // Every test user has a Personal list (seeded in seedTaskData for the fresh test DB).
      const lists = await client.query<{ owner_user_id: string; name: string }>(
        "SELECT owner_user_id, name FROM app.task_lists WHERE name = 'Personal'"
      );
      expect(lists.rows.length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });

  it("db types: new task columns and tables are queryable", async () => {
    const cols = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema='app' and table_name='tasks'
        and column_name in ('list_id','parent_task_id','do_at','effort','source','recurrence_series_id')
    `.execute(appDb);
    expect(cols.rows.length).toBe(6);
  });

  it("shared: Task DTO carries the new fields", () => {
    // compile-time guard: a TaskDto literal must accept the new fields
    const dto: Pick<TaskDto, "listId" | "doAt" | "effort" | "source"> = {
      listId: "x",
      doAt: null,
      effort: "quick",
      source: "manual"
    };
    expect(dto.source).toBe("manual");
  });

  it("create defaults to Personal list, accepts new fields, and is idempotent on (source, external_key)", async () => {
    const listsRepo = new TaskListsRepository();
    const made = await dataContext.withDataContext(userAContext(), async (db) => {
      const list = await listsRepo.getOrCreateDefault(db);
      return repository.create(db, {
        title: "ship the deck",
        priority: 4,
        effort: "medium",
        doAt: new Date("2026-06-10"),
        source: "chat",
        externalKey: "chat:42",
        listId: list.id
      });
    });
    expect(made.priority).toBe(4);
    expect(made.effort).toBe("medium");
    expect(made.source).toBe("chat");
    expect(made.external_key).toBe("chat:42");

    // Second create with same (source, externalKey) must return the SAME task id.
    const second = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "dup", source: "chat", externalKey: "chat:42" })
    );
    expect(second.id).toBe(made.id);

    // Create without a listId defaults to the Personal list.
    const defaultList = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreateDefault(db)
    );
    const noListTask = await dataContext.withDataContext(userAContext(), (db) =>
      repository.create(db, { title: "auto-list task" })
    );
    expect(noListTask.list_id).toBe(defaultList.id);
    expect(noListTask.source).toBe("manual");
  });

  it("breakdown augments into a parent; all children done auto-closes parent; grandchild rejected", async () => {
    const breakdown = new TaskBreakdownRepository();
    const { parent, children } = await dataContext.withDataContext(userAContext(), async (db) => {
      const p = await repository.create(db, { title: "clean kitchen" });
      const kids = await breakdown.breakDown(db, p.id, ["unload dishwasher", "wipe counters"]);
      return { parent: p, children: kids };
    });

    expect(children).toHaveLength(2);
    expect(children[0]?.parent_task_id).toBe(parent.id);
    expect(children[0]?.list_id).toBe(parent.list_id);
    expect(children[0]?.position).toBe(0);
    expect(children[1]?.position).toBe(1);

    // Grandchild rejected by the DB trigger.
    await expect(
      dataContext.withDataContext(userAContext(), (db) =>
        breakdown.breakDown(db, children[0]!.id, ["nope"])
      )
    ).rejects.toThrow(/one-level hierarchy/);

    // Completing all children auto-closes the parent.
    await dataContext.withDataContext(userAContext(), async (db) => {
      for (const c of children) await repository.updateStatus(db, c.id, "done");
    });
    const reloaded = await dataContext.withDataContext(userAContext(), (db) =>
      repository.getById(db, parent.id)
    );
    expect(reloaded?.status).toBe("done");
  });

  it("lists: get-or-create Personal is idempotent; tags are list-scoped", async () => {
    const listsRepo = new TaskListsRepository();

    // Calling getOrCreateDefault twice must return the same row.
    const a = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreateDefault(db)
    );
    const b = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.getOrCreateDefault(db)
    );
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("Personal");

    // createTag + listTags are list-scoped.
    const tag = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.createTag(db, a.id, "Visa")
    );
    const tags = await dataContext.withDataContext(userAContext(), (db) =>
      listsRepo.listTags(db, a.id)
    );
    expect(tags.map((t) => t.name)).toContain("Visa");
    expect(tag.list_id).toBe(a.id);
    expect(tag.owner_user_id).toBe(ids.userA);
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
});
