import { describe, expect, it } from "vitest";

import { computeNextOccurrenceDate, advanceDate, nextOccurrenceAtOrAfter } from "@jarv1s/tasks";

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
});
