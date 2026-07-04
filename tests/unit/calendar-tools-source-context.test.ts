import { describe, expect, it, vi } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { calendarListVisibleEventsExecute } from "../../packages/calendar/src/tools.js";

const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;
const ctx: ToolContext = { actorUserId: "user-1", requestId: "req-1", chatSessionId: "" };

const account = {
  connectorAccountId: "acc-google",
  providerId: "google",
  providerLabel: "Google"
};

function contextItem(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: "evt-1",
    account,
    title: "Team sync",
    startsAt: "2026-07-03T15:00:00.000Z",
    endsAt: "2026-07-03T15:30:00.000Z",
    allDay: false,
    location: "Room 4",
    attendeeCount: 3,
    flags: ["has_location", "prep_attendees"],
    source: "live",
    degradedReason: null,
    ...overrides
  };
}

describe("calendarListVisibleEventsExecute (source context)", () => {
  it("fails closed when the sourceContext service is absent", async () => {
    await expect(calendarListVisibleEventsExecute(scopedDb, {}, ctx, {})).rejects.toThrow(
      "sourceContext service is not available"
    );
  });

  it("maps input window fields and serializes items, accounts, and gaps", async () => {
    const listCalendarContext = vi.fn(async () => ({
      items: [contextItem()],
      accounts: [{ account, source: "cache", degradedReason: "network_error" }],
      gaps: []
    }));
    const services = { sourceContext: { listEmailContext: vi.fn(), listCalendarContext } };
    const result = await calendarListVisibleEventsExecute(
      scopedDb,
      {
        startsAfter: "2026-07-03T12:00:00.000Z",
        startsBefore: "2026-07-05T12:00:00.000Z",
        limit: 5
      },
      ctx,
      services
    );
    expect(listCalendarContext).toHaveBeenCalledWith(scopedDb, {
      windowStart: "2026-07-03T12:00:00.000Z",
      windowEnd: "2026-07-05T12:00:00.000Z",
      limit: 5
    });
    const data = result.data as {
      events: Record<string, unknown>[];
      accounts: unknown[];
      gaps: unknown[];
    };
    expect(data.events).toEqual([
      {
        id: "evt-1",
        connectorAccountId: "acc-google",
        providerLabel: "Google",
        title: "Team sync",
        startsAt: "2026-07-03T15:00:00.000Z",
        endsAt: "2026-07-03T15:30:00.000Z",
        allDay: false,
        location: "Room 4",
        attendeeCount: 3,
        flags: ["has_location", "prep_attendees"],
        source: "live",
        degradedReason: null
      }
    ]);
    expect(data.accounts).toEqual([{ account, source: "cache", degradedReason: "network_error" }]);
    expect(data.gaps).toEqual([]);
  });

  it("omits window fields that are not strings", async () => {
    const listCalendarContext = vi.fn(async () => ({ items: [], accounts: [], gaps: [] }));
    const services = { sourceContext: { listEmailContext: vi.fn(), listCalendarContext } };
    await calendarListVisibleEventsExecute(scopedDb, { limit: -3 }, ctx, services);
    expect(listCalendarContext).toHaveBeenCalledWith(scopedDb, {});
  });
});
