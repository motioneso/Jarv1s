import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  BRIEFINGS_RUN_QUEUE,
  BriefingsRepository,
  briefingsModuleManifest,
  isBriefingRunPayloadMetadataOnly,
  registerBriefingsJobWorkers,
  type BriefingRunPayload,
  type BriefingRunResult
} from "@jarv1s/briefings";
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
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const briefingIds = {
  userBPrivate: "77000000-0000-4000-8000-000000000001",
  userBWorkspace: "77000000-0000-4000-8000-000000000002"
} as const;

const sourceIds = {
  userATask: "78000000-0000-4000-8000-000000000001",
  userBPrivateTask: "78000000-0000-4000-8000-000000000002",
  userAWorkspaceTask: "78000000-0000-4000-8000-000000000003",
  userANote: "79000000-0000-4000-8000-000000000001",
  userBPrivateNote: "79000000-0000-4000-8000-000000000002",
  userAConnector: "7a000000-0000-4000-8000-000000000001",
  userBConnector: "7a000000-0000-4000-8000-000000000002",
  userAEmail: "7b000000-0000-4000-8000-000000000001",
  userBPrivateEmail: "7b000000-0000-4000-8000-000000000002"
} as const;

describe("Briefings module M6 read-only scheduled summaries", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: BriefingsRepository;
  let appBoss: PgBoss;
  let workerBoss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedBriefingData();

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
    repository = new BriefingsRepository();
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

  it("applies Briefings migrations with forced RLS and narrow worker table grants", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version = '0015'
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_delete: boolean;
        worker_can_insert: boolean;
        worker_can_select: boolean;
        worker_can_update: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'INSERT') AS worker_can_insert,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'UPDATE') AS worker_can_update
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('briefing_definitions', 'briefing_runs')
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([{ version: "0015", name: "0015_briefings_module.sql" }]);
      expect(tables.rows).toEqual([
        {
          relname: "briefing_definitions",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_delete: false,
          worker_can_insert: false,
          worker_can_select: true,
          worker_can_update: true
        },
        {
          relname: "briefing_runs",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_delete: false,
          worker_can_insert: true,
          worker_can_select: true,
          worker_can_update: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads Briefings as a required built-in module with a metadata-only run queue", () => {
    const manifests = getBuiltInModuleManifests();
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === briefingsModuleManifest.id
    );

    expect(manifests.map((item) => item.id)).toEqual([
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
    expect(registration?.manifest.database?.ownedTables).toEqual([
      "app.briefing_definitions",
      "app.briefing_runs"
    ]);
    expect(registration?.manifest.navigation?.[0]).toMatchObject({
      id: "briefings",
      path: "/briefings",
      permissionId: "briefings.view"
    });
    expect(registration?.manifest.jobs?.[0]).toMatchObject({
      queueName: BRIEFINGS_RUN_QUEUE,
      metadataOnly: true,
      permissionId: "briefings.run"
    });
    expect(registration?.queueDefinitions.map((queue) => queue.name)).toEqual([
      BRIEFINGS_RUN_QUEUE
    ]);
    expect(getBuiltInSqlMigrationDirectories().at(-1)).toContain("packages/briefings/sql");
  });

  it("keeps definitions private by default and denies admin private-data bypass", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "User A private briefing",
        selectedToolNames: ["tasks.listVisible"]
      })
    );
    const userARead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getDefinitionById(scopedDb, created.id)
    );
    const userBRead = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getDefinitionById(scopedDb, created.id)
    );
    const adminContext = await auth.resolveAccessContext(
      ids.sessionAdmin,
      "request:admin-briefings"
    );
    const adminRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getDefinitionById(scopedDb, briefingIds.userBPrivate)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(created.visibility).toBe("private");
    expect(userARead?.id).toBe(created.id);
    expect(userBRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("requires active workspace context for workspace-visible definitions", async () => {
    const missingWorkspaceResponse = await server.inject({
      method: "POST",
      url: "/api/briefings/definitions",
      headers: userAHeaders(),
      payload: {
        title: "Workspace briefing",
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha,
        cadence: "daily",
        selectedToolNames: ["tasks.listVisible"]
      }
    });
    const createdResponse = await server.inject({
      method: "POST",
      url: "/api/briefings/definitions",
      headers: userAWorkspaceHeaders(),
      payload: {
        title: "Workspace briefing",
        visibility: "workspace",
        workspaceId: ids.workspaceAlpha,
        cadence: "daily",
        selectedToolNames: ["tasks.listVisible"]
      }
    });

    expect(missingWorkspaceResponse.statusCode).toBe(400);
    expect(createdResponse.statusCode).toBe(201);
    expect(
      createdResponse.json<{ definition: { workspaceId: string | null; visibility: string } }>()
        .definition
    ).toMatchObject({
      workspaceId: ids.workspaceAlpha,
      visibility: "workspace"
    });
  });

  it("generates deterministic summaries through declared read-only tools only", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Morning briefing",
        selectedToolNames: ["tasks.listVisible", "notes.listVisible", "email.listVisibleMessages"]
      })
    );
    const run = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual"
      })
    );
    const serialized = JSON.stringify(run);

    expect(run?.status).toBe("succeeded");
    expect(run?.summary_text).toContain("Tasks: 2 visible");
    expect(run?.summary_text).toContain("User A briefing task");
    expect(run?.summary_text).toContain("Notes: 1 visible");
    expect(run?.summary_text).toContain("User A briefing note");
    expect(run?.summary_text).toContain("Email: 1 visible");
    expect(run?.summary_text).toContain("User A briefing email");
    expect(serialized).not.toContain("User B private");
    expect(serialized).not.toContain("briefing-hidden-ciphertext");
    expect(serialized).not.toContain("encrypted_secret");
    expect(serialized).not.toContain("ciphertext");
  });

  it("rejects write tool names and does not mutate source modules or enqueue jobs", async () => {
    const jobsBefore = await countPgBossJobs();
    const response = await server.inject({
      method: "POST",
      url: "/api/briefings/definitions",
      headers: userAHeaders(),
      payload: {
        title: "Invalid write briefing",
        selectedToolNames: ["tasks.updateStatus"]
      }
    });
    const jobsAfter = await countPgBossJobs();
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      scopedDb.db
        .selectFrom("app.tasks")
        .select(["id", "status"])
        .where("id", "=", sourceIds.userATask)
        .executeTakeFirst()
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Briefings can only select declared read-risk assistant tools"
    });
    expect(task?.status).toBe("todo");
    expect(jobsAfter).toBe(jobsBefore);
  });

  it("queues run-now jobs with metadata-only payloads and worker-created RLS summaries", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Worker briefing",
        selectedToolNames: ["tasks.listVisible"]
      })
    );
    const resultPromise = handleNextBriefingJob(workerBoss);
    const response = await server.inject({
      method: "POST",
      url: `/api/briefings/definitions/${definition.id}/run`,
      headers: userAHeaders(),
      payload: {
        idempotencyKey: "briefing-worker-test"
      }
    });
    const responseBody = response.json<{ jobId: string; runId: string }>();
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
        [BRIEFINGS_RUN_QUEUE]
      );
      const payload = payloads.rows[0]?.data;

      expect(response.statusCode).toBe(202);
      expect(responseBody.jobId).toBeTruthy();
      expect(result).toMatchObject({
        definitionId: definition.id,
        runId: responseBody.runId,
        status: "succeeded"
      });
      expect(payload).toEqual({
        actorUserId: ids.userA,
        workspaceId: null,
        definitionId: definition.id,
        briefingRunId: responseBody.runId,
        runKind: "manual",
        idempotencyKey: "briefing-worker-test"
      });
      expect(isBriefingRunPayloadMetadataOnly(payload ?? {})).toBe(true);
      expect(JSON.stringify(payload)).not.toContain("User A briefing task");
      expect(JSON.stringify(payload)).not.toContain("summary");
      expect(JSON.stringify(payload)).not.toContain("prompt");
      expect(JSON.stringify(payload)).not.toContain("ciphertext");
    } finally {
      await client.end();
    }
  });

  it("does not let a User A worker job run User B's private briefing", async () => {
    const resultPromise = handleNextBriefingJob(workerBoss);

    await appBoss.send(BRIEFINGS_RUN_QUEUE, {
      actorUserId: ids.userA,
      workspaceId: null,
      definitionId: briefingIds.userBPrivate,
      briefingRunId: "7c000000-0000-4000-8000-000000000001",
      runKind: "manual",
      idempotencyKey: "briefing-denied-worker-test"
    } satisfies BriefingRunPayload);

    const result = await resultPromise;
    const userBPrivateRuns = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.listRuns(scopedDb, briefingIds.userBPrivate)
    );

    expect(result).toEqual({
      definitionId: briefingIds.userBPrivate,
      runId: "7c000000-0000-4000-8000-000000000001",
      status: null,
      created: false
    });
    expect(userBPrivateRuns).toEqual([]);
  });

  it("fails loudly when the Briefings repository is called without withDataContext", async () => {
    await expect(repository.listDefinitions({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(
      repository.generateRun({} as never, briefingIds.userBPrivate, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual"
      })
    ).rejects.toThrow("Repository access requires withDataContext");
  });
});

async function seedBriefingData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.tasks (id, owner_user_id, workspace_id, visibility, title, description, status)
        VALUES
          ($1, $2, null, 'private', 'User A briefing task', 'A task body', 'todo'),
          ($3, $4, null, 'private', 'User B private briefing task', 'B task body', 'todo'),
          ($5, $2, $6, 'workspace', 'User A workspace briefing task', 'Workspace task body', 'todo')
      `,
      [
        sourceIds.userATask,
        ids.userA,
        sourceIds.userBPrivateTask,
        ids.userB,
        sourceIds.userAWorkspaceTask,
        ids.workspaceAlpha
      ]
    );
    await client.query(
      `
        INSERT INTO app.notes (id, owner_user_id, workspace_id, visibility, title, body)
        VALUES
          ($1, $2, null, 'private', 'User A briefing note', 'A note body'),
          ($3, $4, null, 'private', 'User B private briefing note', 'B note body')
      `,
      [sourceIds.userANote, ids.userA, sourceIds.userBPrivateNote, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.connector_accounts (
          id,
          provider_id,
          owner_user_id,
          scopes,
          status,
          encrypted_secret
        )
        VALUES
          ($1, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'active', '{"ciphertext":"briefing-hidden-ciphertext"}'::jsonb),
          ($3, 'google-email', $4, ARRAY['gmail.readonly']::text[], 'active', '{"ciphertext":"briefing-hidden-ciphertext"}'::jsonb)
      `,
      [sourceIds.userAConnector, ids.userA, sourceIds.userBConnector, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.email_messages (
          id,
          connector_account_id,
          owner_user_id,
          workspace_id,
          visibility,
          sender,
          recipients,
          subject,
          snippet,
          body_excerpt,
          received_at,
          external_id,
          external_metadata
        )
        VALUES
          ($1, $2, $3, null, 'private', 'sender-a@example.test', ARRAY['user-a@example.test']::text[], 'User A briefing email', 'A email snippet', 'A email excerpt', '2026-06-06T15:00:00.000Z', 'briefing-email-a', '{"source":"briefings-test"}'::jsonb),
          ($4, $5, $6, null, 'private', 'sender-b@example.test', ARRAY['user-b@example.test']::text[], 'User B private briefing email', 'B email snippet', 'B email excerpt', '2026-06-06T16:00:00.000Z', 'briefing-email-b', '{"source":"briefings-test"}'::jsonb)
      `,
      [
        sourceIds.userAEmail,
        sourceIds.userAConnector,
        ids.userA,
        sourceIds.userBPrivateEmail,
        sourceIds.userBConnector,
        ids.userB
      ]
    );
    await client.query(
      `
        INSERT INTO app.briefing_definitions (
          id,
          owner_user_id,
          workspace_id,
          visibility,
          title,
          cadence,
          selected_tool_names
        )
        VALUES
          ($1, $2, null, 'private', 'User B private briefing', 'manual', ARRAY['tasks.listVisible']::text[]),
          ($3, $2, $4, 'workspace', 'User B workspace briefing', 'daily', ARRAY['tasks.listVisible']::text[])
      `,
      [briefingIds.userBPrivate, ids.userB, briefingIds.userBWorkspace, ids.workspaceAlpha]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function handleNextBriefingJob(workerBoss: PgBoss): Promise<BriefingRunResult> {
  const scopedWorkerDb = createDatabase({
    connectionString: connectionStrings.worker,
    maxConnections: 1
  });
  const workerDataContext = new DataContextRunner(scopedWorkerDb);
  let workIds: string[] = [];

  try {
    const resultPromise = new Promise<BriefingRunResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for Briefings worker"));
      }, 10_000);

      registerBriefingsJobWorkers(workerBoss, workerDataContext, {
        moduleManifests: getBuiltInModuleManifests(),
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
      workIds.map((workId) => workerBoss.offWork(BRIEFINGS_RUN_QUEUE, { id: workId, wait: true }))
    );
    await scopedWorkerDb.destroy();
  }
}

async function countPgBossJobs(): Promise<number> {
  const client = new Client({ connectionString: connectionStrings.migration });

  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM pgboss.job"
    );

    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

function userAHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionA}`
  };
}

function userAWorkspaceHeaders(): Record<string, string> {
  return {
    ...userAHeaders(),
    "x-jarvis-workspace-id": ids.workspaceAlpha
  };
}

function userAContext(workspaceId?: string | null): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId,
    requestId: "request:user-a-briefings"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    workspaceId: null,
    requestId: "request:user-b-briefings"
  };
}
