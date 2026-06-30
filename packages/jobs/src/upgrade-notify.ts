import type { DataContextDb } from "@jarv1s/db";
import { NotificationsRepository } from "@jarv1s/notifications";
import type { Job, PgBoss } from "./pg-boss.js";
import { UPGRADE_NOTIFY_QUEUE, registerDataContextWorker } from "./pg-boss.js";
import type { DataContextRunner } from "@jarv1s/db";
import type { UpgradeNotifyPayload } from "./upgrade-check.js";

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
