import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerRequestTimeZoneHook } from "../../apps/api/src/server.js";
import {
  beaconEndPrivateChat,
  endPrivateChat,
  listActionAuditLog,
  requestJson
} from "../../apps/web/src/api/client.js";
import { resolveRequestTimeZoneForRoute } from "../../packages/module-registry/src/index.js";

describe("web API timezone header", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the browser timezone on central JSON requests", async () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: vi.fn(() => ({
        resolvedOptions: () => ({ timeZone: "America/New_York" })
      }))
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestJson("/api/example");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-Timezone")).toBe("America/New_York");
  });

  it("keeps a caller-provided timezone header", async () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: vi.fn(() => ({
        resolvedOptions: () => ({ timeZone: "America/New_York" })
      }))
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestJson("/api/example", { headers: { "X-Timezone": "Europe/London" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-Timezone")).toBe("Europe/London");
  });

  it("posts the private chat end endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await endPrivateChat();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/private/end",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses sendBeacon for best-effort private chat unload cleanup", () => {
    const sendBeacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon });

    beaconEndPrivateChat();

    expect(sendBeacon).toHaveBeenCalledWith("/api/chat/private/end", "");
  });

  it("bounds action audit requests", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | null | undefined;
      const fetchMock = vi.fn<typeof fetch>((_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const request = listActionAuditLog();
      const outcome = request.then(
        () => null,
        (error: unknown) => error
      );
      await Promise.resolve();
      expect(requestSignal).toBeInstanceOf(AbortSignal);

      await vi.advanceTimersByTimeAsync(3001);
      await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("API request timezone hook", () => {
  it("stores valid IANA timezone headers on the request", async () => {
    const app = Fastify();
    registerRequestTimeZoneHook(app);
    app.get("/probe", async (request) => ({ timeZone: request.timeZone ?? null }));
    await app.ready();
    try {
      const res = await app.inject({ url: "/probe", headers: { "x-timezone": "America/Denver" } });
      expect(res.json()).toEqual({ timeZone: "America/Denver" });
    } finally {
      await app.close();
    }
  });

  it("ignores invalid timezone headers", async () => {
    const app = Fastify();
    registerRequestTimeZoneHook(app);
    app.get("/probe", async (request) => ({ timeZone: request.timeZone ?? null }));
    await app.ready();
    try {
      const res = await app.inject({ url: "/probe", headers: { "x-timezone": "Not/AZone" } });
      expect(res.json()).toEqual({ timeZone: null });
    } finally {
      await app.close();
    }
  });
});

describe("route timezone resolution", () => {
  const accessContext = {
    actorUserId: "00000000-0000-4000-8000-000000000123",
    requestId: "req:test"
  };

  it("uses the validated request header without reading stored locale", async () => {
    const runner = { withDataContext: vi.fn() };
    const preferences = { get: vi.fn() };

    await expect(
      resolveRequestTimeZoneForRoute(
        { timeZone: "America/New_York" },
        accessContext,
        runner,
        preferences
      )
    ).resolves.toBe("America/New_York");
    expect(runner.withDataContext).not.toHaveBeenCalled();
  });

  it("falls back to stored locale when the request header is absent", async () => {
    const runner = { withDataContext: vi.fn(async (_ctx, work) => work("scoped")) };
    const preferences = {
      get: vi.fn(async () => ({ timezone: "America/Los_Angeles" }))
    };

    await expect(
      resolveRequestTimeZoneForRoute({}, accessContext, runner, preferences)
    ).resolves.toBe("America/Los_Angeles");
  });

  it("falls back to UTC when neither header nor stored locale is valid", async () => {
    const runner = { withDataContext: vi.fn(async (_ctx, work) => work("scoped")) };
    const preferences = { get: vi.fn(async () => ({ timezone: "Not/AZone" })) };

    await expect(
      resolveRequestTimeZoneForRoute({}, accessContext, runner, preferences)
    ).resolves.toBe("UTC");
  });
});
