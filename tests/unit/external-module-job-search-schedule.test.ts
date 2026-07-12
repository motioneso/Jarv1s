// tests/unit/external-module-job-search-schedule.test.ts
//
// JS-05 (#934): DST-safe due-check math + per-monitor schedule state.
// All assertions use fixed UTC instants mapped through real IANA zones so the
// spring-forward / fall-back / no-catch-up guarantees are proved, not assumed.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  DUE_TIME_PATTERN,
  deleteMonitor,
  getScheduleState,
  isDue,
  isValidTimeZone,
  keys,
  localDateAndTime,
  saveMonitor,
  saveMonitorCursor,
  saveScheduleState
} from "../../external-modules/job-search/src/domain/index.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

describe("job-search schedule math", () => {
  it("exposes UTC/07:00 defaults and a strict HH:MM pattern", () => {
    expect(DEFAULT_TIMEZONE).toBe("UTC");
    expect(DEFAULT_DUE_TIME).toBe("07:00");
    expect(DUE_TIME_PATTERN.test("07:00")).toBe(true);
    expect(DUE_TIME_PATTERN.test("23:59")).toBe(true);
    expect(DUE_TIME_PATTERN.test("24:00")).toBe(false);
    expect(DUE_TIME_PATTERN.test("7:00")).toBe(false);
    expect(DUE_TIME_PATTERN.test("07:00:00")).toBe(false);
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("maps an instant to local date and time per zone", () => {
    const now = new Date("2026-07-11T02:30:00Z");
    expect(localDateAndTime(now, "UTC")).toEqual({ date: "2026-07-11", time: "02:30" });
    // EDT is UTC-4: 02:30Z is still the previous local day.
    expect(localDateAndTime(now, "America/New_York")).toEqual({
      date: "2026-07-10",
      time: "22:30"
    });
  });

  it("renders local midnight as 00:xx, never 24:xx (hourCycle h23)", () => {
    const midnight = new Date("2026-07-11T00:05:00Z");
    expect(localDateAndTime(midnight, "UTC").time).toBe("00:05");
  });

  it("throws a fixed domain error for a corrupt stored zone", () => {
    expect(() => localDateAndTime(new Date("2026-07-11T00:00:00Z"), "Not/AZone")).toThrow(
      JobSearchKvError
    );
    try {
      localDateAndTime(new Date("2026-07-11T00:00:00Z"), "Not/AZone");
    } catch (error) {
      // Fixed copy only — never the raw Intl message (could echo stored bytes).
      expect((error as Error).message).toBe("timezone is not a valid IANA time zone");
    }
  });

  it("is due only once the local clock passes dueTime", () => {
    const base = { timeZone: "UTC", dueTime: "07:00" };
    expect(isDue({ ...base, now: new Date("2026-07-11T06:59:00Z") })).toBe(false);
    expect(isDue({ ...base, now: new Date("2026-07-11T07:00:00Z") })).toBe(true);
    expect(isDue({ ...base, now: new Date("2026-07-11T23:00:00Z") })).toBe(true);
  });

  it("is not due again on a completed local date (double-tick → one run)", () => {
    expect(
      isDue({
        now: new Date("2026-07-11T08:00:00Z"),
        timeZone: "UTC",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-11"
      })
    ).toBe(false);
  });

  it("uses the MONITOR's local date, not UTC's", () => {
    // 2026-07-11T02:00Z = 2026-07-10 22:00 in New York: still the old local
    // day there, so a monitor completed on local 2026-07-10 is NOT due even
    // though the UTC date already rolled over.
    expect(
      isDue({
        now: new Date("2026-07-11T02:00:00Z"),
        timeZone: "America/New_York",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-10"
      })
    ).toBe(false);
  });

  it("spring forward: a due time inside the skipped hour runs on the first tick after the jump", () => {
    // America/New_York 2026-03-08: 02:00 EST jumps to 03:00 EDT — 02:30 never
    // occurs. 06:55Z = 01:55 EST (before, not due); 07:05Z = 03:05 EDT
    // (after, due) — same local date, exactly one run.
    const base = { timeZone: "America/New_York", dueTime: "02:30" };
    expect(isDue({ ...base, now: new Date("2026-03-08T06:55:00Z") })).toBe(false);
    expect(isDue({ ...base, now: new Date("2026-03-08T07:05:00Z") })).toBe(true);
    expect(
      isDue({
        ...base,
        now: new Date("2026-03-08T07:05:00Z"),
        lastCompletedLocalDate: "2026-03-08"
      })
    ).toBe(false);
  });

  it("fall back: the repeated hour does not run twice (date completion is authoritative)", () => {
    // America/New_York 2026-11-01: 01:30 occurs twice (05:30Z EDT, 06:30Z EST).
    const base = { timeZone: "America/New_York", dueTime: "01:30" };
    expect(isDue({ ...base, now: new Date("2026-11-01T05:35:00Z") })).toBe(true);
    // After the first pass completes the local date, the repeated hour no-ops.
    expect(
      isDue({
        ...base,
        now: new Date("2026-11-01T06:35:00Z"),
        lastCompletedLocalDate: "2026-11-01"
      })
    ).toBe(false);
  });

  it("no catch-up after downtime: only the current local date is compared", () => {
    // Last completed 4 days ago; the next tick is due exactly once (today),
    // never once-per-missed-day.
    expect(
      isDue({
        now: new Date("2026-07-11T09:00:00Z"),
        timeZone: "UTC",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-07"
      })
    ).toBe(true);
  });
});

describe("job-search schedule state", () => {
  it("round-trips state at the schedule/<id> key in NS.monitors", async () => {
    const kv = createMemoryKv();
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(keys.monitorSchedule("mon-1")).toBe("schedule/mon-1");
    expect(await kv.list(NS.monitors)).toContain("schedule/mon-1");
    expect(await getScheduleState(kv, "mon-1")).toEqual({
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await getScheduleState(kv, "mon-2")).toBeNull();
  });

  it("rejects invalid monitor ids without echoing them", async () => {
    const kv = createMemoryKv();
    await expect(getScheduleState(kv, "bad id!")).rejects.toThrow(JobSearchKvError);
  });

  it("deleteMonitor also drops schedule state (no orphaned slots)", async () => {
    const kv = createMemoryKv();
    const now = "2026-07-11T00:00:00.000Z";
    await saveMonitor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      adapterId: "greenhouse",
      enabled: true,
      query: { board: "acme" },
      createdAt: now,
      updatedAt: now
    });
    await saveMonitorCursor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      cursor: {},
      lastCheckedAt: now
    });
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await deleteMonitor(kv, "mon-1")).toBe(true);
    expect(await kv.list(NS.monitors)).toEqual([]);
  });
});
