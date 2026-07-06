import { describe, expect, it } from "vitest";

import { computeInsights } from "@jarv1s/wellness";

// Regression for #326/#771 — weekday attribution (hardest/strongest day insight) must use the
// check-in's *local* calendar day, never the UTC day. The old code called `.getUTCDay()` on
// `checked_in_at`, so a late-night check-in for a user west of UTC was silently bucketed under
// the *next* day (an 11pm Tuesday check-in in UTC-8 counted as Wednesday).

const now = new Date("2026-06-15T12:00:00Z"); // Monday

describe("computeInsights — weekday attribution uses local_date, not UTC (#326/#771)", () => {
  it("buckets a late-night check-in by its local calendar day, not the UTC day it rolled into", () => {
    // Two check-ins at 2026-06-09T06:30Z / 07:30Z — 22:30 / 23:30 the *evening before* in
    // UTC-8 (America/Los_Angeles). UTC calendar day = Tuesday 2026-06-09; local calendar day =
    // Monday 2026-06-08. Both are "sad" (off-track) so this bucket alone crosses the 80%
    // hardest-day threshold. One low-volume "happy" filler on each of Wed-Sun keeps every other
    // weekday bucket below the total>=2 threshold, so only the local-vs-UTC bucket can produce
    // a "hardest" insight — proving which day it actually attributes to.
    const target = ["2026-06-09T06:30:00Z", "2026-06-09T07:30:00Z"].map((checkedInAt) => ({
      feeling_core: "sad",
      intensity: 3,
      checked_in_at: checkedInAt,
      local_date: "2026-06-08", // Monday — the correct local day in UTC-8
      note: null
    }));
    const filler = ["2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"].map(
      (localDate) => ({
        feeling_core: "happy",
        intensity: 3,
        checked_in_at: `${localDate}T12:00:00Z`,
        local_date: localDate,
        note: null
      })
    );
    const checkins = [...target, ...filler] as unknown as Parameters<typeof computeInsights>[0];

    const result = computeInsights(checkins, [], [], now);
    const hardest = result.find((r) => r.key === "hardest");
    expect(hardest?.lead).toBe("Mondays");
  });

  it("falls back to the UTC day of checked_in_at when local_date is NULL (pre-#771 rows)", () => {
    const target = ["2026-06-09T06:30:00Z", "2026-06-09T07:30:00Z"].map((checkedInAt) => ({
      feeling_core: "sad",
      intensity: 3,
      checked_in_at: checkedInAt,
      local_date: null,
      note: null
    }));
    const filler = ["2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"].map(
      (localDate) => ({
        feeling_core: "happy",
        intensity: 3,
        checked_in_at: `${localDate}T12:00:00Z`,
        local_date: null,
        note: null
      })
    );
    const checkins = [...target, ...filler] as unknown as Parameters<typeof computeInsights>[0];

    const result = computeInsights(checkins, [], [], now);
    const hardest = result.find((r) => r.key === "hardest");
    expect(hardest?.lead).toBe("Tuesdays");
  });
});
