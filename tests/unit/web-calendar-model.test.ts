import { describe, expect, it } from "vitest";

import type { CalendarEventDto } from "@jarv1s/shared";
import {
  dayKey,
  dtoToViewEvent,
  groupEventsByDay,
  type CalendarViewEvent
} from "../../apps/web/src/calendar/calendar-model.js";

// Pin a western timezone so all-day bucketing is exercised under the conditions
// that surfaced the bug. The model reads only local Date components, and it creates
// Dates lazily inside its functions (never at import time), so Node honours this
// runtime TZ for every Date the tests below construct.
process.env.TZ = "America/Los_Angeles";

function makeDto(overrides: Partial<CalendarEventDto>): CalendarEventDto {
  return {
    id: "evt-1",
    connectorAccountId: "conn-1",
    ownerUserId: "user-1",
    title: "Event",
    startsAt: "2026-06-20T16:00:00.000Z",
    endsAt: "2026-06-20T17:00:00.000Z",
    location: null,
    summary: null,
    bodyExcerpt: null,
    externalId: "ext-1",
    isJarvisBlock: false,
    allDay: false,
    attendeeCount: 0,
    status: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

describe("dtoToViewEvent all-day timezone bucketing", () => {
  it("anchors a UTC-midnight all-day event to its UTC date, not the local previous day", () => {
    // 2026-06-20T00:00:00Z reads as Jun 19 17:00 in America/Los_Angeles.
    const view = dtoToViewEvent(
      makeDto({
        id: "allday",
        allDay: true,
        startsAt: "2026-06-20T00:00:00.000Z",
        endsAt: "2026-06-21T00:00:00.000Z"
      })
    );
    expect(view).not.toBeNull();
    // June is month index 5; the event must land on the 20th, not the 19th.
    expect(dayKey(view!.date)).toBe("2026-5-20");
  });

  it("groups the all-day event under the Jun 20 cell key used by the day/month views", () => {
    const view = dtoToViewEvent(
      makeDto({
        id: "allday",
        allDay: true,
        startsAt: "2026-06-20T00:00:00.000Z",
        endsAt: "2026-06-21T00:00:00.000Z"
      })
    ) as CalendarViewEvent;
    const byDay = groupEventsByDay([view]);
    // A visible day cell for Jun 20 is a local Date; its lookup key must match.
    const jun20CellKey = dayKey(new Date(2026, 5, 20));
    expect(byDay.get(jun20CellKey)).toHaveLength(1);
    expect(byDay.get(dayKey(new Date(2026, 5, 19)))).toBeUndefined();
  });

  it("keeps timed events on their local day of the start instant", () => {
    // 2026-06-20T16:00:00Z is Jun 20 09:00 in America/Los_Angeles.
    const view = dtoToViewEvent(makeDto({ allDay: false })) as CalendarViewEvent;
    expect(dayKey(view.date)).toBe("2026-5-20");
    expect(view.startMin).toBe(9 * 60);
  });
});
