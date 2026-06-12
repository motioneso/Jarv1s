import type { PgBoss } from "pg-boss";

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

  const workerDb = createDatabase({
    connectionString,
    maxConnections: Number(process.env.JARVIS_WORKER_DB_POOL_SIZE ?? 4)
  });
  const dataContext = new DataContextRunner(workerDb);
  const repository = new RlsProbeRepository();
  const boss = createPgBossClient(connectionString);

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
  await registerBuiltInModuleWorkers(boss, { dataContext, embeddingProvider });

  // -------------------------------------------------------------------------
  // Graceful-shutdown (#165 MED)
  //
  // boss.stop({ graceful: true }) asks pg-boss to drain in-flight jobs before
  // closing connections. We race against a bounded timeout so a hung drain
  // still exits cleanly. workerDb.destroy() is always called AFTER boss.stop()
  // resolves — pg-boss needs the pool open to complete its shutdown sequence.
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
// ---------------------------------------------------------------------------

const handle = await buildWorker();

console.log(`Jarv1s worker listening on ${RLS_PROBE_QUEUE} and built-in module queues`);

// LOW (#165): document the intentional escalation path. unhandledRejection and
// uncaughtException both funnel into handleCrash, which logs, attempts a
// bounded drain (2s race), then exits with code 1. The boss `error` event
// (emitted for internal pg-boss errors) is also wired via createPgBossClient
// to re-throw synchronously, ensuring it surfaces as an uncaughtException.
const handleCrash = (label: string, err: unknown): void => {
  // LOW (#165): log err.message instead of String(err) to avoid leaking
  // connection strings that may appear in error stack traces.
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
