import { describe, expect, it, vi } from "vitest";

import { reconcileImapAccountSchedule } from "../../packages/connectors/src/imap-schedule.js";

describe("reconcileImapAccountSchedule", () => {
  it("schedules a 15-min cron keyed by connectorAccountId when connected", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };
    await reconcileImapAccountSchedule(boss as never, "account-1", true);
    expect(schedule).toHaveBeenCalledWith(
      "connectors.imap-sync",
      expect.any(String),
      { connectorAccountId: "account-1" },
      { tz: "UTC", key: "account-1" }
    );
  });

  it("unschedules when disconnected", async () => {
    const unschedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule: vi.fn(), unschedule };
    await reconcileImapAccountSchedule(boss as never, "account-1", false);
    expect(unschedule).toHaveBeenCalledWith("connectors.imap-sync", "account-1");
  });

  it("never includes password/secret fields in the scheduled payload", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };
    await reconcileImapAccountSchedule(boss as never, "account-1", true);
    const [, , payload] = schedule.mock.calls[0] ?? [];
    expect(Object.keys(payload)).toEqual(["connectorAccountId"]);
    expect(JSON.stringify(payload)).not.toMatch(/password|secret/i);
  });
});
