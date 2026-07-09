import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { DataContextRunner, TaskStatus } from "@jarv1s/db";
import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";
import { localDay } from "@jarv1s/shared";

import { readActorTimezone } from "./drift.js";
import { TASKS_DEFERRED_STATUS_QUEUE, TASKS_RECURRENCE_QUEUE } from "./manifest.js";
import { rollForwardOwnedSeries } from "./recurrence.js";
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
  readonly onRecurrenceResult?: (
    job: Job<RecurrenceMaterializePayload>,
    result: RecurrenceMaterializeResult
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
  },
  {
    name: TASKS_RECURRENCE_QUEUE,
    options: {
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    }
  }
];

export const DEFERRED_TASK_STATUS_PAYLOAD_KEYS = [
  "actorUserId",
  "taskId",
  "requestedStatus",
  "idempotencyKey"
] as const;

export function isDeferredTaskStatusPayloadMetadataOnly(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const allowedKeys = new Set<string>(DEFERRED_TASK_STATUS_PAYLOAD_KEYS);

  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

export interface RecurrenceMaterializePayload extends ActorScopedJobPayload {
  readonly idempotencyKey?: string;
}

export interface RecurrenceMaterializeResult {
  readonly rolledForward: number;
}

export const RECURRENCE_MATERIALIZE_PAYLOAD_KEYS = ["actorUserId", "idempotencyKey"] as const;

export function isRecurrenceMaterializePayloadMetadataOnly(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const allowedKeys = new Set<string>(RECURRENCE_MATERIALIZE_PAYLOAD_KEYS);

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
      if (!isDeferredTaskStatusPayloadMetadataOnly(job.data)) {
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

  const recurrenceWorkId = await registerDataContextWorker<
    RecurrenceMaterializePayload,
    RecurrenceMaterializeResult
  >(
    boss,
    TASKS_RECURRENCE_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      if (!isRecurrenceMaterializePayloadMetadataOnly(job.data)) {
        throw new Error(`Recurrence job ${job.id} contains non-metadata payload fields`);
      }

      // Read the actor's tz first, then roll on THEIR local day, not the worker's UTC
      // server day (#877 finding 2) — a nightly cron running server-side is the exact
      // place a UTC default silently rolls a still-due evening task to tomorrow.
      const tz = await readActorTimezone(scopedDb);
      const rolledForward = await rollForwardOwnedSeries(scopedDb, localDay(new Date(), tz));
      const result = { rolledForward };

      options.onRecurrenceResult?.(job, result);

      return result;
    },
    options.workOptions
  );

  return [workId, recurrenceWorkId];
}
