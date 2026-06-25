import type { PgBoss } from "@jarv1s/jobs";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

export const EXPORT_CLEANUP_QUEUE = "export.cleanup";
export const EXPORT_CLEANUP_CRON = "17 * * * *";
const EXPORT_CLEANUP_TZ = "UTC";
const EXPORT_CLEANUP_KEY = "data-export-cleanup";

export async function reconcileDataExportCleanupSchedule(boss: PgBoss): Promise<void> {
  const data = { kind: "export.cleanup" as const };
  assertMetadataOnlyPayload(data);
  await boss.schedule(EXPORT_CLEANUP_QUEUE, EXPORT_CLEANUP_CRON, data, {
    tz: EXPORT_CLEANUP_TZ,
    key: EXPORT_CLEANUP_KEY
  });
}
