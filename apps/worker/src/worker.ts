import type { ConstructorOptions, PgBoss } from "pg-boss";
import { pino, type Logger as PinoLogger } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { sql } from "kysely";

import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { RlsProbeRepository } from "@jarv1s/db/probes";
import {
  RLS_PROBE_QUEUE,
  UPGRADE_CHECK_QUEUE,
  createPgBossClient,
  registerDataContextWorker,
  reconcileUpgradeCheckSchedule,
  handleUpgradeCheckJob,
  registerUpgradeNotifyWorker,
  assertModuleControlPayload,
  PLATFORM_MODULE_CONTROL_QUEUE,
  type ExternalModuleJobPayload,
  type ModuleControlPayload,
  type RlsProbeJobPayload
} from "@jarv1s/jobs";
import {
  aggregateFocusSignals,
  createActiveModulesResolver,
  createNotificationPreferencePort,
  focusSignalProvidersFor,
  getAllQueueDefinitions,
  getBuiltInModuleManifests,
  registerBuiltInModuleWorkers
} from "@jarv1s/module-registry";
import {
  ExternalModuleJobReconciler,
  ExternalModuleWorkerRuntime,
  getExternalModuleRegistrations,
  resolveModulesDir
} from "@jarv1s/module-registry/node";
import { AiRepository } from "@jarv1s/ai";
import { NotificationsRepository } from "@jarv1s/notifications";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";

import { createModuleWorkerAiBridge } from "./external-module-ai-bridge.js";
import { createExternalModuleJobHandler } from "./external-module-job-handler.js";

// ---------------------------------------------------------------------------
// Bounded graceful-shutdown timeout (ms). On SIGINT/SIGTERM the worker waits
// up to this long for in-flight jobs to drain before destroying the DB pool.
// The crash path keeps its own 2s race — this value is for the clean path.
// ---------------------------------------------------------------------------
const GRACEFUL_STOP_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// One-background-engine-owner invariant (F14, #650)
//
// pg-boss's per-definition cron engine and active-job supervisor must run in
// EXACTLY ONE process. The worker is that process: it constructs its boss with
// `{ schedule: true, supervise: true }`. The API process (apps/api/src/server.ts)
// passes no override, so it keeps the shared `createPgBossClient` defaults and
// never starts a second background engine. Exported so this invariant is
// unit-testable at the worker call site (tests/unit/worker-schedule-mode.test.ts).
// ---------------------------------------------------------------------------
export const WORKER_BOSS_OPTIONS: Partial<ConstructorOptions> = {
  schedule: true,
  supervise: true
};

/**
 * Emit a single structured startup line making the cron owner observable in logs.
 * Exported so the assertion ("who owns cron") does not depend on spawning the
 * worker binary.
 */
export function logScheduleMode(): void {
  console.log(JSON.stringify({ event: "pgboss.schedule_mode", schedule: true }));
}

export interface WorkerHandle {
  readonly boss: PgBoss;
  shutdown(): Promise<void>;
}

export function resolveExternalWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): { readonly modulesDir: string } {
  return { modulesDir: resolveModulesDir(env) };
}

/**
 * Build and wire the worker.
 *
 * Extracted from the module-level bootstrap so the lifecycle (boss.start →
 * queue-existence guard → worker registration → boss.stop → db.destroy) can
 * be unit-tested without spawning the real binary entry point.
 *
 * Exported for tests; the module-level IIFE below is the production entry point
 * and keeps the same observable behaviour.
 */
export async function buildWorker(deps?: { connectionString?: string }): Promise<WorkerHandle> {
  const urls = getJarvisDatabaseUrls();
  const connectionString = deps?.connectionString ?? urls.worker;

  // Structured logger for worker-path module diagnostics (#413). Threaded into
  // each module's worker registration so no `console.*` lands in production
  // worker logs; module-tagged children are created by the registry. Level honors
  // LOG_LEVEL (pino default is "info"). Suppressed in unit tests via LOG_LEVEL.
  const workerLogger: PinoLogger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { process: "worker" }
  });

  const workerDb = createDatabase({
    connectionString,
    maxConnections: Number(process.env.JARVIS_WORKER_DB_POOL_SIZE ?? 4)
  });
  const dataContext = new DataContextRunner(workerDb);
  const repository = new RlsProbeRepository();
  // The worker is the SOLE pg-boss cron + supervisor owner (F14, #650): enable
  // schedule and supervise here and ONLY here, so scheduled jobs fire once and
  // expired active jobs are reaped by one long-running process. The API process
  // keeps the shared `createPgBossClient` defaults. WORKER_BOSS_OPTIONS +
  // logScheduleMode make the ownership invariant unit-testable + observable.
  const boss = createPgBossClient(connectionString, WORKER_BOSS_OPTIONS);
  let externalReconciler: ExternalModuleJobReconciler | undefined;
  let externalRuntime: ExternalModuleWorkerRuntime | undefined;
  const resolveActiveModules = createActiveModulesResolver({
    dataContext,
    manifests: getBuiltInModuleManifests()
  });
  logScheduleMode();

  await boss.start();

  // -------------------------------------------------------------------------
  // Startup queue-existence guard (#165 MED)
  //
  // pg-boss queues are created by `pnpm db:migrate` (migratePgBoss). If the
  // schema is ahead of the worker binary (e.g. fresh database without a
  // migration run) some queues may be absent, causing jobs to pile up
  // silently. Fail fast so the operator can run `pnpm db:migrate` first.
  // -------------------------------------------------------------------------
  const expectedQueues = getAllQueueDefinitions().map((q) => q.name);
  const missingQueues: string[] = [];
  for (const queueName of expectedQueues) {
    const existing = await boss.getQueue(queueName);
    if (!existing) {
      missingQueues.push(queueName);
    }
  }
  if (missingQueues.length > 0) {
    await boss.stop({ graceful: false });
    await workerDb.destroy();
    throw new Error(
      `Worker startup failed — the following pg-boss queues do not exist: ` +
        `${missingQueues.join(", ")}. ` +
        `Run \`pnpm db:migrate\` to create them before starting the worker.`
    );
  }

  await registerDataContextWorker<RlsProbeJobPayload, { targetItemVisible: boolean }>(
    boss,
    RLS_PROBE_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const item = await repository.getById(scopedDb, job.data.targetItemId);

      return {
        targetItemVisible: item !== undefined
      };
    }
  );

  await reconcileUpgradeCheckSchedule(boss);
  await boss.work(UPGRADE_CHECK_QUEUE, async () => {
    await handleUpgradeCheckJob(workerDb, boss);
  });
  await registerUpgradeNotifyWorker(boss, dataContext, {
    logger: workerLogger,
    repository: new NotificationsRepository(undefined, createNotificationPreferencePort())
  });

  await registerBuiltInModuleWorkers(boss, {
    rootDb: workerDb,
    dataContext,
    focusSignals: async (ctx) => {
      const providers = focusSignalProvidersFor(await resolveActiveModules(ctx.actorUserId));
      if (providers.length === 0) return [];
      return aggregateFocusSignals(
        providers,
        (work) =>
          dataContext.withDataContext(
            { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
            (scopedDb) => work(scopedDb)
          ),
        ctx,
        {
          onProviderError: (moduleId, errorName) =>
            workerLogger.warn({ moduleId, errorName }, "focus-signal provider failed (soft)")
        }
      );
    },
    // Pino's Logger is structurally what FastifyBaseLogger wraps at runtime
    // (Fastify uses pino internally). The cast bridges the nominal type gap.
    logger: workerLogger as unknown as FastifyBaseLogger
  });

  // #996/#860: external-module job reconciliation is always-on now (the
  // JARVIS_ENABLE_EXTERNAL_MODULES gate was removed) — resolveExternalWorkerConfig
  // always resolves a modulesDir, so this block runs unconditionally.
  const externalConfig = resolveExternalWorkerConfig();
  const reservedQueueNames = new Set(getAllQueueDefinitions().map((queue) => queue.name));
  const discoveries = getExternalModuleRegistrations({
    modulesDir: externalConfig.modulesDir,
    reservedQueueNames
  }).discoveries;
  externalRuntime = new ExternalModuleWorkerRuntime({ logger: workerLogger });
  const runtime = externalRuntime;
  const cipher = createModuleCredentialSecretCipher();
  // ctx.ai for queued module jobs (JS-07 Step 0, spec D6): one repository and
  // one bridge at composition time — the bridge's AiSecretCipher is a separate
  // key domain (JARVIS_AI_SECRET_KEY) from the ModuleCredentialCipher above.
  // Only the module-job registration below receives it; every other handler
  // path stays without an ai dep and fails closed in the rpc host.
  const moduleAiBridge = createModuleWorkerAiBridge({
    aiRepository: new AiRepository(),
    logger: workerLogger as unknown as FastifyBaseLogger
  });
  const discoveryById = new Map(discoveries.map((module) => [module.id, module]));
  const listActiveUserIds = async (moduleId: string): Promise<readonly string[]> =>
    (
      await sql<{
        user_id: string;
      }>`SELECT user_id FROM app.list_active_external_module_users(${moduleId})`.execute(workerDb)
    ).rows.map((row) => row.user_id);

  externalReconciler = new ExternalModuleJobReconciler({
    boss,
    discoveries: () => discoveries,
    reservedQueueNames,
    isModuleEnabled: async (moduleId) => {
      const module = discoveryById.get(moduleId);
      if (!module) return false;
      const state = await workerDb
        .selectFrom("app.external_modules")
        .select(["status", "manifest_hash", "package_hash"])
        .where("id", "=", moduleId)
        .executeTakeFirst();
      return (
        state?.status === "enabled" &&
        state.manifest_hash === module.manifestHash &&
        state.package_hash === module.packageHash
      );
    },
    listActiveUserIds,
    registerWorker: async (module, queue) => {
      // Handler body extracted to external-module-job-handler.ts (JS-07
      // Step 0) so the queue path is integration-testable with real deps.
      await registerDataContextWorker<ExternalModuleJobPayload, unknown>(
        boss,
        queue.name,
        dataContext,
        createExternalModuleJobHandler({
          module,
          queue,
          runtime,
          workerDb,
          dataContext,
          cipher,
          discoveryById,
          listActiveUserIds,
          ai: moduleAiBridge
        })
      );
    },
    logger: workerLogger
  });
  const reconciler = externalReconciler;
  await boss.work<ModuleControlPayload>(PLATFORM_MODULE_CONTROL_QUEUE, async ([job]) => {
    if (!job) throw new Error("module control worker received no job");
    assertModuleControlPayload(job.data);
    await reconciler.reconcileModule(job.data.moduleId);
  });
  await externalReconciler.reconcileAll();

  // -------------------------------------------------------------------------
  // Graceful-shutdown (#165 MED)
  //
  // boss.stop({ graceful: true }) asks pg-boss to drain in-flight jobs before
  // closing its own connections. We race against a bounded timeout so a hung
  // drain still exits cleanly. workerDb.destroy() is always called AFTER
  // boss.stop() resolves — workerDb is the Kysely pool that job *handlers* run
  // against, so it must outlive the drain (pg-boss owns a separate connection).
  // -------------------------------------------------------------------------
  async function shutdown(): Promise<void> {
    await externalReconciler?.close();
    await externalRuntime?.close();
    await Promise.race([
      boss.stop({ graceful: true }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, GRACEFUL_STOP_TIMEOUT_MS);
      })
    ]);
    await workerDb.destroy();
  }

  return { boss, shutdown };
}

// ---------------------------------------------------------------------------
// Production entry point: build, wire signal handlers, run.
//
// Guarded by `import.meta.url === file://${process.argv[1]}` so importing this
// module in a unit test (to assert WORKER_BOSS_OPTIONS / logScheduleMode — the
// one-cron-owner invariant) does NOT connect to Postgres or register a worker.
// Mirrors apps/api/src/server.ts's bootstrap guard.
// ---------------------------------------------------------------------------
async function bootstrap(): Promise<void> {
  const handle = await buildWorker();

  console.log(`Jarv1s worker listening on ${RLS_PROBE_QUEUE} and built-in module queues`);

  // LOW (#165): document the intentional escalation path. unhandledRejection and
  // uncaughtException both funnel into handleCrash, which logs, attempts a
  // bounded drain (2s race), then exits with code 1.
  //
  // MED (#158): pg-boss internal `error` events are NO LONGER re-thrown — they are
  // logged structured (defaultOnPgBossError) without escalation, so a transient
  // boss-connection blip cannot crash the worker mid-drain. Genuine fatal failures
  // still surface through unhandledRejection / uncaughtException above.
  const handleCrash = (label: string, err: unknown): void => {
    // LOW (#165): log err.message for Error values instead of String(err), which
    // would stringify a non-Error object (e.g. a config/pool object) and could
    // surface a connection string. Non-Error rejection reasons collapse to
    // "unknown" — blunt, but never leaks.
    const message = err instanceof Error ? err.message : "unknown";
    console.error(
      JSON.stringify({ level: "fatal", label, err: message, msg: "Process crash — exiting" })
    );
    const drain = Promise.race([
      handle.shutdown(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2000);
      })
    ]);
    void drain.then(() => {
      process.exit(1);
    });
  };

  process.once("SIGINT", () => {
    void handle.shutdown().then(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void handle.shutdown().then(() => process.exit(0));
  });

  process.on("unhandledRejection", (reason) => {
    handleCrash("unhandledRejection", reason);
  });
  process.on("uncaughtException", (err: Error) => {
    handleCrash("uncaughtException", err);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
}
