import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import { buildCalendarWriteService } from "@jarv1s/chat";

const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;

describe("calendar write feature grants", () => {
  it("blocks calendar writes before Google calls when calendar grant is off", async () => {
    let googleCalls = 0;
    let cacheCalls = 0;
    const service = buildCalendarWriteService({
      connectorsRepository: {
        getCalendarWriteScopeState: async () => ({
          accountId: "00000000-0000-0000-0000-00000000ca10",
          hasScope: true
        })
      },
      preferencesRepository: { get: async () => ({ email: true, calendar: false }) },
      googleService: {
        getFreshAccessToken: async () => {
          googleCalls += 1;
          return "token";
        }
      },
      googleApiClient: {
        freeBusy: async () => {
          googleCalls += 1;
          return { busy: [] };
        },
        insertEvent: async () => {
          googleCalls += 1;
          return { id: "evt" };
        }
      },
      calendarRepository: {
        upsertCachedEvent: async () => {
          cacheCalls += 1;
          return {} as never;
        }
      }
    } as never);

    const result = await service.proposeAndInsert(
      scopedDb,
      {
        actorUserId: "00000000-0000-0000-0000-000000000001",
        requestId: "req",
        chatSessionId: "chat"
      },
      {
        start: new Date("2026-06-17T13:00:00Z"),
        end: new Date("2026-06-17T16:00:00Z"),
        durationMinutes: 60,
        title: "Focus"
      }
    );

    expect(result.created).toBe(false);
    expect(result.message).toBe("Calendar access is disabled for this account in Settings.");
    expect(googleCalls).toBe(0);
    expect(cacheCalls).toBe(0);
  });
});
