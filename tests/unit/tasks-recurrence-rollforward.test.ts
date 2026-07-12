import { describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";

import type { DataContextDb } from "@jarv1s/db";
import {
  computeNextOccurrenceDate,
  advanceDate,
  nextOccurrenceAtOrAfter,
  recurrenceCronExpr,
  reconcileRecurrenceSchedule,
  parseRecurrenceSpec,
  rollForwardRecurringSeries,
  rollForwardOwnedSeries
} from "@jarv1s/tasks";

describe("recurrence date helpers", () => {
  it("computeNextOccurrenceDate advances weekly by interval", () => {
    expect(
      computeNextOccurrenceDate({ freq: "weekly", interval: 1, occurrence_date: "2026-06-08" })
    ).toBe("2026-06-15");
  });

  it("computeNextOccurrenceDate clamps month-end overflow (Jan 31 -> Feb 28, not Mar 3)", () => {
    expect(
      computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2026-01-31" })
    ).toBe("2026-02-28"); // 2026 is not a leap year
    expect(
      computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2028-01-31" })
    ).toBe("2028-02-29"); // leap year clamps to the 29th
  });

  it("computeNextOccurrenceDate advances monthly without overflow when the day exists", () => {
    expect(
      computeNextOccurrenceDate({ freq: "monthly", interval: 1, occurrence_date: "2026-03-15" })
    ).toBe("2026-04-15");
  });

  it("advanceDate shifts a Date by the occurrence delta", () => {
    const shifted = advanceDate(new Date("2026-06-08T09:00:00.000Z"), "2026-06-08", "2026-06-15");
    expect(shifted?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });
});

describe("nextOccurrenceAtOrAfter (roll-forward date math)", () => {
  const spec = { freq: "weekly", interval: 1, occurrence_date: "2026-06-01" } as const;

  it("returns the same date when occurrence is already at/after today", () => {
    expect(nextOccurrenceAtOrAfter(spec, "2026-06-01")).toBe("2026-06-01");
    expect(nextOccurrenceAtOrAfter(spec, "2026-05-31")).toBe("2026-06-01");
  });

  it("rolls a multi-skip series forward to the first occurrence >= today in one pass", () => {
    // five weekly cadences in the past relative to today 2026-07-06:
    expect(nextOccurrenceAtOrAfter(spec, "2026-07-06")).toBe("2026-07-06");
  });

  it("does not roll an occurrence that equals today (boundary)", () => {
    expect(nextOccurrenceAtOrAfter(spec, "2026-06-01")).toBe("2026-06-01");
  });

  it("#877 finding 2: a series still due on the actor's local day is not rolled forward, even when the UTC calendar day has already advanced", () => {
    // Scenario: it's 2026-07-08 in America/Los_Angeles (5 PM+ PT) but already
    // 2026-07-09 UTC. A daily series with occurrence_date 2026-07-08 must stay put
    // when the CALLER correctly derives `today` from the actor's tz ("2026-07-08"),
    // not from `new Date().toISOString().slice(0, 10)` (which would yield "2026-07-09"
    // and wrongly roll a still-due task to tomorrow). This pins the contract that made
    // `today` a required param on rollForwardRecurringSeries/rollForwardOwnedSeries.
    const dailySpec = { freq: "daily", interval: 1, occurrence_date: "2026-07-08" } as const;
    expect(nextOccurrenceAtOrAfter(dailySpec, "2026-07-08")).toBe("2026-07-08");
    // The buggy UTC-default day would have rolled it forward instead:
    expect(nextOccurrenceAtOrAfter(dailySpec, "2026-07-09")).toBe("2026-07-09");
  });
});

describe("rollForwardRecurringSeries / rollForwardOwnedSeries — `today` is a required param (#877 finding 2, type-level)", () => {
  it("does not compile with a zero-arg day (no UTC-default fallback)", () => {
    // Never invoked at runtime — this function exists purely so tsc type-checks the
    // calls below. Both roll-forward functions used to default `today` to the
    // server's UTC day, which every real caller silently relied on. Deleting that
    // default was the fix; these @ts-expect-error lines fail `pnpm typecheck` if the
    // default (or an optional `today?`) is ever reintroduced.
    const assertTodayIsRequired = (db: DataContextDb): void => {
      // @ts-expect-error `today` is required on rollForwardRecurringSeries.
      void rollForwardRecurringSeries(db, "11111111-1111-1111-1111-111111111111");
      // @ts-expect-error `today` is required on rollForwardOwnedSeries.
      void rollForwardOwnedSeries(db);
    };
    void assertTodayIsRequired;
    expect(true).toBe(true);
  });
});

describe("nextOccurrenceAtOrAfter — monthly multi-skip + month-end clamp composition", () => {
  it("monthly multi-skip across a year boundary advances to the first occurrence >= today in one pass", () => {
    // Anchor Oct 31 2025, monthly. Roll forward to today 2026-03-01.
    // The first clamp (Oct 31 -> Nov 30) degrades the moving anchor to day 30, so the
    // chain is Oct 31 -> Nov 30 -> Dec 30 -> Jan 30 -> Feb 28 (clamp) -> Mar 28 (>= today).
    expect(
      nextOccurrenceAtOrAfter(
        { freq: "monthly", interval: 1, occurrence_date: "2025-10-31" },
        "2026-03-01"
      )
    ).toBe("2026-03-28");
  });

  it("monthly multi-skip from a month-end date keeps clamping correctly across several skips (never overflows the month)", () => {
    // Anchor Jan 31 2026, monthly. The clamp composes through nextOccurrenceAtOrAfter:
    // Jan 31 -> Feb 28 (clamp; 2026 is not a leap year) -> Mar 28 -> Apr 28 -> May 28 (>= today).
    // Critically it never overflows into the wrong month (e.g. never lands on Mar 3 from Feb+31d).
    expect(
      nextOccurrenceAtOrAfter(
        { freq: "monthly", interval: 1, occurrence_date: "2026-01-31" },
        "2026-05-15"
      )
    ).toBe("2026-05-28");
  });

  it("monthly is a no-op when the stored occurrence is already at/after today (already current)", () => {
    expect(
      nextOccurrenceAtOrAfter(
        { freq: "monthly", interval: 1, occurrence_date: "2026-06-15" },
        "2026-06-01"
      )
    ).toBe("2026-06-15");
  });

  it("monthly does not roll an occurrence that equals today (today boundary)", () => {
    expect(
      nextOccurrenceAtOrAfter(
        { freq: "monthly", interval: 1, occurrence_date: "2026-06-13" },
        "2026-06-13"
      )
    ).toBe("2026-06-13");
  });
});

describe("recurrenceCronExpr", () => {
  it("returns the documented pre-dawn daily cron expression", () => {
    expect(recurrenceCronExpr()).toBe("0 3 * * *");
  });
});

describe("reconcileRecurrenceSchedule (failure isolation)", () => {
  it("swallows boss.schedule errors and never throws to the caller", async () => {
    const boss = {
      schedule: async () => {
        throw new Error("boom");
      }
    } as unknown as PgBoss;
    await expect(
      reconcileRecurrenceSchedule(boss, "11111111-1111-1111-1111-111111111111")
    ).resolves.toBeUndefined();
  });

  it("passes a metadata-only payload through the assertMetadataOnlyPayload guard to boss.schedule", async () => {
    // Defense-in-depth: boss.schedule bypasses sendJob's metadata guard, so reconcile asserts
    // the payload is metadata-only before scheduling. A valid {actorUserId} payload (the only key)
    // must pass the guard and reach boss.schedule unchanged — no extra/content keys leak in.
    let captured: Record<string, unknown> | undefined;
    const boss = {
      schedule: async (_name: string, _cron: string, data: Record<string, unknown>) => {
        captured = data;
      }
    } as unknown as PgBoss;

    await reconcileRecurrenceSchedule(boss, "11111111-1111-1111-1111-111111111111");

    expect(captured).toEqual({ actorUserId: "11111111-1111-1111-1111-111111111111" });
    // Only the allowed metadata key — no content/secret drift.
    expect(Object.keys(captured ?? {})).toEqual(["actorUserId"]);
  });
});

describe("parseRecurrenceSpec — valid persisted shapes", () => {
  it("accepts a daily spec and returns a normalized object", () => {
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" })
    ).toEqual({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" });
  });

  it("accepts weekly and monthly freqs", () => {
    expect(
      parseRecurrenceSpec({ freq: "weekly", interval: 2, occurrence_date: "2026-06-08" })
    ).toEqual({ freq: "weekly", interval: 2, occurrence_date: "2026-06-08" });
    expect(
      parseRecurrenceSpec({ freq: "monthly", interval: 3, occurrence_date: "2026-01-31" })
    ).toEqual({ freq: "monthly", interval: 3, occurrence_date: "2026-01-31" });
  });

  it("strips unknown keys, returning only the three canonical fields", () => {
    expect(
      parseRecurrenceSpec({
        freq: "daily",
        interval: 1,
        occurrence_date: "2026-06-08",
        injected: "ignore-me",
        occurrence_count: 99
      })
    ).toEqual({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" });
  });
});

describe("parseRecurrenceSpec — malformed persisted shapes return null", () => {
  it("rejects nullish and non-object values", () => {
    expect(parseRecurrenceSpec(null)).toBeNull();
    expect(parseRecurrenceSpec(undefined)).toBeNull();
    expect(parseRecurrenceSpec("not-an-object")).toBeNull();
    expect(parseRecurrenceSpec(42)).toBeNull();
    expect(parseRecurrenceSpec(["freq", "daily"])).toBeNull();
  });

  it("rejects unknown or missing freq", () => {
    expect(parseRecurrenceSpec({ interval: 1, occurrence_date: "2026-06-08" })).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "yearly", interval: 1, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "", interval: 1, occurrence_date: "2026-06-08" })
    ).toBeNull();
  });

  it("rejects non-positive, non-integer, or non-numeric interval", () => {
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 0, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: -1, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1.5, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: "1", occurrence_date: "2026-06-08" })
    ).toBeNull();
  });

  it("rejects a missing, mistyped, or malformed occurrence_date", () => {
    expect(parseRecurrenceSpec({ freq: "daily", interval: 1 })).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: 20260608 })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-6-8" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-13-01" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-02-30" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "not-a-date" })
    ).toBeNull();
  });
});
