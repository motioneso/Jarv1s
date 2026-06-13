import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import type { ComposeDeps, GenerateChatFn } from "@jarv1s/briefings";
import {
  BRIEFINGS_RUN_QUEUE,
  BriefingsRepository,
  briefingsModuleManifest,
  isBriefingRunPayloadMetadataOnly,
  reconcileSchedule,
  registerBriefingsJobWorkers,
  type BriefingRunPayload,
  type BriefingRunResult
} from "@jarv1s/briefings";
import type { MemoryRetriever } from "@jarv1s/memory";
import {
  AuthSessionResolver,
  DataContextRunner,
  SharesRepository,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import { NotificationsRepository } from "@jarv1s/notifications";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
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
  let notificationsRepository: NotificationsRepository;
  let sharesRepository: SharesRepository;
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
    notificationsRepository = new NotificationsRepository();
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
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "structured-state"
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
    expect(getBuiltInSqlMigrationDirectories().at(-1)).toContain("packages/structured-state/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-2)).toContain("packages/memory/sql");
    expect(getBuiltInSqlMigrationDirectories().at(-3)).toContain("packages/briefings/sql");
  });

  it("keeps definitions private by default and denies admin private-data bypass", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "User A private briefing",
        selectedToolNames: ["tasks.list"]
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
    expect(userARead?.id).toBe(created.id);
    expect(userBRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("share grantee can see definition and its runs; non-grantee cannot", async () => {
    // Use userBWorkspace definition to avoid polluting the worker-isolation test below
    // userA cannot see userB's workspace definition or its runs before share grant
    const defBeforeShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getDefinitionById(scopedDb, briefingIds.userBWorkspace)
    );
    expect(defBeforeShare).toBeUndefined();

    // Create a run for userB's workspace briefing as owner
    const outcome = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.generateRun(scopedDb, briefingIds.userBWorkspace, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps()
      })
    );
    const run = outcome?.run;

    const runsBeforeShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, briefingIds.userBWorkspace)
    );
    expect(runsBeforeShare).toEqual([]);

    // userB grants userA 'view' access to the definition
    await dataContext.withDataContext(userBContext(), (scopedDb) =>
      sharesRepository.grant(scopedDb, {
        resourceType: "briefing_definition",
        resourceId: briefingIds.userBWorkspace,
        ownerUserId: ids.userB,
        granteeUserId: ids.userA,
        level: "view"
      })
    );

    // userA can now see the definition and its run via share
    const defAfterShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getDefinitionById(scopedDb, briefingIds.userBWorkspace)
    );
    const runsAfterShare = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, briefingIds.userBWorkspace)
    );
    expect(defAfterShare?.id).toBe(briefingIds.userBWorkspace);
    expect(runsAfterShare.some((r) => r.id === run?.id)).toBe(true);
  });

  it("synthesizes a run through declared read-only tools and leaks no source secrets", async () => {
    // Configure an economy model so compose takes the synthesis path (not the degraded
    // fallback). The injected fake adapter returns the fixed "synth narrative".
    const aiRepository = new AiRepository();
    const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Synthesis summarizer",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "briefing-synth-key" })
      })
    );
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: provider.id,
        providerModelId: "synth-summarizer",
        displayName: "Synthesis Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );

    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Morning briefing",
        selectedToolNames: ["tasks.list", "email.listVisibleMessages"]
      })
    );
    const outcome = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const run = outcome?.run;
    const serialized = JSON.stringify(run);
    const meta = run?.source_metadata as {
      degraded: boolean;
      taskCount: number;
      emailCount: number;
    };

    expect(outcome?.created).toBe(true);
    expect(run?.status).toBe("succeeded");
    expect(run?.summary_text).toBe("synth narrative");
    expect(meta.degraded).toBe(false);
    expect(meta.taskCount).toBeGreaterThanOrEqual(1);
    expect(typeof meta.emailCount).toBe("number");
    // RLS + provenance: no other user's private rows and no connector ciphertext leak.
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
        selectedToolNames: ["tasks.list"]
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

  it("dedupes concurrent run-now submits sharing an idempotency key (#150)", async () => {
    // A double-submit (retry / double-click) before the worker consumes must
    // collapse to ONE queued job. pg-boss returns null on the singletonKey
    // collision; the route surfaces that as 409 (already queued), not a 500.
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Idempotency briefing",
        selectedToolNames: ["tasks.list"]
      })
    );
    const idempotencyKey = "briefing-idempotency-dedupe-test";

    const first = await server.inject({
      method: "POST",
      url: `/api/briefings/definitions/${definition.id}/run`,
      headers: userAHeaders(),
      payload: { idempotencyKey }
    });
    const second = await server.inject({
      method: "POST",
      url: `/api/briefings/definitions/${definition.id}/run`,
      headers: userAHeaders(),
      payload: { idempotencyKey }
    });

    expect(first.statusCode).toBe(202);
    expect(first.json<{ jobId: string }>().jobId).toBeTruthy();
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: "A briefing run with this idempotency key is already queued or running"
    });

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const counted = await client.query<{ count: string }>(
        `
          SELECT count(*) AS count
          FROM pgboss.job_common
          WHERE name = $1 AND data->>'idempotencyKey' = $2
        `,
        [BRIEFINGS_RUN_QUEUE, idempotencyKey]
      );
      expect(counted.rows[0]?.count).toBe("1");
    } finally {
      await client.end();
    }

    // Drain the single queued job so it can't leak into later worker assertions.
    await handleNextBriefingJob(workerBoss);
  });

  it("reconciles the pg-boss schedule on create (daily enabled → boss.schedule keyed by id)", async () => {
    const calls = spyBossSchedule(appBoss);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/briefings/definitions",
        headers: userAHeaders(),
        payload: {
          title: "Scheduled morning briefing",
          cadence: "daily",
          scheduleMetadata: { targetTime: "06:00", timezone: "America/New_York" },
          enabled: true,
          selectedToolNames: ["tasks.list"]
        }
      });

      expect(response.statusCode).toBe(201);
      const definition = response.json<{ definition: { id: string } }>().definition;
      expect(calls.unschedule).toHaveLength(0);
      const scheduled = calls.schedule.filter((c) => c.key === definition.id);
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]).toMatchObject({
        name: BRIEFINGS_RUN_QUEUE,
        cron: "0 6 * * *",
        tz: "America/New_York",
        key: definition.id,
        data: {
          actorUserId: ids.userA,
          definitionId: definition.id,
          runKind: "scheduled"
        }
      });
    } finally {
      calls.restore();
    }
  });

  it("reconciles the pg-boss schedule on update to enabled:false (→ boss.unschedule)", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Toggle-off briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "07:30", timezone: "UTC" },
        enabled: true,
        selectedToolNames: ["tasks.list"]
      })
    );

    const calls = spyBossSchedule(appBoss);
    try {
      const response = await server.inject({
        method: "PATCH",
        url: `/api/briefings/definitions/${definition.id}`,
        headers: userAHeaders(),
        payload: { enabled: false }
      });

      expect(response.statusCode).toBe(200);
      expect(calls.schedule).toHaveLength(0);
      expect(calls.unschedule).toEqual([{ name: BRIEFINGS_RUN_QUEUE, key: definition.id }]);
    } finally {
      calls.restore();
    }
  });

  it("does not fail the create request when schedule reconcile throws (failure-isolated)", async () => {
    const originalSchedule = appBoss.schedule.bind(appBoss);
    appBoss.schedule = (async () => {
      throw new Error("pg-boss schedule unavailable");
    }) as typeof appBoss.schedule;
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/briefings/definitions",
        headers: userAHeaders(),
        payload: {
          title: "Reconcile-failure briefing",
          cadence: "daily",
          scheduleMetadata: { targetTime: "08:00", timezone: "UTC" },
          enabled: true,
          selectedToolNames: ["tasks.list"]
        }
      });

      // The mutation succeeded even though reconcile threw — reconcile is best-effort.
      expect(response.statusCode).toBe(201);
      expect(response.json<{ definition: { id: string } }>().definition.id).toBeTruthy();
    } finally {
      appBoss.schedule = originalSchedule;
    }
  });

  it("self-heals the owner's schedules on GET list and stays 200 even when reconcile throws", async () => {
    // Ensure at least one enabled daily definition owned by user A exists so the
    // best-effort self-heal has something to reconcile.
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Self-heal target",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:15", timezone: "UTC" },
        enabled: true,
        selectedToolNames: ["tasks.list"]
      })
    );

    const calls = spyBossSchedule(appBoss);
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/briefings/definitions",
        headers: userAHeaders()
      });

      expect(response.statusCode).toBe(200);
      // List response shape is unchanged.
      const body = response.json<{ definitions: Array<{ id: string }> }>();
      expect(Array.isArray(body.definitions)).toBe(true);

      // The self-heal is fire-and-forget; give the microtask/IO a tick to land.
      await new Promise((resolve) => setTimeout(resolve, 50));
      // At least one enabled daily definition owned by user A was (re)scheduled.
      expect(calls.schedule.length).toBeGreaterThanOrEqual(1);
    } finally {
      calls.restore();
    }
  });

  it("keeps distinct per-definition schedule rows under the exclusive run queue (F12)", async () => {
    // Two DIFFERENT enabled daily definitions owned by user A. The BRIEFINGS_RUN_QUEUE
    // policy is `exclusive` (NULL singletonKeys collapse to one job), but pg-boss
    // SCHEDULES are keyed independently — pgboss.schedule is PRIMARY KEY (name, key),
    // and reconcileSchedule keys on definition.id — so both must co-exist.
    const defA = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Schedule rows A",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "America/New_York" },
        enabled: true,
        selectedToolNames: ["tasks.list"]
      })
    );
    const defB = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Schedule rows B",
        cadence: "daily",
        scheduleMetadata: { targetTime: "07:30", timezone: "UTC" },
        enabled: true,
        selectedToolNames: ["tasks.list"]
      })
    );

    // Build a REAL cron-enabled boss (the worker's mode) so boss.schedule writes
    // actual pgboss.schedule rows — not a spy.
    const scheduleBoss = createPgBossClient(connectionStrings.worker, { schedule: true });
    await scheduleBoss.start();
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      await reconcileSchedule(scheduleBoss, defA);
      await reconcileSchedule(scheduleBoss, defB);

      const bothRows = await client.query<{ name: string; key: string }>(
        `SELECT name, key FROM pgboss.schedule WHERE name = $1 AND key = ANY($2::text[]) ORDER BY key`,
        [BRIEFINGS_RUN_QUEUE, [defA.id, defB.id]]
      );
      const keys = bothRows.rows.map((r) => r.key).sort();
      expect(keys).toEqual([defA.id, defB.id].sort());

      // Disabling one definition removes ONLY its schedule row (the other survives).
      await reconcileSchedule(scheduleBoss, { ...defA, enabled: false });
      const afterDisable = await client.query<{ key: string }>(
        `SELECT key FROM pgboss.schedule WHERE name = $1 AND key = ANY($2::text[])`,
        [BRIEFINGS_RUN_QUEUE, [defA.id, defB.id]]
      );
      const remaining = afterDisable.rows.map((r) => r.key);
      expect(remaining).toEqual([defB.id]);
    } finally {
      await client.end();
      // Clean up B's surviving schedule so it can't fire into later worker assertions.
      await reconcileSchedule(scheduleBoss, { ...defB, enabled: false });
      await scheduleBoss.stop({ graceful: false });
    }
  });

  it("does not let a User A worker job run User B's private briefing", async () => {
    const resultPromise = handleNextBriefingJob(workerBoss);

    // Keyless send is safe here only because this is the sole keyless enqueue against
    // the exclusive run queue in this suite — under `exclusive` policy all NULL
    // singletonKeys collapse to one job (COALESCE(singleton_key,'')), so any second
    // keyless send would dedupe against this one. Add an explicit singletonKey if a
    // future test enqueues another keyless run-now job here.
    await appBoss.send(BRIEFINGS_RUN_QUEUE, {
      actorUserId: ids.userA,
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
        runKind: "manual",
        composeDeps: makeComposeDeps()
      })
    ).rejects.toThrow("Repository access requires withDataContext");
  });

  it("records economy-tier AI model in source_metadata when configured", async () => {
    const aiRepository = new AiRepository();
    const providerRow = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Economy summarizer",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "briefing-econ-key" })
      })
    );
    const modelRow = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: providerRow.id,
        providerModelId: "econ-summarizer",
        displayName: "Economy Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );

    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Economy tier briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const outcome = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const run = outcome?.run;

    expect(run?.status).toBe("succeeded");
    const meta = run?.source_metadata as {
      aiModel: { id: string; tier: string } | null;
      degraded: boolean;
    };
    expect(meta.degraded).toBe(false);
    expect(meta.aiModel).not.toBeNull();
    expect(meta.aiModel?.id).toBe(modelRow.id);
    expect(meta.aiModel?.tier).toBe("economy");
  });

  it("briefing tool execute receives a non-empty actorUserId and requestId in ToolContext", async () => {
    // compose gathers from a FIXED set of read tools (commitments/tasks/calendar/email/
    // chats). To assert the ToolContext compose passes to a tool's execute, supply ONLY a
    // capturing manifest that owns one of those names — so it is the sole match compose
    // finds and executes exactly once.
    const capturedContexts: { actorUserId: string; requestId: string }[] = [];
    const capturingManifest: JarvisModuleManifest = {
      id: "ctx-check",
      name: "CtxCheck",
      version: "0.0.0",
      publisher: "test",
      lifecycle: "optional",
      compatibility: { jarv1s: "*" },
      assistantTools: [
        {
          name: "commitments.listVisible",
          description: "Captures ToolContext for assertion.",
          permissionId: "commitments.view",
          risk: "read" as const,
          execute: async (_db, _input, ctx) => {
            capturedContexts.push({ actorUserId: ctx.actorUserId, requestId: ctx.requestId });
            return { data: { commitments: [] } };
          }
        }
      ]
    };

    const def = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:briefing-ctx-test" },
      (scopedDb) =>
        repository.createDefinition(scopedDb, {
          title: "ToolContext check",
          selectedToolNames: ["commitments.listVisible"]
        })
    );

    const outcome = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "r:briefing-ctx-run" },
      (scopedDb) =>
        repository.generateRun(scopedDb, def.id, {
          moduleManifests: [capturingManifest],
          runKind: "manual",
          composeDeps: makeComposeDeps(undefined, [capturingManifest])
          // omit runId — let repository generate a UUID
        })
    );

    expect(outcome?.run).toBeDefined();
    expect(capturedContexts).toHaveLength(1);
    expect(capturedContexts[0]!.actorUserId).toBe(ids.userA);
    expect(capturedContexts[0]!.requestId).not.toBe("");
    expect(capturedContexts[0]!.requestId).toMatch(/^briefing:|^pgboss:/);
  });

  it("falls back deterministically (degraded, status succeeded) when no model is configured", async () => {
    // No AI model configured for this fresh definition's owner → compose takes the
    // deterministic degraded fallback. Status stays "succeeded" (there is no
    // "degraded" enum value — degraded is a source_metadata boolean).
    const definition = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Degraded briefing",
        selectedToolNames: ["tasks.list"]
      })
    );
    const outcome = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        composeDeps: makeComposeDeps(async () => {
          throw new Error("synthesis must not be called when there is no model");
        })
      })
    );
    const run = outcome?.run;
    const meta = run?.source_metadata as {
      degraded: boolean;
      degradedReason: string;
      aiModel: unknown;
    };

    expect(run?.status).toBe("succeeded");
    expect(meta.degraded).toBe(true);
    expect(meta.degradedReason).toBe("no_model");
    expect(meta.aiModel).toBeNull();
  });

  it("never leaks the decrypted provider credential into a synthesized run", async () => {
    const aiRepository = new AiRepository();
    const provider = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      aiRepository.createProvider(scopedDb, {
        providerKind: "anthropic",
        displayName: "Secret summarizer",
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "sk-SECRET-123" })
      })
    );
    await dataContext.withDataContext(userBContext(), (scopedDb) =>
      aiRepository.createModel(scopedDb, {
        providerConfigId: provider.id,
        providerModelId: "secret-summarizer",
        displayName: "Secret Summarizer",
        capabilities: ["summarization"],
        tier: "economy"
      })
    );
    const definition = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Secrets briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const outcome = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "manual",
        // The fake adapter echoing the secret would be the worst case; prove the secret
        // never reaches summary_text or source_metadata regardless of synthesis output.
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const run = outcome?.run;

    expect(run?.status).toBe("succeeded");
    expect(run?.summary_text ?? "").not.toContain("sk-SECRET-123");
    expect(JSON.stringify(run?.source_metadata)).not.toContain("sk-SECRET-123");
  });

  it("is idempotent for scheduled runs on the same local day", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled idempotency briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const first = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "scheduled",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );
    const second = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.generateRun(scopedDb, definition.id, {
        moduleManifests: getBuiltInModuleManifests(),
        runKind: "scheduled",
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" }))
      })
    );

    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    expect(second?.run.id).toBe(first?.run.id);

    const runs = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, definition.id)
    );
    expect(runs.filter((r) => r.run_kind === "scheduled")).toHaveLength(1);
  });

  it("scheduled worker job without a briefingRunId mints one, persists the run, and notifies the owner", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled notify briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const resultPromise = handleNextBriefingJobWithNotifications(workerBoss);
    // A scheduled cron fire carries NO briefingRunId — pure metadata only. In production
    // the cron schedule keys the job by definition id (reconcileSchedule), so give this
    // direct send a unique singletonKey so the `exclusive` queue actually enqueues it
    // (a keyless send would collapse onto another keyless job under `exclusive`).
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:sched:1` }
    );
    const result = await resultPromise;

    expect(result.status).toBe("succeeded");
    expect(result.created).toBe(true);
    // The worker minted a run id even though the payload carried none.
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);

    const runs = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listRuns(scopedDb, definition.id)
    );
    expect(runs.filter((r) => r.run_kind === "scheduled")).toHaveLength(1);
    expect(runs[0]?.id).toBe(result.runId);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    const briefingNotifications = notifications.filter(
      (n) => n.title === "Your morning briefing is ready"
    );
    expect(briefingNotifications).toHaveLength(1);
    const notification = briefingNotifications[0]!;
    expect(notification.recipient_user_id).toBe(ids.userA);
    // Metadata-only: definition + run ids, never briefing content.
    expect(notification.metadata).toEqual({
      definitionId: definition.id,
      briefingRunId: result.runId
    });
    expect(notification.body).toBeNull();
  });

  it("manual worker job does not create a briefing-ready notification", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Manual no-notify briefing",
        selectedToolNames: ["tasks.list"]
      })
    );

    const resultPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        briefingRunId: "7d000000-0000-4000-8000-000000000001",
        runKind: "manual",
        idempotencyKey: "briefing-manual-no-notify"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:key:briefing-manual-no-notify` }
    );
    const result = await resultPromise;

    expect(result.status).toBe("succeeded");
    expect(result.created).toBe(true);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    expect(
      notifications.filter(
        (n) =>
          n.title === "Your morning briefing is ready" &&
          (n.metadata as { briefingRunId?: string }).briefingRunId ===
            "7d000000-0000-4000-8000-000000000001"
      )
    ).toHaveLength(0);
  });

  it("does not re-notify on an idempotent same-day scheduled re-fire (exactly one notification)", async () => {
    const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createDefinition(scopedDb, {
        title: "Scheduled dedupe-notify briefing",
        cadence: "daily",
        scheduleMetadata: { targetTime: "06:00", timezone: "UTC" },
        selectedToolNames: ["tasks.list"]
      })
    );

    const firstPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      // Distinct singletonKeys so BOTH fires enqueue and reach the worker — the dedupe
      // under test is the repository's local-day idempotency, NOT pg-boss singleton.
      { singletonKey: `${definition.id}:sched:dedupe:1` }
    );
    const first = await firstPromise;
    expect(first.created).toBe(true);

    const secondPromise = handleNextBriefingJobWithNotifications(workerBoss);
    await appBoss.send(
      BRIEFINGS_RUN_QUEUE,
      {
        actorUserId: ids.userA,
        definitionId: definition.id,
        runKind: "scheduled"
      } satisfies BriefingRunPayload,
      { singletonKey: `${definition.id}:sched:dedupe:2` }
    );
    const second = await secondPromise;
    // The second fire is an idempotent same-local-day skip.
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);

    const { notifications } = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      notificationsRepository.listVisible(scopedDb)
    );
    expect(
      notifications.filter(
        (n) =>
          n.title === "Your morning briefing is ready" &&
          (n.metadata as { definitionId?: string }).definitionId === definition.id
      )
    ).toHaveLength(1);
  });
});

// Build synthesis deps for generateRun in these integration tests. The AI repository
// and cipher are REAL (so economy-tier model selection + in-worker credential
// decryption run against the real DB), the vault retriever is a no-op (vault grounding
// is exercised in the compose unit tests), and the adapter is injected so no real HTTP
// provider is contacted — the fake `generateChat` returns a fixed narrative by default.
function makeComposeDeps(
  generateChat?: GenerateChatFn,
  moduleManifests: readonly JarvisModuleManifest[] = getBuiltInModuleManifests()
): ComposeDeps {
  const noopRetriever = {
    async retrieve() {
      return [];
    },
    async retrieveRecent() {
      return [];
    }
  } as unknown as MemoryRetriever;

  return {
    moduleManifests,
    aiRepository: new AiRepository(),
    cipher: createAiSecretCipher(),
    memoryRetriever: noopRetriever,
    createAdapter: () => ({
      generateChat: generateChat ?? (async () => ({ text: "synth narrative" }))
    })
  };
}

async function seedBriefingData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
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
          ($1, $2, 'User A briefing task', 'A task body', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $2 AND name = 'Personal' LIMIT 1)),
          ($3, $4, 'User B private briefing task', 'B task body', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $4 AND name = 'Personal' LIMIT 1)),
          ($5, $2, 'User A workspace briefing task', 'Workspace task body', 'todo',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $2 AND name = 'Personal' LIMIT 1))
      `,
      [
        sourceIds.userATask,
        ids.userA,
        sourceIds.userBPrivateTask,
        ids.userB,
        sourceIds.userAWorkspaceTask
      ]
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
          ($1, $2, $3, 'sender-a@example.test', ARRAY['user-a@example.test']::text[], 'User A briefing email', 'A email snippet', 'A email excerpt', '2026-06-06T15:00:00.000Z', 'briefing-email-a', '{"source":"briefings-test"}'::jsonb),
          ($4, $5, $6, 'sender-b@example.test', ARRAY['user-b@example.test']::text[], 'User B private briefing email', 'B email snippet', 'B email excerpt', '2026-06-06T16:00:00.000Z', 'briefing-email-b', '{"source":"briefings-test"}'::jsonb)
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
          title,
          cadence,
          selected_tool_names
        )
        VALUES
          ($1, $2, 'User B private briefing', 'manual', ARRAY['tasks.list']::text[]),
          ($3, $2, 'User B workspace briefing', 'daily', ARRAY['tasks.list']::text[])
      `,
      [briefingIds.userBPrivate, ids.userB, briefingIds.userBWorkspace]
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
        // Inject a fake-adapter composeDeps so the worker path is deterministic and never
        // makes a real HTTP provider call (A8 injects the registry-built deps in prod).
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" })),
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

// Same as handleNextBriefingJob, but injects a REAL NotificationsRepository bound to a
// fresh worker-role data context so the A8 notification path runs end-to-end through the
// worker INSERT grant (migration 0071) — proving the worker can actually deliver the
// "Your morning briefing is ready" notification.
async function handleNextBriefingJobWithNotifications(
  workerBoss: PgBoss
): Promise<BriefingRunResult> {
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
        composeDeps: makeComposeDeps(async () => ({ text: "synth narrative" })),
        notificationsRepository: new NotificationsRepository(),
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

interface CapturedScheduleCall {
  readonly name: string;
  readonly cron: string;
  readonly data: Record<string, unknown>;
  readonly tz?: string;
  readonly key?: string;
}

interface CapturedUnscheduleCall {
  readonly name: string;
  readonly key: string;
}

/**
 * Wrap the real pg-boss instance's schedule/unschedule so a route test can assert
 * the route reconciled the schedule, while STILL exercising the real boss (the calls
 * pass through to pg-boss). Returns captured calls + a restore().
 */
function spyBossSchedule(boss: PgBoss): {
  schedule: CapturedScheduleCall[];
  unschedule: CapturedUnscheduleCall[];
  restore: () => void;
} {
  const schedule: CapturedScheduleCall[] = [];
  const unschedule: CapturedUnscheduleCall[] = [];
  const originalSchedule = boss.schedule.bind(boss);
  const originalUnschedule = boss.unschedule.bind(boss);

  boss.schedule = (async (name: string, cron: string, data?: object, options?: object) => {
    schedule.push({
      name,
      cron,
      data: (data ?? {}) as Record<string, unknown>,
      tz: (options as { tz?: string } | undefined)?.tz,
      key: (options as { key?: string } | undefined)?.key
    });
    return originalSchedule(name, cron, data as never, options as never);
  }) as typeof boss.schedule;

  boss.unschedule = (async (name: string, key: string) => {
    unschedule.push({ name, key });
    return originalUnschedule(name, key);
  }) as typeof boss.unschedule;

  return {
    schedule,
    unschedule,
    restore: () => {
      boss.schedule = originalSchedule;
      boss.unschedule = originalUnschedule;
    }
  };
}

function userAHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionA}`
  };
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-briefings"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-briefings"
  };
}
