import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import {
  makeCalendarListLiveEventsExecute,
  makeGmailGetLiveMessageExecute,
  makeGmailSearchLiveExecute
} from "@jarv1s/connectors";
import type { ToolContext } from "@jarv1s/module-sdk";

const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;
const toolCtx: ToolContext = {
  actorUserId: "00000000-0000-0000-0000-000000000001",
  requestId: "req",
  chatSessionId: "chat"
};

function depsFor(grants: { readonly email: boolean; readonly calendar: boolean }) {
  let googleCalls = 0;
  const deps = {
    googleService: {
      getFreshAccessToken: async () => {
        googleCalls += 1;
        return "token";
      }
    },
    connectorsRepository: {
      getActiveGoogleAccountSecret: async () => ({
        id: "00000000-0000-0000-0000-00000000fa00",
        encryptedSecret: {} as never
      })
    },
    preferencesRepository: { get: async () => grants },
    googleClient: {
      listMessageIds: async () => {
        googleCalls += 1;
        return [];
      },
      getMessage: async () => {
        googleCalls += 1;
        return { id: "m1" };
      },
      listCalendarEvents: async () => {
        googleCalls += 1;
        return [];
      }
    }
  };
  return { deps, googleCalls: () => googleCalls };
}

describe("live Google tool feature grants", () => {
  it("blocks live Gmail search before token or API calls when email grant is off", async () => {
    const { deps, googleCalls } = depsFor({ email: false, calendar: true });
    const result = await makeGmailSearchLiveExecute(deps)(scopedDb, {}, toolCtx);

    expect(googleCalls()).toBe(0);
    expect(result.data).toEqual({
      error: "Email access disabled for this account",
      code: "CONNECTOR_FEATURE_GRANT_DISABLED"
    });
  });

  it("blocks live Gmail message fetch before token or API calls when email grant is off", async () => {
    const { deps, googleCalls } = depsFor({ email: false, calendar: true });
    const result = await makeGmailGetLiveMessageExecute(deps)(scopedDb, { id: "m1" }, toolCtx);

    expect(googleCalls()).toBe(0);
    expect(result.data).toEqual({
      error: "Email access disabled for this account",
      code: "CONNECTOR_FEATURE_GRANT_DISABLED"
    });
  });

  it("blocks live calendar list before token or API calls when calendar grant is off", async () => {
    const { deps, googleCalls } = depsFor({ email: true, calendar: false });
    const result = await makeCalendarListLiveEventsExecute(deps)(scopedDb, {}, toolCtx);

    expect(googleCalls()).toBe(0);
    expect(result.data).toEqual({
      error: "Calendar access disabled for this account",
      code: "CONNECTOR_FEATURE_GRANT_DISABLED"
    });
  });
});
