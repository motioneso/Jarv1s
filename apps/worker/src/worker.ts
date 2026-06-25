import type { ConstructorOptions, PgBoss } from "pg-boss";
import { pino, type Logger as PinoLogger } from "pino";
import type { FastifyBaseLogger } from "fastify";

import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { RlsProbeRepository } from "@jarv1s/db/probes";
import {
  RLS_PROBE_QUEUE,
  createPgBossClient,
  registerDataContextWorker,
  type RlsProbeJobPayload
} from "@jarv1s/jobs";
import { createEmbeddingProvider, getEmbeddingProviderConfig } from "@jarv1s/memory";
import { getAllQueueDefinitions, registerBuiltInModuleWorkers } from "@jarv1s/module-registry";

// ---------------------------------------------------------------------------
// Bounded graceful-shutdown timeout (ms). On SIGINT/SIGTERM the worker waits
// up to this long for in-flight jobs to drain before destroying the DB pool.
// The crash path keeps its own 2s race — this value is for the clean path.
// ---------------------------------------------------------------------------
const GRACEFUL_STOP_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// One-cron-owner invariant (F14)
//
// pg-boss's per-definition cron engine must run in EXACTLY ONE process. The
// worker is that process: it constructs its boss with `{ schedule: true }`.
// The API process (apps/api/src/server.ts) passes no override, so it keeps the
// shared `createPgBossClient` default (`schedule: false`) and never starts a
// second cron engine. Exported so the one-cron-owner invariant is unit-testable
// at the worker call site (tests/unit/worker-schedule-mode.test.ts).
// ---------------------------------------------------------------------------
export const WORKER_BOSS_OPTIONS: Partial<ConstructorOptions> = { schedule: true };

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
  // The worker is the SOLE pg-boss cron owner (F14): enable `schedule: true` here
  // and ONLY here, so scheduled jobs (recurrence materialization, scheduled briefings)
  // fire in exactly one place. The API process (apps/api/src/server.ts) keeps the
  // shared `createPgBossClient` default (schedule:false). WORKER_BOSS_OPTIONS +
  // logScheduleMode make the one-cron-owner invariant unit-testable + observable.
  const boss = createPgBossClient(connectionString, WORKER_BOSS_OPTIONS);
  logScheduleMode();

  // LOW (#165): createEmbeddingProvider is synchronous — drop the misleading await.
  const embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());

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
  await registerBuiltInModuleWorkers(boss, {
    rootDb: workerDb,
    dataContext,
    embeddingProvider,
    // Pino's Logger is structurally what FastifyBaseLogger wraps at runtime
    // (Fastify uses pino internally). The cast bridges the nominal type gap.
    logger: workerLogger as unknown as FastifyBaseLogger
  });

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
