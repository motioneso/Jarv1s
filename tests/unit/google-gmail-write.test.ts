import { describe, expect, it } from "vitest";

import { GoogleApiClient, type GoogleApiError } from "@jarv1s/connectors";

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(
  captured: CapturedRequest[],
  response: { ok: boolean; status: number; json: unknown }
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const initHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const [key, value] of Object.entries(initHeaders)) headers[key] = value;
    captured.push({
      url: url.toString(),
      method: init?.method,
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined
    });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.json
    } as Response;
  }) as unknown as typeof fetch;
}

describe("GoogleApiClient.createDraft", () => {
  it("POSTs a threaded draft with a base64url raw message", async () => {
    const captured: CapturedRequest[] = [];
    const client = new GoogleApiClient({
      fetchFn: fakeFetch(captured, { ok: true, status: 200, json: { id: "draft-1" } })
    });

    const result = await client.createDraft({
      accessToken: "token-abc",
      raw: "cmF3LW1lc3NhZ2U", // "raw-message" base64url, no padding
      threadId: "thread-9"
    });

    expect(result).toEqual({ id: "draft-1" });
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(req.method).toBe("POST");
    expect(req.headers.authorization).toBe("Bearer token-abc");
    expect(req.body).toEqual({ message: { raw: "cmF3LW1lc3NhZ2U", threadId: "thread-9" } });
  });

  it("wraps a non-2xx response in a GoogleApiError without leaking the body", async () => {
    const captured: CapturedRequest[] = [];
    const client = new GoogleApiClient({
      fetchFn: fakeFetch(captured, {
        ok: false,
        status: 403,
        json: { error: { message: "secret-detail" } }
      })
    });

    await expect(
      client.createDraft({ accessToken: "t", raw: "cmF3", threadId: "th" })
    ).rejects.toMatchObject({
      name: "GoogleApiError",
      statusCode: 403
    });
    await expect(
      client.createDraft({ accessToken: "t", raw: "cmF3", threadId: "th" })
    ).rejects.toSatisfy((err: GoogleApiError) => !err.message.includes("secret-detail"));
  });
});

describe("GoogleApiClient.sendMessage", () => {
  it("POSTs a threaded send with a base64url raw message", async () => {
    const captured: CapturedRequest[] = [];
    const client = new GoogleApiClient({
      fetchFn: fakeFetch(captured, {
        ok: true,
        status: 200,
        json: { id: "msg-1", threadId: "thread-9" }
      })
    });

    const result = await client.sendMessage({
      accessToken: "token-xyz",
      raw: "cmF3LW1lc3NhZ2U",
      threadId: "thread-9"
    });

    expect(result).toEqual({ id: "msg-1", threadId: "thread-9" });
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(req.method).toBe("POST");
    expect(req.headers.authorization).toBe("Bearer token-xyz");
    expect(req.body).toEqual({ raw: "cmF3LW1lc3NhZ2U", threadId: "thread-9" });
  });

  it("wraps a non-2xx response in a GoogleApiError", async () => {
    const captured: CapturedRequest[] = [];
    const client = new GoogleApiClient({
      fetchFn: fakeFetch(captured, { ok: false, status: 500, json: {} })
    });

    await expect(
      client.sendMessage({ accessToken: "t", raw: "cmF3", threadId: "th" })
    ).rejects.toMatchObject({ name: "GoogleApiError", statusCode: 500 });
  });
});
