import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetGlobalErrorHandlersForTest,
  registerGlobalErrorHandlers,
  reportClientError
} from "../../apps/web/src/shell/global-error-handler.js";

/**
 * Tests for the global browser error capture (#413).
 *
 * No DOM env in this suite (per onboarding-provider-connect-step.test.tsx note),
 * so these tests stub `globalThis.fetch` and `globalThis.window`/`addEventListener`
 * to verify the wiring without a real browser. The reporter + register logic are
 * framework-agnostic, so mocking the platform surface is sufficient.
 *
 * Security/observability contract under test:
 * - reportClientError POSTs {type,message,stack?} to /api/errors and never throws.
 * - registerGlobalErrorHandlers wires error + unhandledrejection listeners,
 *   each normalizing its event into a report, and is idempotent.
 */

// Stub a minimal window with addEventListener, since the test env has no DOM.
function installWindowStub(): { listeners: Map<string, EventListener[]> } {
  const listeners = new Map<string, EventListener[]>();
  const win = {
    addEventListener: (type: string, fn: EventListener) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    }
  } as unknown as Window;
  (globalThis as { window?: unknown }).window = win;
  return { listeners };
}

describe("reportClientError", () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    __resetGlobalErrorHandlersForTest();
    originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  });
  afterEach(() => {
    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  });

  it("sends the correct request shape (asserted via the spy)", async () => {
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;

    await reportClientError({ type: "uncaught_error", message: "x", stack: "st" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("/api/errors");
    const init = spy.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ type: "uncaught_error", message: "x", stack: "st" });
    expect(init.keepalive).toBe(true);
  });

  it("omits stack when undefined", async () => {
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;

    await reportClientError({ type: "t", message: "m" });

    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ type: "t", message: "m", stack: undefined });
  });

  it("never throws when fetch rejects (no recursion risk)", async () => {
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.reject(new Error("network down"))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;

    await expect(reportClientError({ type: "t", message: "m" })).resolves.toBeUndefined();
  });

  it("never throws on a non-ok response", async () => {
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 500 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;

    await expect(reportClientError({ type: "t", message: "m" })).resolves.toBeUndefined();
  });
});

describe("registerGlobalErrorHandlers", () => {
  let originalWindow: unknown;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    __resetGlobalErrorHandlersForTest();
    originalWindow = (globalThis as { window?: unknown }).window;
    originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
    __resetGlobalErrorHandlersForTest();
  });

  it("wires 'error' and 'unhandledrejection' listeners exactly once (idempotent)", () => {
    const { listeners } = installWindowStub();
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;

    registerGlobalErrorHandlers();
    registerGlobalErrorHandlers(); // second call must not double-wire

    expect(listeners.get("error")?.length).toBe(1);
    expect(listeners.get("unhandledrejection")?.length).toBe(1);
  });

  it("the 'error' listener reports an uncaught_error with the message + stack", async () => {
    const { listeners } = installWindowStub();
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;
    registerGlobalErrorHandlers();

    const fn = listeners.get("error")![0]!;
    const fakeErr = new Error("kaboom");
    fakeErr.stack = "stacktrace";
    fn({ message: "kaboom", error: fakeErr } as unknown as Event);

    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ type: "uncaught_error", message: "kaboom", stack: "stacktrace" });
  });

  it("the 'unhandledrejection' listener reports an unhandled_promise_rejection", async () => {
    const { listeners } = installWindowStub();
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;
    registerGlobalErrorHandlers();

    const fn = listeners.get("unhandledrejection")![0]!;
    const reason = new Error("async boom");
    reason.stack = "astack";
    fn({ reason } as unknown as PromiseRejectionEvent);

    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      type: "unhandled_promise_rejection",
      message: "async boom",
      stack: "astack"
    });
  });

  it("normalizes a non-Error rejection reason to a string message with no stack", async () => {
    const { listeners } = installWindowStub();
    const spy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    (globalThis as { fetch?: unknown }).fetch = spy as unknown as typeof fetch;
    registerGlobalErrorHandlers();

    const fn = listeners.get("unhandledrejection")![0]!;
    fn({ reason: "string reason" } as unknown as PromiseRejectionEvent);

    await Promise.resolve();
    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body.type).toBe("unhandled_promise_rejection");
    expect(body.message).toBe("string reason");
    expect(body.stack).toBeUndefined();
  });
});
