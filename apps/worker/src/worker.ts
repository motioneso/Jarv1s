import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { RlsProbeRepository } from "@jarv1s/db/probes";
import {
  RLS_PROBE_QUEUE,
  createPgBossClient,
  registerDataContextWorker,
  type RlsProbeJobPayload
} from "@jarv1s/jobs";
import { registerBuiltInModuleWorkers } from "@jarv1s/module-registry";

const urls = getJarvisDatabaseUrls();
const workerDb = createDatabase({
  connectionString: urls.worker,
  maxConnections: Number(process.env.JARVIS_WORKER_DB_POOL_SIZE ?? 4)
});
const dataContext = new DataContextRunner(workerDb);
const repository = new RlsProbeRepository();
const boss = createPgBossClient(urls.worker);

await boss.start();
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
await registerBuiltInModuleWorkers(boss, { dataContext });

console.log(`Jarv1s worker listening on ${RLS_PROBE_QUEUE} and built-in module queues`);

async function shutdown(): Promise<void> {
  await Promise.allSettled([boss.stop({ graceful: false }), workerDb.destroy()]);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
