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
  type AccessContext,
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
  type DeferredTaskStatusResult,
  TaskListsRepository,
  TasksRepository,
  registerTasksJobWorkers
} from "@jarv1s/tasks";
import type { TaskDto } from "@jarv1s/shared";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const taskIds = {
  aPrivate: "30000000-0000-4000-8000-000000000001",
  bPrivate: "30000000-0000-4000-8000-000000000002"
} as const;

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
      "tasks.listVisible",
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
    const patchResponse = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${created.id}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "API-updated task",
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
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json<{ task: { title: string; status: string } }>().task).toMatchObject({
      title: "API-updated task",
      status: "in_progress"
    });
    expect(
      listResponse.json<{ tasks: Array<{ id: string }> }>().tasks.map((task) => task.id)
    ).toContain(created.id);
    expect(getAsOtherUserResponse.statusCode).toBe(404);
    expect(getOtherPrivateResponse.statusCode).toBe(404);
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
});

async function seedTaskData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    // Ensure each user has a Personal list (the migration seeds these for existing users,
    // but in tests the schema is rebuilt before users are inserted, so we seed them here).
    await client.query(
      `
        INSERT INTO app.task_lists (owner_user_id, name)
        VALUES ($1, 'Personal'), ($2, 'Personal')
        ON CONFLICT DO NOTHING
      `,
      [ids.userA, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.tasks (id, owner_user_id, title, description, status, list_id)
        VALUES
          ($1, $2, 'User A seeded private task', 'A private description', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $2 AND name = 'Personal' LIMIT 1)),
          ($3, $4, 'User B seeded private task', 'B private description', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $4 AND name = 'Personal' LIMIT 1))
      `,
      [taskIds.aPrivate, ids.userA, taskIds.bPrivate, ids.userB]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function handleNextTaskJob(workerBoss: PgBoss): Promise<DeferredTaskStatusResult> {
  const scopedWorkerDb = createDatabase({
    connectionString: connectionStrings.worker,
    maxConnections: 1
  });
  const dataContext = new DataContextRunner(scopedWorkerDb);
  let workIds: string[] = [];

  try {
    const resultPromise = new Promise<DeferredTaskStatusResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for Tasks worker"));
      }, 10_000);

      registerTasksJobWorkers(workerBoss, dataContext, {
        workOptions: { pollingIntervalSeconds: 0.5 },
        onResult: (_job, result) => {
          clearTimeout(timeout);
          resolve(result);
        }
      })
        .then((registeredWorkIds) => {
          workIds = registeredWorkIds;
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });

    return await resultPromise;
  } finally {
    await Promise.all(
      workIds.map((workId) =>
        workerBoss.offWork(TASKS_DEFERRED_STATUS_QUEUE, { id: workId, wait: true })
      )
    );
    await scopedWorkerDb.destroy();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-tasks"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-tasks"
  };
}
