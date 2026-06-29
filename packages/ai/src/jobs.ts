import type { PgBoss } from "pg-boss";

import type { Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import { type QueueDefinition } from "@jarv1s/jobs";

import { AiRepository } from "./repository.js";

export const AI_PURGE_AUDIT_LOG_QUEUE = "ai-purge-audit-log";

export const AI_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: AI_PURGE_AUDIT_LOG_QUEUE,
    options: { retryLimit: 3, retryDelay: 300, retryBackoff: true }
  }
];

export async function registerAiMaintenanceWorkers(
  boss: PgBoss,
  rootDb: Kysely<JarvisDatabase>
): Promise<string[]> {
  const repository = new AiRepository();

  await boss.schedule(AI_PURGE_AUDIT_LOG_QUEUE, "0 3 * * *", {}, { tz: "UTC" });

  const workId = await boss.work(AI_PURGE_AUDIT_LOG_QUEUE, async () => {
    const olderThan = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const count = await repository.purgeActionAuditLog(rootDb, olderThan);
    return { purgedRows: count };
  });

  return [workId];
}
