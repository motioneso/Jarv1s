import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckinDto } from "@jarv1s/shared";
import { todaysCheckins } from "../../apps/web/src/wellness/wellness-today.js";

// Regression for #636 — the named bug: WellnessToday's todays-checkins filter did
// `.slice(0, 10)` on the UTC ISO timestamp instead of deriving the day in the user's
// resolved timezone, so a late-evening US check-in dropped off "today" a day early.

const TZ = "America/Los_Angeles"; // UTC-7 in June (PDT)

function checkin(id: string, checkedInAt: string): CheckinDto {
  return {
    id,
    ownerUserId: "u1",
    checkedInAt,
    feelingCore: "happy",
    feelingSecondary: null,
    feelingTertiary: null,
    wheelVersion: "1",
    sensations: [],
    intensity: null,
    energy: null,
    note: null,
    identifiedVia: "wheel",
    createdAt: checkedInAt
  };
}

describe("todaysCheckins — Friday 20:00 US-zone check-in (#636)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // "Now" = Friday 2026-06-19T23:30:00-07:00 = 2026-06-20T06:30:00Z (still Friday in LA).
    vi.setSystemTime(new Date("2026-06-20T06:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes a Friday-20:00-PDT check-in (UTC day already Saturday) under today", () => {
    // Friday 2026-06-19T20:00:00-07:00 = 2026-06-20T03:00:00Z — UTC day is Saturday,
    // but the LA-local day is still Friday, the same as "today".
    const checkins = [checkin("c1", "2026-06-20T03:00:00Z")];
    expect(todaysCheckins(checkins, TZ).map((c) => c.id)).toEqual(["c1"]);
  });

  it("excludes a Thursday-evening check-in once Friday has started locally", () => {
    // Thursday 2026-06-18T20:00:00-07:00 = 2026-06-19T03:00:00Z — local day is Thursday.
    const checkins = [checkin("c2", "2026-06-19T03:00:00Z")];
    expect(todaysCheckins(checkins, TZ)).toEqual([]);
  });
});
