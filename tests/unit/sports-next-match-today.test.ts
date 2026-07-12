import { describe, expect, it } from "vitest";

import type { FollowedNextMatch, LocaleSettingsDto } from "@jarv1s/shared";

import { nextMatchIsToday } from "../../packages/sports/src/web/sports-ticker.js";

// Issue #877 finding 1: the sports "Today" next-match footer used to be driven by
// card.status === "today" (ESPN-Eastern, stays true after today's game goes final) instead of
// the fixture's own instant in the user's persisted locale. This pins nextMatchIsToday's pure
// day-comparison so a regression can't slip the ambient/ESPN-Eastern behavior back in.
function nextMatch(overrides: Partial<FollowedNextMatch> = {}): FollowedNextMatch {
  return {
    opponentName: "Green Bay Packers",
    homeAway: "home",
    startsAt: "2026-07-10T01:40:00Z",
    ...overrides
  };
}

const PT_LOCALE: LocaleSettingsDto = {
  timezone: "America/Los_Angeles",
  region: "en-US",
  dateFormat: "12"
};

describe("nextMatchIsToday", () => {
  it("is false when the fixture's local day is tomorrow, even though the UTC day matches", () => {
    // Fixture at 2026-07-10T01:40:00Z = 6:40 PM PT on 7/9. now = 2026-07-09T05:00:00Z = 10 PM PT
    // on 7/8. Both instants fall on UTC day 7/9 (or 7/10) — a UTC-day comparison would misfire —
    // but in America/Los_Angeles the fixture is 7/9 and "now" is still 7/8, so it's not today.
    const now = new Date("2026-07-09T05:00:00Z");
    expect(nextMatchIsToday(nextMatch(), PT_LOCALE, now)).toBe(false);
  });

  it("is true once the user's local day has rolled to the fixture's local day", () => {
    // Same fixture; now = 2026-07-09T20:00:00Z = 1 PM PT on 7/9, matching the fixture's PT day.
    const now = new Date("2026-07-09T20:00:00Z");
    expect(nextMatchIsToday(nextMatch(), PT_LOCALE, now)).toBe(true);
  });
});
