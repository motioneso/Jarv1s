import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_SYNC_SWEEP_QUEUE,
  reconcileGoogleSyncSweepSchedule
} from "../../packages/connectors/src/google-sync-sweep.js";

describe("reconcileGoogleSyncSweepSchedule", () => {
  it("registers a fixed-key recurring schedule with a metadata-only payload", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };

    await reconcileGoogleSyncSweepSchedule(boss as never);

    expect(schedule).toHaveBeenCalledTimes(1);
    const [queue, cron, data, options] = schedule.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      { tz: string; key: string }
    ];
    expect(queue).toBe(GOOGLE_SYNC_SWEEP_QUEUE);
    // Must not tighten below PROACTIVE_SCAN_SOURCE_QUEUE's 30-minute cadence
    // (module-registry/src/index.ts PROACTIVE_CHECK_CRON) without documented reason.
    expect(cron).toBe("*/30 * * * *");
    expect(data).toEqual({ kind: "google-sync-sweep" });
    expect(Object.keys(data)).toEqual(["kind"]);
    expect(options).toEqual({ tz: "UTC", key: "google-sync-sweep" });
  });

  it("uses a single fixed schedule key regardless of how often it is reconciled", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };

    await reconcileGoogleSyncSweepSchedule(boss as never);
    await reconcileGoogleSyncSweepSchedule(boss as never);

    const keys = schedule.mock.calls.map((call) => (call[3] as { key: string }).key);
    expect(keys).toEqual(["google-sync-sweep", "google-sync-sweep"]);
  });
});
