import {
  registerDataContextWorker,
  sendJob,
  type ActorScopedJobPayload,
  type QueueDefinition,
  type PgBoss
} from "@jarv1s/jobs";
import type { DataContextRunner } from "@jarv1s/db";
import { CalendarRepository } from "./repository.js";

export const CALENDAR_CACHE_EVICT_QUEUE = "calendar.cache-evict-event";

export const CALENDAR_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: CALENDAR_CACHE_EVICT_QUEUE,
    options: { retryLimit: 2, retryDelay: 10, deleteAfterSeconds: 300, retentionSeconds: 300 }
  }
];

export interface CalendarCacheEvictPayload extends ActorScopedJobPayload {
  readonly targetItemId: string;
  readonly idempotencyKey?: string;
}

export async function sendCalendarCacheEvictJob(
  boss: PgBoss,
  payload: CalendarCacheEvictPayload
): Promise<string | null> {
  return sendJob(boss, CALENDAR_CACHE_EVICT_QUEUE, payload);
}

export async function registerCalendarJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner
): Promise<string[]> {
  const repo = new CalendarRepository();
  const workId = await registerDataContextWorker<CalendarCacheEvictPayload, { evicted: boolean }>(
    boss,
    CALENDAR_CACHE_EVICT_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      const row = await repo.getById(scopedDb, job.data.targetItemId);
      if (!row) return { evicted: false };
      await repo.deleteById(scopedDb, job.data.targetItemId);
      return { evicted: true };
    }
  );
  return [workId];
}
