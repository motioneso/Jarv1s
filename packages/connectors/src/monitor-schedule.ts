import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import {
  CALENDAR_MONITOR_QUEUE,
  EMAIL_MONITOR_QUEUE,
  type MonitorPayload
} from "./monitor-jobs.js";

export const EMAIL_MONITOR_CRON = "*/15 * * * *";
export const CALENDAR_MONITOR_CRON = "*/30 * * * *";
const MONITOR_TZ = "UTC";

/**
 * Reconcile the per-account proactive monitor schedules (#729 §5): email every 15 minutes,
 * calendar every 30. Like reconcileImapAccountSchedule, the pg-boss schedule key is the
 * connectorAccountId and the payload carries actorUserId for the worker's RLS boundary —
 * metadata-only keys, asserted as defense-in-depth because boss.schedule bypasses sendJob's
 * guard. A capability the account lacks (or a disconnect) unschedules that queue.
 */
export async function reconcileMonitorSchedules(
  boss: PgBoss,
  actorUserId: string,
  connectorAccountId: string,
  capabilities: { email: boolean; calendar: boolean },
  connected: boolean
): Promise<void> {
  if (connected && capabilities.email) {
    const data: MonitorPayload = { actorUserId, connectorAccountId, kind: "email-monitor" };
    assertMetadataOnlyPayload(data);
    await boss.schedule(EMAIL_MONITOR_QUEUE, EMAIL_MONITOR_CRON, data, {
      tz: MONITOR_TZ,
      key: connectorAccountId
    });
  } else {
    await boss.unschedule(EMAIL_MONITOR_QUEUE, connectorAccountId);
  }

  if (connected && capabilities.calendar) {
    const data: MonitorPayload = { actorUserId, connectorAccountId, kind: "calendar-monitor" };
    assertMetadataOnlyPayload(data);
    await boss.schedule(CALENDAR_MONITOR_QUEUE, CALENDAR_MONITOR_CRON, data, {
      tz: MONITOR_TZ,
      key: connectorAccountId
    });
  } else {
    await boss.unschedule(CALENDAR_MONITOR_QUEUE, connectorAccountId);
  }
}
