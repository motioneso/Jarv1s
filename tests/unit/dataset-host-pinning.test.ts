import { describe, expect, it } from "vitest";

import {
  assertValidFetchHosts,
  createHostPinnedFetch,
  HostPinningViolationError,
  isPinnableHost
} from "@jarv1s/datasets";

describe("isPinnableHost", () => {
  it("accepts a plain lowercase hostname", () => {
    expect(isPinnableHost("site.api.espn.com")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isPinnableHost("")).toBe(false);
  });

  it("rejects a mixed-case hostname", () => {
    expect(isPinnableHost("Site.Api.Espn.Com")).toBe(false);
  });

  it("rejects a hostname carrying a port", () => {
    expect(isPinnableHost("example.com:8080")).toBe(false);
  });

  it("rejects a bare IPv4 literal", () => {
    expect(isPinnableHost("127.0.0.1")).toBe(false);
  });

  it("rejects a bracketed IPv6 literal", () => {
    expect(isPinnableHost("[::1]")).toBe(false);
  });
});

describe("assertValidFetchHosts", () => {
  it("throws when a source declares no hosts", () => {
    expect(() => assertValidFetchHosts("espn", [])).toThrow(/declares no fetchHosts/);
  });

  it("throws when a source declares an unpinnable host", () => {
    expect(() => assertValidFetchHosts("espn", ["10.0.0.1"])).toThrow(/invalid fetchHost/);
  });

  it("passes for a list of valid hostnames", () => {
    expect(() =>
      assertValidFetchHosts("espn", ["a.espncdn.com", "site.api.espn.com"])
    ).not.toThrow();
  });
});

function fakeFetch(responses: readonly { status: number; location?: string }[]): {
  fetchFn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const headers = new Headers();
    if (r?.location) headers.set("location", r.location);
    return new Response(null, { status: r?.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function fakeFetchCapturingHeaders(responses: readonly { status: number; location?: string }[]): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url: String(input), headers });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const responseHeaders = new Headers();
    if (r?.location) responseHeaders.set("location", r.location);
    return new Response(null, { status: r?.status ?? 200, headers: responseHeaders });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createHostPinnedFetch", () => {
  it("allows a request to an allowed https host", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    const res = await pinned("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams");
    expect(res.status).toBe(200);
  });

  it("rejects a request to a host not in the allow list", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://evil.example.com/")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "evil.example.com"
    });
  });

  it("throws a HostPinningViolationError instance (not a plain Error) on rejection", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://evil.example.com/")).rejects.toBeInstanceOf(
      HostPinningViolationError
    );
  });

  it("rejects a plain-http request even to an allowed host", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("http://site.api.espn.com/")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "site.api.espn.com"
    });
  });

  it("follows a same-host redirect", async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    const res = await pinned("https://site.api.espn.com/first");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://site.api.espn.com/first", "https://site.api.espn.com/other"]);
  });

  it("blocks a redirect that escapes to a disallowed host (SSRF guard)", async () => {
    const { fetchFn } = fakeFetch([
      { status: 302, location: "https://internal.metadata.example/secret" }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://site.api.espn.com/first")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "internal.metadata.example"
    });
  });

  it("bounds redirect following to MAX_REDIRECTS hops", async () => {
    const { fetchFn } = fakeFetch(
      Array.from({ length: 10 }, () => ({
        status: 302,
        location: "https://site.api.espn.com/loop"
      }))
    );
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://site.api.espn.com/first")).rejects.toThrow(/exceeded/);
  });
});

describe("createHostPinnedFetch — sensitive header stripping across redirects (#833)", () => {
  it("keeps sensitive headers on a same-host redirect hop", async () => {
    const { fetchFn, calls } = fakeFetchCapturingHeaders([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", {
      headers: { authorization: "Bearer secret" }
    });
    expect(calls[0]?.headers.authorization).toBe("Bearer secret");
    expect(calls[1]?.headers.authorization).toBe("Bearer secret");
  });

  it("drops sensitive headers the moment a redirect hop changes hostname", async () => {
    const { fetchFn, calls } = fakeFetchCapturingHeaders([
      { status: 302, location: "https://cdn.espn.com/asset" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", {
      headers: { authorization: "Bearer secret" }
    });
    expect(calls[0]?.headers.authorization).toBe("Bearer secret");
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });

  it("keeps headers same-host then drops them cross-host, and does not restore them if a later hop returns to the original host", async () => {
    const { fetchFn, calls } = fakeFetchCapturingHeaders([
      { status: 302, location: "https://site.api.espn.com/second" },
      { status: 302, location: "https://cdn.espn.com/asset" },
      { status: 302, location: "https://site.api.espn.com/third" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", {
      headers: { authorization: "Bearer secret" }
    });
    expect(calls[0]?.headers.authorization).toBe("Bearer secret"); // initial
    expect(calls[1]?.headers.authorization).toBe("Bearer secret"); // same-host hop
    expect(calls[2]?.headers.authorization).toBeUndefined(); // cross-host hop
    expect(calls[3]?.headers.authorization).toBeUndefined(); // back to original host, stays stripped
  });

  it("leaves non-sensitive headers untouched across a cross-host redirect", async () => {
    const { fetchFn, calls } = fakeFetchCapturingHeaders([
      { status: 302, location: "https://cdn.espn.com/asset" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", {
      headers: { "x-request-id": "abc123", authorization: "Bearer secret" }
    });
    expect(calls[1]?.headers["x-request-id"]).toBe("abc123");
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });
});

function fakeFetchCapturingRequestInit(
  responses: readonly { status: number; location?: string }[]
): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; method: string; body: unknown }>;
} {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const headers = new Headers();
    if (r?.location) headers.set("location", r.location);
    return new Response(null, { status: r?.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createHostPinnedFetch — 303/301/302 method downgrade, 307/308 preserved (#836)", () => {
  it("downgrades a 303 hop to GET with no body, regardless of original method", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 303, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[0]).toMatchObject({ method: "POST", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("downgrades a non-GET 302 hop to GET with no body", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("downgrades a non-GET 301 hop to GET with no body", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 301, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "PUT", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("preserves method and body across a 307 hop", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 307, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]).toMatchObject({ method: "POST", body: "payload" });
  });

  it("preserves method and body across a 308 hop", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 308, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]).toMatchObject({ method: "POST", body: "payload" });
  });

  it("leaves a same-method (GET) hop through 301/302 unchanged", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });
});

function fakeFetchTimed(
  responses: readonly { status: number; location?: string; delayMs?: number }[]
): { fetchFn: typeof fetch; signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  let i = 0;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        const headers = new Headers();
        if (r?.location) headers.set("location", r.location);
        resolve(new Response(null, { status: r?.status ?? 200, headers }));
      }, r?.delayMs ?? 0);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
  return { fetchFn, signals };
}

describe("createHostPinnedFetch — fetch timeout (#858)", () => {
  it("aborts and rejects when the fetch exceeds timeoutMs", async () => {
    const { fetchFn } = fakeFetchTimed([{ status: 200, delayMs: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 20);
    await expect(pinned("https://site.api.espn.com/slow")).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("does not abort a fetch that completes well within timeoutMs", async () => {
    const { fetchFn } = fakeFetchTimed([{ status: 200, delayMs: 5 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 5_000);
    const res = await pinned("https://site.api.espn.com/fast");
    expect(res.status).toBe(200);
  });

  it("passes the SAME AbortSignal instance to every fetchFn call across redirect hops (deadline is not reset per-hop)", async () => {
    const { fetchFn, signals } = fakeFetchTimed([
      { status: 302, location: "https://site.api.espn.com/b" },
      { status: 302, location: "https://site.api.espn.com/c" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 5_000);
    await pinned("https://site.api.espn.com/a");
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]).toBe(signals[2]);
  });
});
