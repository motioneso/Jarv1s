import {
  PgBoss,
  type ConstructorOptions,
  type Job,
  type QueueOptions,
  type SendOptions,
  type WorkOptions
} from "pg-boss";

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
  readonly options?: Omit<QueueOptions, "name">;
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

function assertMetadataOnlyPayload(payload: Record<string, unknown>): void {
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

export function createPgBossClient(
  connectionString: string,
  overrides: Partial<ConstructorOptions> = {}
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

  boss.on("error", (error) => {
    throw error;
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

      if (existing) {
        await boss.updateQueue(queue.name, queue.options);
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

  return {
    actorUserId: job.data.actorUserId,
    requestId: `pgboss:${job.id}`
  };
}
