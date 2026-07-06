import { describe, expect, it, vi } from "vitest";

import { reconcileGoogleAccountSchedule } from "../../packages/connectors/src/google-schedule.js";

describe("reconcileGoogleAccountSchedule", () => {
  it("schedules a 15-min cron keyed by actorUserId when connected", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };
    await reconcileGoogleAccountSchedule(boss as never, "actor-1", true);
    expect(schedule).toHaveBeenCalledWith(
      "connectors.google-sync",
      expect.any(String),
      { actorUserId: "actor-1" },
      { tz: "UTC", key: "actor-1" }
    );
  });

  it("unschedules when disconnected", async () => {
    const unschedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule: vi.fn(), unschedule };
    await reconcileGoogleAccountSchedule(boss as never, "actor-1", false);
    expect(unschedule).toHaveBeenCalledWith("connectors.google-sync", "actor-1");
  });
});
