import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { IMAP_SYNC_QUEUE } from "./imap-sync-jobs.js";

export const IMAP_SYNC_CRON = "*/15 * * * *";
const IMAP_SYNC_TZ = "UTC";

/**
 * Reconcile the per-account IMAP sync schedule. Keyed by connectorAccountId (not actor id) —
 * one actor may connect several IMAP presets at once, each syncing on its own schedule row.
 * assertMetadataOnlyPayload is defense-in-depth (boss.schedule bypasses sendJob's guard).
 */
export async function reconcileImapAccountSchedule(
  boss: PgBoss,
  connectorAccountId: string,
  connected: boolean
): Promise<void> {
  if (connected) {
    const data = { connectorAccountId };
    assertMetadataOnlyPayload(data);
    await boss.schedule(IMAP_SYNC_QUEUE, IMAP_SYNC_CRON, data, {
      tz: IMAP_SYNC_TZ,
      key: connectorAccountId
    });
    return;
  }
  await boss.unschedule(IMAP_SYNC_QUEUE, connectorAccountId);
}
