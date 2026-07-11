import type { PgBoss } from "pg-boss";

import { sendJob, type ActorScopedJobPayload, type QueueDefinition } from "@jarv1s/jobs";

export const NEWS_REFRESH_QUEUE = "news.refresh";

export const NEWS_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: NEWS_REFRESH_QUEUE,
    options: {
      policy: "exclusive",
      retryLimit: 0,
      deleteAfterSeconds: 60,
      retentionSeconds: 60
    }
  }
];

export interface NewsRefreshPayload extends ActorScopedJobPayload {
  readonly kind: "user_refresh";
  readonly idempotencyKey: string;
}

export async function enqueueNewsRefresh(boss: PgBoss, actorUserId: string): Promise<boolean> {
  const idempotencyKey = `news-refresh:${actorUserId}`;
  const id = await sendJob(
    boss,
    NEWS_REFRESH_QUEUE,
    { actorUserId, kind: "user_refresh", idempotencyKey },
    { singletonKey: actorUserId }
  );
  return id !== null;
}
