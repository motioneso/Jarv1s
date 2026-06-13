import {
  PgBoss,
  type ConstructorOptions,
  type Job,
  type Queue,
  type SendOptions,
  type WorkOptions
} from "pg-boss";

import { assertUuid } from "@jarv1s/db";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";

export const PGBOSS_SCHEMA = "pgboss";
export const RLS_PROBE_QUEUE = "rls-probe";

export interface ActorScopedJobPayload {
  readonly actorUserId: string;
}

export interface RlsProbeJobPayload extends ActorScopedJobPayload {
  readonly targetItemId: string;
}

export interface QueueDefinition {
  readonly name: string;
  readonly options?: Omit<Queue, "name">;
}

export const FOUNDATION_QUEUES: readonly QueueDefinition[] = [
  {
    name: RLS_PROBE_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    }
  }
];

/**
 * The complete set of allowed metadata keys for all pg-boss payloads in this codebase.
 * Enumerated from all live boss.send() / sendJob() call sites.
 * Hard invariant: no key that carries content, prompts, secrets, or tokens may appear here.
 */
export const ALLOWED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "actorUserId",
  "taskId",
  "requestedStatus",
  "definitionId",
  "briefingRunId",
  "runKind",
  "threadId",
  "messageId",
  "targetItemId",
  "kind",
  "resourceId",
  "idempotencyKey"
]);

export function assertMetadataOnlyPayload(payload: Record<string, unknown>): void {
  const forbidden = Object.keys(payload).filter((k) => !ALLOWED_PAYLOAD_KEYS.has(k));
  if (forbidden.length > 0) {
    throw new Error(
      `Job payload contains non-metadata keys: ${forbidden.join(", ")}. ` +
        `Payloads must contain only: ${[...ALLOWED_PAYLOAD_KEYS].join(", ")}`
    );
  }
}

/**
 * Send-side wrapper that enforces the metadata-only payload invariant before
 * delegating to boss.send(). Use this everywhere instead of raw boss.send().
 */
export async function sendJob<T extends ActorScopedJobPayload>(
  boss: PgBoss,
  queue: string,
  payload: T,
  options?: SendOptions
): Promise<string | null> {
  assertMetadataOnlyPayload(payload as unknown as Record<string, unknown>);
  return options === undefined ? boss.send(queue, payload) : boss.send(queue, payload, options);
}

export interface PgBossClientHooks {
  /**
   * Invoked for pg-boss internal `error` events. Defaults to structured stderr logging.
   *
   * NEVER rethrow from here (#158): the `error` event fires on pg-boss's own maintenance
   * connection, and a throw inside the EventEmitter listener escalates to an
   * `uncaughtException` that crashes the entire host process on a transient DB blip. A
   * long-lived process (the API HTTP server) must survive a momentary boss-connection error,
   * so the default handler logs and continues.
   */
  readonly onError?: (error: Error) => void;
}

function defaultOnPgBossError(error: Error): void {
  // Single-line structured JSON for log scrapers. We deliberately serialise only name+message,
  // never the raw error object — some driver errors carry the connection string.
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "pgboss.internal_error",
      name: error.name,
      message: error.message
    })}\n`
  );
}

export function createPgBossClient(
  connectionString: string,
  overrides: Partial<ConstructorOptions> = {},
  hooks: PgBossClientHooks = {}
): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    schedule: false,
    supervise: false,
    migrate: false,
    createSchema: false,
    ...overrides
  });

  const onError = hooks.onError ?? defaultOnPgBossError;
  boss.on("error", (error: unknown) => {
    onError(error instanceof Error ? error : new Error(String(error)));
  });

  return boss;
}

export async function migratePgBoss(
  connectionString: string,
  queues: readonly QueueDefinition[] = FOUNDATION_QUEUES
): Promise<void> {
  const boss = createPgBossClient(connectionString, {
    migrate: true,
    createSchema: true
  });

  await boss.start();
  try {
    for (const queue of queues) {
      const existing = await boss.getQueue(queue.name);
      const desiredPolicy = queue.options?.policy ?? "standard";
      const currentPolicy = existing?.policy ?? "standard";

      if (existing && currentPolicy !== desiredPolicy) {
        // A queue's policy cannot be changed in place: pg-boss's UpdateQueueOptions
        // omits `policy`, and the singletonKey dedup index is policy-filtered
        // (job_iN ... WHERE policy = '<policy>'), so a job only dedupes if its row's
        // policy column matches. The only way to flip policy is to drop and recreate
        // the queue. Safe in this pre-prod project where queued jobs are ephemeral;
        // logged so the one-time drop of any in-flight jobs is visible.
        process.stderr.write(
          `${JSON.stringify({
            level: "warn",
            event: "pgboss.queue_policy_recreate",
            queue: queue.name,
            from: currentPolicy,
            to: desiredPolicy
          })}\n`
        );
        await boss.deleteQueue(queue.name);
        await boss.createQueue(queue.name, queue.options);
      } else if (existing) {
        // pg-boss v12's updateQueue throws if the options object carries `policy`
        // or `partition` (manager.js rejects both keys outright — it does not compare
        // values, so even an unchanged policy errors) and asserts a non-empty object.
        // Strip those non-updatable keys so re-running `pnpm db:migrate` against an
        // already-created policy-bearing queue (e.g. briefings `exclusive`) stays
        // idempotent — the migrate contract requires exit 0 on every run, not just the
        // first. The policy-change case is handled above by drop+recreate.
        const { policy: _policy, partition: _partition, ...updatable } = queue.options ?? {};
        if (Object.keys(updatable).length > 0) {
          await boss.updateQueue(queue.name, updatable);
        }
      } else {
        await boss.createQueue(queue.name, queue.options);
      }
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}

export async function registerDataContextWorker<TPayload extends ActorScopedJobPayload, TResult>(
  boss: PgBoss,
  queueName: string,
  dataContext: DataContextRunner,
  handler: (job: Job<TPayload>, scopedDb: DataContextDb) => Promise<TResult>,
  options: WorkOptions = { pollingIntervalSeconds: 2 }
): Promise<string> {
  return boss.work<TPayload, TResult>(queueName, options, async ([job]) => {
    if (!job) {
      throw new Error(`pg-boss invoked ${queueName} without a job`);
    }

    return dataContext.withDataContext(toAccessContext(job), (scopedDb) => handler(job, scopedDb));
  });
}

function toAccessContext(job: Job<ActorScopedJobPayload>): AccessContext {
  if (!job.data.actorUserId) {
    throw new Error(`Job ${job.id} is missing actorUserId`);
  }
  // The actor id becomes the RLS principal via withDataContext → set_config. Shape-check it at
  // the job boundary so a malformed payload fails with a job-scoped error rather than a 22P02
  // surfacing deep inside a handler query (#158).
  assertUuid(job.data.actorUserId, `Job ${job.id} actorUserId`);

  return {
    actorUserId: job.data.actorUserId,
    requestId: `pgboss:${job.id}`
  };
}
