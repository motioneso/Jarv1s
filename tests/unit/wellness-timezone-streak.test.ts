import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckinDto } from "@jarv1s/shared";
import {
  localDateFromTimestamp,
  computeStreak
} from "../../apps/web/src/wellness/wellness-date-utils.js";

// Regression for issue #579 — UTC+12/+13/+14 streak correctness.
//
// The old `computeStreak` used `Date.UTC(y, m-1, d-i, 12)` as a backward-walk anchor.
// In Pacific/Auckland (UTC+12), noon UTC = midnight Auckland = start of the NEXT local
// calendar day, so i=1 resolved to "today" rather than "yesterday" and the streak
// under-counted for every far-east-of-UTC user.
//
// The fix derives the local calendar date from the stored timestamp via
// Intl.DateTimeFormat("en-CA") before keying the seen-set, and walks backward with
// pure calendar arithmetic (no hour anchor) so the local date is always correct.

const TZ = "Pacific/Auckland"; // UTC+12 in NZ winter (June)

// Fake "now" = 2026-06-29T02:00:00Z
// Auckland local date = 2026-06-29 (2am UTC = 2pm local NZST)
const NOW_UTC = "2026-06-29T02:00:00Z";

// Auckland noon = 12:00+12:00 = UTC 00:00 same calendar day.
// So "2026-06-28T00:00:00Z" is noon on June 28 Auckland → local date "2026-06-28".
// And "2026-06-28T12:00:00Z" = midnight Auckland June 29 → local date "2026-06-29".

function checkin(checkedInAt: string): CheckinDto {
  return {
    id: checkedInAt,
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

describe("localDateFromTimestamp — Pacific/Auckland UTC+12 boundary", () => {
  it("returns the prior calendar day for a timestamp just before Auckland midnight", () => {
    // 2026-06-28T11:59:00Z = 2026-06-28T23:59:00+12 → local date 2026-06-28
    expect(localDateFromTimestamp("2026-06-28T11:59:00Z", TZ)).toBe("2026-06-28");
  });

  it("returns the next calendar day for a timestamp at Auckland midnight", () => {
    // 2026-06-28T12:00:00Z = 2026-06-29T00:00:00+12 → local date 2026-06-29.
    // This was the exact value the old UTC-noon anchor produced for i=1 from today=June-29,
    // wrongly mapping "yesterday" to "today" and breaking streak counting.
    expect(localDateFromTimestamp("2026-06-28T12:00:00Z", TZ)).toBe("2026-06-29");
  });
});

describe("computeStreak — Pacific/Auckland", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_UTC));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 3 for three consecutive days ending yesterday", () => {
    // now = June 29 Auckland; yesterday = June 28, day before = June 27, etc.
    // Timestamps use noon Auckland (= UTC 00:00 same day) to stay clear of the boundary.
    const checkins = [
      checkin("2026-06-26T00:00:00Z"), // noon June 26 Auckland → local 2026-06-26
      checkin("2026-06-27T00:00:00Z"), // noon June 27 Auckland → local 2026-06-27
      checkin("2026-06-28T00:00:00Z") // noon June 28 Auckland → local 2026-06-28 (yesterday)
    ];
    expect(computeStreak(checkins, TZ)).toBe(3);
  });

  it("returns 0 when only today has a checkin (today not counted in backward walk)", () => {
    // now = June 29 Auckland; checkin at noon June 29 → local date June 29 = today
    const checkins = [checkin("2026-06-29T00:00:00Z")];
    expect(computeStreak(checkins, TZ)).toBe(0);
  });

  it("returns 1 and stops at the gap (June 28 yes, June 27 no, June 26 yes)", () => {
    const checkins = [
      checkin("2026-06-26T00:00:00Z"), // local 2026-06-26
      checkin("2026-06-28T00:00:00Z") // local 2026-06-28 (yesterday)
    ];
    expect(computeStreak(checkins, TZ)).toBe(1);
  });
});
