import type { FastifyBaseLogger } from "fastify";
import type { PgBoss } from "pg-boss";

import type { DataContextDb } from "@jarv1s/db";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { NEWS_REVALIDATE_QUEUE } from "./jobs.js";
import type { NewsPersonalizationRepository } from "./personalization-repository.js";

/** Logger fallback — silent when no logger is injected (briefings schedule precedent). */
const NOOP_LOGGER: Pick<FastifyBaseLogger, "error"> = {
  error: () => undefined
};

// Daily at an off-minute (fleet convention: avoid :00/:30 thundering herds).
export const NEWS_REVALIDATE_CRON = "43 4 * * *";

/**
 * Reconcile the per-owner daily revalidation schedule row. Keyed on the owner so every
 * personalization write upserts through the same pgboss (name, key). Any custom source
 * or topic → schedule exists; none → unschedule. Best-effort by design: schedule drift
 * self-heals on the next personalization read/write, so a pg-boss hiccup here must never
 * fail the calling route (#975 Slice 4).
 */
export async function reconcileNewsRevalidationSchedule(
  boss: PgBoss,
  scopedDb: DataContextDb,
  repository: Pick<NewsPersonalizationRepository, "countCustomSources" | "countCustomTopics">,
  actorUserId: string,
  logger: Pick<FastifyBaseLogger, "error"> = NOOP_LOGGER
): Promise<void> {
  try {
    const [sourceCount, topicCount] = await Promise.all([
      repository.countCustomSources(scopedDb),
      repository.countCustomTopics(scopedDb)
    ]);
    // pg-boss asserts schedule keys are [alnum_.-/] only — colons rejected — so the
    // per-owner key is the bare owner id (briefings precedent: key = definition id). The
    // payload idempotencyKey keeps the colon form used by enqueueNewsRevalidation.
    const key = actorUserId;
    if (sourceCount + topicCount > 0) {
      const payload = {
        actorUserId,
        kind: "revalidate",
        idempotencyKey: `news-revalidate:${actorUserId}`
      };
      // Defense-in-depth: boss.schedule does NOT route through sendJob's metadata guard,
      // so assert the cron payload is metadata-only here too (Hard Invariant).
      assertMetadataOnlyPayload(payload);
      await boss.schedule(NEWS_REVALIDATE_QUEUE, NEWS_REVALIDATE_CRON, payload, {
        tz: "UTC",
        key
      });
      return;
    }
    await boss.unschedule(NEWS_REVALIDATE_QUEUE, key);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        event: "news_revalidation_schedule_failed",
        error: e.name,
        message: e.message.slice(0, 200)
      },
      "news revalidation schedule reconcile failed"
    );
  }
}
