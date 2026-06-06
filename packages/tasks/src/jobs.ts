import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { DataContextRunner, TaskStatus } from "@jarv1s/db";
import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";

import { TASKS_DEFERRED_STATUS_QUEUE } from "./manifest.js";
import { TasksRepository } from "./repository.js";

export interface DeferredTaskStatusPayload extends ActorScopedJobPayload {
  readonly taskId: string;
  readonly requestedStatus: TaskStatus;
  readonly idempotencyKey?: string;
}

export interface DeferredTaskStatusResult {
  readonly taskId: string;
  readonly updated: boolean;
  readonly status: TaskStatus | null;
}

export interface RegisterTasksJobWorkersOptions {
  readonly repository?: TasksRepository;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (
    job: Job<DeferredTaskStatusPayload>,
    result: DeferredTaskStatusResult
  ) => void;
}

export const TASKS_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: TASKS_DEFERRED_STATUS_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    }
  }
];

export const DEFERRED_TASK_STATUS_PAYLOAD_KEYS = [
  "actorUserId",
  "workspaceId",
  "taskId",
  "requestedStatus",
  "idempotencyKey"
] as const;

export function isDeferredTaskStatusPayloadMetadataOnly(payload: Record<string, unknown>): boolean {
  const allowedKeys = new Set<string>(DEFERRED_TASK_STATUS_PAYLOAD_KEYS);

  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

export async function registerTasksJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterTasksJobWorkersOptions = {}
): Promise<string[]> {
  const repository = options.repository ?? new TasksRepository();
  const workId = await registerDataContextWorker<
    DeferredTaskStatusPayload,
    DeferredTaskStatusResult
  >(
    boss,
    TASKS_DEFERRED_STATUS_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      if (
        !isDeferredTaskStatusPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)
      ) {
        throw new Error(`Task job ${job.id} contains non-metadata payload fields`);
      }

      const task = await repository.updateStatus(
        scopedDb,
        job.data.taskId,
        job.data.requestedStatus
      );

      const result = {
        taskId: job.data.taskId,
        updated: task !== undefined,
        status: task?.status ?? null
      };

      options.onResult?.(job, result);

      return result;
    },
    options.workOptions
  );

  return [workId];
}
