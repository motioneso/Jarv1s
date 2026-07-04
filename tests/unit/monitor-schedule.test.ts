import { describe, expect, it, vi } from "vitest";

import {
  CALENDAR_MONITOR_CRON,
  CALENDAR_MONITOR_QUEUE,
  EMAIL_MONITOR_CRON,
  EMAIL_MONITOR_QUEUE,
  reconcileMonitorSchedules
} from "@jarv1s/connectors";

const ACTOR = "00000000-0000-4000-8000-000000000001";

function fakeBoss() {
  return {
    schedule: vi.fn().mockResolvedValue(undefined),
    unschedule: vi.fn().mockResolvedValue(undefined)
  };
}

describe("reconcileMonitorSchedules", () => {
  it("schedules both monitors for a connected google-like account (email + calendar)", async () => {
    const boss = fakeBoss();
    await reconcileMonitorSchedules(
      boss as never,
      ACTOR,
      "acct-1",
      { email: true, calendar: true },
      true
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      EMAIL_MONITOR_QUEUE,
      EMAIL_MONITOR_CRON,
      { actorUserId: ACTOR, connectorAccountId: "acct-1", kind: "email-monitor" },
      { tz: "UTC", key: "acct-1" }
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      CALENDAR_MONITOR_QUEUE,
      CALENDAR_MONITOR_CRON,
      { actorUserId: ACTOR, connectorAccountId: "acct-1", kind: "calendar-monitor" },
      { tz: "UTC", key: "acct-1" }
    );
    expect(boss.unschedule).not.toHaveBeenCalled();
    expect(EMAIL_MONITOR_CRON).toBe("*/15 * * * *");
    expect(CALENDAR_MONITOR_CRON).toBe("*/30 * * * *");
  });

  it("schedules email and unschedules calendar for an imap-like account", async () => {
    const boss = fakeBoss();
    await reconcileMonitorSchedules(
      boss as never,
      ACTOR,
      "acct-2",
      { email: true, calendar: false },
      true
    );
    expect(boss.schedule).toHaveBeenCalledTimes(1);
    expect(boss.schedule).toHaveBeenCalledWith(
      EMAIL_MONITOR_QUEUE,
      EMAIL_MONITOR_CRON,
      { actorUserId: ACTOR, connectorAccountId: "acct-2", kind: "email-monitor" },
      { tz: "UTC", key: "acct-2" }
    );
    expect(boss.unschedule).toHaveBeenCalledWith(CALENDAR_MONITOR_QUEUE, "acct-2");
  });

  it("unschedules both queues on disconnect regardless of capabilities", async () => {
    const boss = fakeBoss();
    await reconcileMonitorSchedules(
      boss as never,
      ACTOR,
      "acct-3",
      { email: true, calendar: true },
      false
    );
    expect(boss.schedule).not.toHaveBeenCalled();
    expect(boss.unschedule).toHaveBeenCalledWith(EMAIL_MONITOR_QUEUE, "acct-3");
    expect(boss.unschedule).toHaveBeenCalledWith(CALENDAR_MONITOR_QUEUE, "acct-3");
  });

  it("payloads are metadata-only — allowlisted keys, no content or secrets", async () => {
    const boss = fakeBoss();
    await reconcileMonitorSchedules(
      boss as never,
      ACTOR,
      "acct-4",
      { email: true, calendar: true },
      true
    );
    for (const call of boss.schedule.mock.calls) {
      const payload = call[2] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["actorUserId", "connectorAccountId", "kind"]);
      expect(JSON.stringify(payload)).not.toMatch(/password|secret|subject|body/i);
    }
  });
});
