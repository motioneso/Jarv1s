import { describe, expect, it } from "vitest";

import { computeInsights } from "@jarv1s/wellness";

// Regression for #772 — the low-adherence insight used to unconditionally append a fixed,
// fabricated specific ("a few evening doses slipped") whenever adherence dropped below 85%,
// regardless of whether any evening dose was actually involved. Insights are handed to
// clinicians via export, so the copy must only describe what the data actually shows.

const now = new Date("2026-06-15T12:00:00Z");

function checkins(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = String((i % 7) + 1).padStart(2, "0");
    return {
      feeling_core: "happy",
      intensity: 3,
      checked_in_at: `2026-06-${day}T09:00:00Z`,
      local_date: `2026-06-${day}`,
      note: null
    };
  });
}

describe("computeInsights — adherence copy does not invent specifics (#772)", () => {
  it("reports the actual missed-dose count instead of a fixed 'evening doses' claim", () => {
    const meds = [{ id: "med-1", frequency_type: "once_daily" }];
    // 2 taken; totalExpectedSlots=5 means 3 scheduled slots went unlogged (missed) entirely.
    const logs = [
      { medication_id: "med-1", scheduled_for: "2026-06-01T08:00:00Z", status: "taken" },
      { medication_id: "med-1", scheduled_for: "2026-06-02T08:00:00Z", status: "taken" }
    ];

    const result = computeInsights(
      checkins(7) as unknown as Parameters<typeof computeInsights>[0],
      logs as unknown as Parameters<typeof computeInsights>[1],
      meds as unknown as Parameters<typeof computeInsights>[2],
      now,
      5
    );

    const adherence = result.find((r) => r.key === "adherence");
    expect(adherence?.lead).toBe("40% adherence");
    expect(adherence?.rest).toContain("3 doses missed");
    expect(adherence?.rest).not.toContain("evening");
  });

  it("uses singular 'dose' when exactly one dose is missed", () => {
    const meds = [{ id: "med-1", frequency_type: "once_daily" }];
    const logs = [
      { medication_id: "med-1", scheduled_for: "2026-06-01T08:00:00Z", status: "taken" }
    ];

    const result = computeInsights(
      checkins(7) as unknown as Parameters<typeof computeInsights>[0],
      logs as unknown as Parameters<typeof computeInsights>[1],
      meds as unknown as Parameters<typeof computeInsights>[2],
      now,
      2
    );

    const adherence = result.find((r) => r.key === "adherence");
    expect(adherence?.rest).toContain("1 dose missed");
    expect(adherence?.rest).not.toContain("1 doses missed");
  });

  it("keeps the steady-state copy unchanged at/above the 85% threshold", () => {
    const meds = [{ id: "med-1", frequency_type: "once_daily" }];
    const logs = Array.from({ length: 9 }, (_, i) => ({
      medication_id: "med-1",
      scheduled_for: `2026-06-0${(i % 7) + 1}T08:00:00Z`,
      status: "taken"
    }));

    const result = computeInsights(
      checkins(7) as unknown as Parameters<typeof computeInsights>[0],
      logs as unknown as Parameters<typeof computeInsights>[1],
      meds as unknown as Parameters<typeof computeInsights>[2],
      now,
      10
    );

    const adherence = result.find((r) => r.key === "adherence");
    expect(adherence?.lead).toBe("90% adherence");
    expect(adherence?.rest).toContain("steady");
  });
});
