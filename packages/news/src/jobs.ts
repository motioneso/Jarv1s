import type { PgBoss } from "pg-boss";

import type { DataContextRunner } from "@jarv1s/db";
import {
  assertMetadataOnlyPayload,
  registerDataContextWorker,
  sendJob,
  type ActorScopedJobPayload,
  type QueueDefinition
} from "@jarv1s/jobs";

import {
  compilePersonalizedNews,
  type CompilationRepository,
  type MetadataLogger
} from "./compilation/compile.js";
import type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./discovery/ports.js";
import { NewsPersonalizationRepository } from "./personalization-repository.js";
import { NewsPrefsRepository } from "./repository.js";
import { NEWS_CATALOG } from "./source/catalog.js";

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

type NewsJobRepository = CompilationRepository &
  Pick<NewsPersonalizationRepository, "beginRefreshRun" | "failRefreshRunIfCurrent">;

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

export async function registerNewsJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  deps: {
    readonly fetch: NewsSafeFetchPort;
    readonly search: NewsWebSearchPort;
    readonly ai: NewsAiPort;
    readonly logger: MetadataLogger;
    readonly repository?: NewsJobRepository;
    readonly prefsRepository?: Pick<NewsPrefsRepository, "list">;
  }
): Promise<string[]> {
  const repository = deps.repository ?? new NewsPersonalizationRepository();
  const prefs = deps.prefsRepository ?? new NewsPrefsRepository();
  const workId = await registerDataContextWorker<NewsRefreshPayload, { outcome: string }>(
    boss,
    NEWS_REFRESH_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      assertMetadataOnlyPayload(job.data);
      for (;;) {
        const generation = await repository.beginRefreshRun(scopedDb);
        const result = await compilePersonalizedNews(
          scopedDb,
          {
            fetch: deps.fetch,
            search: deps.search,
            ai: deps.ai,
            repo: repository,
            prefs,
            catalog: NEWS_CATALOG,
            logger: deps.logger
          },
          { now: new Date(), generation }
        );
        if (result.outcome === "replaced") return { outcome: result.outcome };
        if (result.outcome === "stale") continue;
        const failed = await repository.failRefreshRunIfCurrent(
          scopedDb,
          generation,
          result.failureKind ?? "internal"
        );
        if (failed) return { outcome: result.outcome };
      }
    }
  );
  return [workId];
}
