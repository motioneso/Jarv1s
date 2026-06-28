import { describe, expect, it } from "vitest";

import type { BriefingDefinition } from "@jarv1s/db";

import { BRIEFINGS_RUN_QUEUE } from "../../packages/briefings/src/manifest.js";
import {
  cronExprFor,
  defaultScheduleMetadataFor,
  reconcileSchedule,
  timezoneFor
} from "../../packages/briefings/src/schedule.js";

describe("cronExprFor", () => {
  it("maps a HH:MM targetTime to a daily cron expression", () => {
    expect(cronExprFor("daily", { targetTime: "06:00" })).toBe("0 6 * * *");
    expect(cronExprFor("daily", { targetTime: "23:45" })).toBe("45 23 * * *");
  });

  it("defaults to 07:00 when targetTime is absent", () => {
    expect(cronExprFor("daily", {})).toBe("0 7 * * *");
  });

  it("defaults to 07:00 when targetTime is malformed", () => {
    expect(cronExprFor("daily", { targetTime: "not-a-time" })).toBe("0 7 * * *");
    expect(cronExprFor("daily", { targetTime: "25:00" })).toBe("0 7 * * *");
    expect(cronExprFor("daily", { targetTime: "6" })).toBe("0 7 * * *");
  });

  it("emits a day-of-week cron for weekly cadence", () => {
    expect(cronExprFor("weekly", { targetTime: "09:00", dayOfWeek: 0 })).toBe("0 9 * * 0");
    expect(cronExprFor("weekly", { targetTime: "09:00", dayOfWeek: 5 })).toBe("0 9 * * 5");
    expect(cronExprFor("weekly", { targetTime: "09:00" })).toBe("0 9 * * 1");
  });
});

describe("timezoneFor", () => {
  it("returns a valid IANA timezone", () => {
    expect(timezoneFor({ timezone: "America/New_York" })).toBe("America/New_York");
  });

  it("defaults to UTC when absent or invalid", () => {
    expect(timezoneFor({})).toBe("UTC");
    expect(timezoneFor({ timezone: "Not/AZone" })).toBe("UTC");
    expect(timezoneFor({ timezone: 42 as unknown as string })).toBe("UTC");
  });
});

describe("defaultScheduleMetadataFor", () => {
  it("defaults morning to 07:00 UTC", () => {
    expect(defaultScheduleMetadataFor("morning")).toEqual({ targetTime: "07:00", timezone: "UTC" });
  });

  it("defaults evening to 19:00 UTC", () => {
    expect(defaultScheduleMetadataFor("evening")).toEqual({ targetTime: "19:00", timezone: "UTC" });
  });

  it("defaults weekly_review to 09:00 UTC on Sunday", () => {
    expect(defaultScheduleMetadataFor("weekly_review")).toEqual({
      targetTime: "09:00",
      timezone: "UTC",
      dayOfWeek: 0
    });
  });
});

interface ScheduleCall {
  readonly name: string;
  readonly cron: string;
  readonly data: Record<string, unknown>;
  readonly options: { tz?: string; key?: string };
}

function fakeBoss() {
  const scheduleCalls: ScheduleCall[] = [];
  const unscheduleCalls: Array<{ name: string; key: string }> = [];
  return {
    scheduleCalls,
    unscheduleCalls,
    boss: {
      async schedule(name: string, cron: string, data: unknown, options: unknown) {
        scheduleCalls.push({
          name,
          cron,
          data: data as Record<string, unknown>,
          options: options as { tz?: string; key?: string }
        });
      },
      async unschedule(name: string, key: string) {
        unscheduleCalls.push({ name, key });
      }
    }
  };
}

function definition(overrides: Partial<BriefingDefinition>): BriefingDefinition {
  return {
    id: "def-1",
    owner_user_id: "owner-1",
    title: "Morning",
    cadence: "daily",
    schedule_metadata: { targetTime: "06:00", timezone: "America/New_York" },
    enabled: true,
    briefing_type: "morning",
    selected_tool_names: ["tasks.listVisible"],
    last_run_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  } as BriefingDefinition;
}

describe("reconcileSchedule", () => {
  it("schedules a daily enabled definition keyed by id with tz and metadata-only data", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({}));
    expect(unscheduleCalls).toHaveLength(0);
    expect(scheduleCalls).toHaveLength(1);
    const call = scheduleCalls[0]!;
    expect(call.name).toBe(BRIEFINGS_RUN_QUEUE);
    expect(call.cron).toBe("0 6 * * *");
    expect(call.options).toEqual({ tz: "America/New_York", key: "def-1" });
    expect(call.data).toEqual({
      actorUserId: "owner-1",
      definitionId: "def-1",
      runKind: "scheduled",
      briefingType: "morning"
    });
  });

  it("schedules a weekly enabled definition with day-of-week cron", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(
      boss as never,
      definition({
        cadence: "weekly",
        schedule_metadata: { targetTime: "09:00", timezone: "America/New_York", dayOfWeek: 0 }
      })
    );
    expect(unscheduleCalls).toHaveLength(0);
    expect(scheduleCalls).toHaveLength(1);
    expect(scheduleCalls[0]!.cron).toBe("0 9 * * 0");
    expect(scheduleCalls[0]!.options).toEqual({ tz: "America/New_York", key: "def-1" });
  });

  it("unschedules when cadence is manual", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({ cadence: "manual" }));
    expect(scheduleCalls).toHaveLength(0);
    expect(unscheduleCalls).toEqual([{ name: BRIEFINGS_RUN_QUEUE, key: "def-1" }]);
  });

  it("unschedules when disabled", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({ enabled: false }));
    expect(scheduleCalls).toHaveLength(0);
    expect(unscheduleCalls).toEqual([{ name: BRIEFINGS_RUN_QUEUE, key: "def-1" }]);
  });
});
