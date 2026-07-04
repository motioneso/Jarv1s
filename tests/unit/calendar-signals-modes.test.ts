import { describe, expect, it } from "vitest";

import { deriveCalendarSignals } from "../../packages/briefings/src/signals.js";
import { deriveBriefingFeedbackItems } from "../../packages/briefings/src/feedback-targets.js";

const baseEvent = {
  id: "evt-1",
  title: "Client presentation prep",
  startsAt: "2026-07-04T16:00:00.000Z",
  endsAt: "2026-07-04T17:00:00.000Z",
  attendeeCount: 6
};
const laterEvent = {
  id: "evt-2",
  title: "Team review",
  startsAt: "2026-07-04T19:00:00.000Z",
  endsAt: "2026-07-04T20:00:00.000Z",
  attendeeCount: 2
};

function actions(
  prepTaskMode: "off" | "suggest" | "auto",
  timeBlockMode: "off" | "suggest" | "auto"
) {
  return deriveCalendarSignals({
    items: [baseEvent, laterEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
    timeZone: "UTC",
    context: new Set(),
    settings: { lookaheadDays: 2, prepTaskMode, timeBlockMode, commitmentMode: "off" }
  }).flatMap((signal) => signal.suggestedActions);
}

describe("Calendar signal automation modes", () => {
  it("off emits no task or time-block actions", () => {
    expect(actions("off", "off")).not.toContain("suggest_task");
    expect(actions("off", "off")).not.toContain("create_task");
    expect(actions("off", "off")).not.toContain("suggest_time_block");
    expect(actions("off", "off")).not.toContain("block_time");
  });

  it("suggest emits suggestions without auto actions", () => {
    const result = actions("suggest", "suggest");

    expect(result).toContain("suggest_task");
    expect(result).toContain("suggest_time_block");
    expect(result).not.toContain("create_task");
    expect(result).not.toContain("block_time");
  });

  it("auto emits create/block actions", () => {
    const result = actions("auto", "auto");

    expect(result).toContain("create_task");
    expect(result).toContain("block_time");
  });

  it("feedback target metadata carries Calendar follow-through refs", () => {
    const [item] = deriveBriefingFeedbackItems({
      calendarSignals: [
        {
          type: "prep_needed",
          summary: "Client presentation prep likely needs prep before it starts.",
          suggestedActions: ["create_task"],
          followThrough: { targetRef: "calendar:prep:1", taskId: "task-1" }
        }
      ]
    });

    expect(item?.metadata).toMatchObject({
      signalType: "prep_needed",
      calendarFollowThrough: { targetRef: "calendar:prep:1", taskId: "task-1" }
    });
  });
});
