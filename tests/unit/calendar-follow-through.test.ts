import { describe, expect, it } from "vitest";

import {
  calendarFollowThroughSourceRef,
  isCalendarFollowThroughEvent,
  isCalendarFollowThroughTask
} from "@jarv1s/calendar";

describe("Calendar follow-through provenance", () => {
  it("builds stable Calendar-owned source refs for briefing items", () => {
    expect(calendarFollowThroughSourceRef("calendar:prep:abc")).toBe(
      "calendar:briefing-item:calendar:prep:abc"
    );
  });

  it("accepts only Calendar-created tasks with the exact source ref", () => {
    const sourceRef = calendarFollowThroughSourceRef("target-a");

    expect(
      isCalendarFollowThroughTask({ source: "calendar", source_ref: sourceRef }, sourceRef)
    ).toBe(true);
    expect(
      isCalendarFollowThroughTask({ source: "manual", source_ref: sourceRef }, sourceRef)
    ).toBe(false);
    expect(
      isCalendarFollowThroughTask(
        { source: "calendar", source_ref: calendarFollowThroughSourceRef("target-b") },
        sourceRef
      )
    ).toBe(false);
  });

  it("accepts only Jarv1s-created calendar rows with the exact target ref", () => {
    expect(
      isCalendarFollowThroughEvent(
        {
          external_metadata: {
            jarvisCreated: true,
            followThroughTargetRef: "target-a"
          }
        },
        "target-a"
      )
    ).toBe(true);
    expect(
      isCalendarFollowThroughEvent(
        { external_metadata: { jarvisCreated: true, followThroughTargetRef: "target-b" } },
        "target-a"
      )
    ).toBe(false);
    expect(
      isCalendarFollowThroughEvent(
        { external_metadata: { followThroughTargetRef: "target-a" } },
        "target-a"
      )
    ).toBe(false);
  });
});
