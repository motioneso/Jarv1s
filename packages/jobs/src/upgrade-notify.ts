import type { DataContextDb } from "@jarv1s/db";
import { NotificationsRepository } from "@jarv1s/notifications";
import type { Job, PgBoss } from "./pg-boss.js";
import { UPGRADE_NOTIFY_QUEUE, registerDataContextWorker } from "./pg-boss.js";
import type { DataContextRunner } from "@jarv1s/db";
import type { UpgradeNotifyPayload } from "./upgrade-check.js";

// Local literal, not an import of @jarv1s/settings's own SETTINGS_MODULE_ID (#834): jobs is
// generic job infrastructure and must not depend on any specific module — that edge is what
// closed the jobs -> settings -> proactive-monitoring -> jobs cycle. Every other module in the
// repo that tags a notification/record with another module's id does the same (see
// packages/calendar/src/routes.ts's local CALENDAR_WRITEBACK_MODULE_ID). Must stay in sync with
// packages/settings/src/manifest.ts's SETTINGS_MODULE_ID ("settings").
const SETTINGS_MODULE_ID = "settings";

export interface UpgradeNotifyOptions {
  readonly repository?: NotificationsRepository;
  readonly logger?: {
    error(obj: Record<string, unknown>, msg?: string): void;
  };
}

export async function handleUpgradeNotifyJob(
  job: Job<UpgradeNotifyPayload>,
  scopedDb: DataContextDb,
  options: UpgradeNotifyOptions = {}
): Promise<{ created: boolean }> {
  const repository = options.repository ?? new NotificationsRepository();
  const existing = await repository.listVisible(scopedDb);
  const alreadySent = existing.notifications.some(
    (notification) =>
      notification.metadata?.kind === "upgrade_available" &&
      notification.metadata?.version === job.data.version
  );
  if (alreadySent) return { created: false };

  try {
    await repository.create(scopedDb, {
      moduleId: SETTINGS_MODULE_ID,
      title: `Jarvis ${job.data.version} is available`,
      body: "A newer version of Jarvis is available. View the release notes and upgrade from Settings -> Diagnostics.",
      urgency: "normal",
      metadata: { kind: "upgrade_available", version: job.data.version }
    });
    return { created: true };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    options.logger?.error(
      {
        event: "upgrade_notification_failed",
        version: job.data.version,
        error: e.name,
        message: e.message.slice(0, 200)
      },
      "upgrade notification write failed"
    );
    return { created: false };
  }
}

export async function registerUpgradeNotifyWorker(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: UpgradeNotifyOptions = {}
): Promise<string> {
  return registerDataContextWorker<UpgradeNotifyPayload, { created: boolean }>(
    boss,
    UPGRADE_NOTIFY_QUEUE,
    dataContext,
    (job, scopedDb) => handleUpgradeNotifyJob(job, scopedDb, options)
  );
}
