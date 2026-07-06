import { describe, expect, it } from "vitest";

import { assertValidFetchHosts, createHostPinnedFetch, isPinnableHost } from "@jarv1s/datasets";

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
    await expect(pinned("https://evil.example.com/")).rejects.toThrow(/not in the allowed list/);
  });

  it("rejects a plain-http request even to an allowed host", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("http://site.api.espn.com/")).rejects.toThrow(/only https is allowed/);
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
    await expect(pinned("https://site.api.espn.com/first")).rejects.toThrow(
      /not in the allowed list/
    );
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
