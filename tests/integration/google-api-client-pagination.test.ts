import { describe, expect, it } from "vitest";

import { GoogleApiClient } from "@jarv1s/connectors";

function captureFetch(body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("GoogleApiClient bounded pagination", () => {
  it("returns one bounded calendar page with its continuation cursor", async () => {
    const { calls, fetchFn } = captureFetch({
      items: [{ id: "a" }],
      nextPageToken: "CALENDAR_PAGE_2"
    });
    const client = new GoogleApiClient({ fetchFn });

    const page = await client.listCalendarEventsPage({
      accessToken: "tok",
      calendarId: "primary",
      timeMin: "2026-06-06T00:00:00.000Z",
      timeMax: "2026-07-13T00:00:00.000Z",
      maxResults: 100
    });

    expect(page).toEqual({ items: [{ id: "a" }], nextPageToken: "CALENDAR_PAGE_2" });
    expect(new URL(calls[0]!.url).searchParams.get("maxResults")).toBe("100");
    expect(calls).toHaveLength(1);
  });

  it("returns one eight-message page with its continuation cursor and an abort signal", async () => {
    const { calls, fetchFn } = captureFetch({
      messages: [{ id: "m1" }],
      nextPageToken: "MAIL_PAGE_2"
    });
    const client = new GoogleApiClient({ fetchFn });

    const page = await client.listMessageIdsPage({
      accessToken: "tok",
      query: "newer_than:30d",
      maxResults: 8
    });

    expect(page).toEqual({ messages: [{ id: "m1" }], nextPageToken: "MAIL_PAGE_2" });
    expect(new URL(calls[0]!.url).searchParams.get("maxResults")).toBe("8");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls).toHaveLength(1);
  });
});
