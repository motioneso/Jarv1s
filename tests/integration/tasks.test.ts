import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
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
  TasksRepository,
  registerTasksJobWorkers
} from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const taskIds = {
  aPrivate: "30000000-0000-4000-8000-000000000001",
  bPrivate: "30000000-0000-4000-8000-000000000002",
  bGrantedToA: "30000000-0000-4000-8000-000000000003",
  bWorkspaceShared: "30000000-0000-4000-8000-000000000004"
} as const;

const activityIds = {
  bPrivate: "31000000-0000-4000-8000-000000000001"
} as const;

describe("Tasks module M1", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: TasksRepository;
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
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(registrations.map((registration) => registration.manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
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
    expect(created.visibility).toBe("private");
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

  it("allows task access through an explicit resource grant", async () => {
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, taskIds.bGrantedToA)
    );

    expect(task?.id).toBe(taskIds.bGrantedToA);
  });

  it("allows workspace-visible task access only in active member workspace context", async () => {
    const withoutWorkspace = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, taskIds.bWorkspaceShared)
    );
    const wrongWorkspace = await dataContext.withDataContext(
      userAContext("20000000-0000-4000-8000-000000000999"),
      (scopedDb) => repository.getById(scopedDb, taskIds.bWorkspaceShared)
    );
    const withWorkspace = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) => repository.getById(scopedDb, taskIds.bWorkspaceShared)
    );

    expect(withoutWorkspace).toBeUndefined();
    expect(wrongWorkspace).toBeUndefined();
    expect(withWorkspace?.id).toBe(taskIds.bWorkspaceShared);
  });

  it("keeps task activity governed by parent task visibility and active actor context", async () => {
    const leakedActivity = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listActivity(scopedDb, taskIds.bPrivate)
    );
    const visibleToOwner = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.listActivity(scopedDb, taskIds.bPrivate)
    );
    const activityWrittenByContext = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.addActivity(scopedDb, taskIds.aPrivate, {
        activityType: "comment",
        body: "A scoped activity"
      })
    );

    expect(leakedActivity).toEqual([]);
    expect(visibleToOwner).toHaveLength(1);
    expect(visibleToOwner[0]?.body).toBe("B private activity");
    expect(activityWrittenByContext.actor_user_id).toBe(ids.userA);
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

  it("requires active workspace context when updating a task to workspace visibility", async () => {
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        title: "Workspace update guard task"
      }
    });
    const taskId = createResponse.json<{ task: { id: string } }>().task.id;
    const missingWorkspaceContextResponse = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      },
      payload: {
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });
    const activeWorkspaceResponse = await server.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      },
      payload: {
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(missingWorkspaceContextResponse.statusCode).toBe(400);
    expect(activeWorkspaceResponse.statusCode).toBe(200);
    expect(
      activeWorkspaceResponse.json<{ task: { visibility: string; workspaceId: string | null } }>()
        .task
    ).toMatchObject({
      visibility: "workspace",
      workspaceId: ids.workspaceAlpha
    });
  });

  it("keeps Tasks worker payloads metadata-only", async () => {
    const resultPromise = handleNextTaskJob(workerBoss);
    await appBoss.send(TASKS_DEFERRED_STATUS_QUEUE, {
      actorUserId: ids.userA,
      workspaceId: null,
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
        workspaceId: null,
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
      workspaceId: null,
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
});

async function seedTaskData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.tasks (id, owner_user_id, workspace_id, visibility, title, description, status)
        VALUES
          ($1, $2, null, 'private', 'User A seeded private task', 'A private description', 'todo'),
          ($3, $4, null, 'private', 'User B seeded private task', 'B private description', 'todo'),
          ($5, $4, null, 'private', 'User B granted task', 'B granted description', 'todo'),
          ($6, $4, $7, 'workspace', 'User B workspace task', 'B workspace description', 'todo')
      `,
      [
        taskIds.aPrivate,
        ids.userA,
        taskIds.bPrivate,
        ids.userB,
        taskIds.bGrantedToA,
        taskIds.bWorkspaceShared,
        ids.workspaceAlpha
      ]
    );
    await client.query(
      `
        INSERT INTO app.resource_grants (resource_type, resource_id, grantee_user_id, grant_level)
        VALUES ('task', $1, $2, 'view')
      `,
      [taskIds.bGrantedToA, ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.task_activity (id, task_id, actor_user_id, activity_type, body)
        VALUES ($1, $2, $3, 'comment', 'B private activity')
      `,
      [activityIds.bPrivate, taskIds.bPrivate, ids.userB]
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

function userAContext(workspaceId?: string): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId,
    requestId: "request:user-a-tasks"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-tasks"
  };
}
