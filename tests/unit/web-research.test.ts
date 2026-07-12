import { afterEach, describe, expect, it } from "vitest";

import {
  createRobotsGate,
  fetchWebResource,
  fetchWebResourceBytes,
  isBlockedIp,
  RateLimitExceededError,
  readWebPage,
  setWebHttpTransportForTests,
  setWebFetchForTests,
  setWebHostResolverForTests,
  setWebSearchProviderForTests,
  webModuleManifest,
  webReadExecute,
  webSearchExecute
} from "@jarv1s/web-research";

afterEach(() => {
  setWebFetchForTests(undefined);
  setWebHttpTransportForTests(undefined);
  setWebHostResolverForTests(undefined);
  setWebSearchProviderForTests(undefined);
});

describe("web research manifest", () => {
  it("declares required web.search and web.read assistant tools", () => {
    expect(webModuleManifest.id).toBe("web");
    expect(webModuleManifest.lifecycle).toBe("required");
    expect(webModuleManifest.availability).toMatchObject({
      defaultEnabled: true,
      required: true
    });
    expect(webModuleManifest.routes ?? []).toEqual([]);
    expect(webModuleManifest.navigation ?? []).toEqual([]);

    const tools = webModuleManifest.assistantTools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(["web.search", "web.read"]);
    expect(tools.every((tool) => tool.permissionId === "web.research")).toBe(true);
    expect(tools.find((t) => t.name === "web.search")?.risk).toBe("read");
    // web.read fetches arbitrary URLs — confirm gate required (#359)
    expect(tools.find((t) => t.name === "web.read")?.risk).toBe("write");
  });
});

describe("web.read", () => {
  it("rejects unsafe literal and DNS-resolved private URLs", async () => {
    let fetchCalls = 0;
    setWebFetchForTests(async () => {
      fetchCalls += 1;
      return new Response("ok");
    });
    setWebHostResolverForTests(async (hostname) =>
      hostname === "public.test" ? [{ address: "10.0.0.1", family: 4 }] : []
    );

    const result = await webReadExecute(
      {},
      {
        urls: [
          "file:///etc/passwd",
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://10.0.0.1",
          "http://169.254.169.254",
          "javascript:alert(1)",
          "https://public.test/ok"
        ]
      },
      { actorUserId: "u", requestId: "r", chatSessionId: "c" }
    );

    expect(result.data.documents).toHaveLength(0);
    expect(result.data.trace).toMatchObject({
      requestedUrlCount: 7,
      fetchedUrlCount: 0,
      skippedUrlCount: 7
    });
    expect(fetchCalls).toBe(0);
  });

  it("blocks IPv6 unspecified (::), this-network (0.0.0.0/8), and CGNAT (100.64.0.0/10)", async () => {
    expect(isBlockedIp("::")).toBe(true); // IPv6 unspecified — routes to loopback on Linux
    expect(isBlockedIp("0.1.2.3")).toBe(true); // this-network /8 (broader than old single-host 0.0.0.0)
    expect(isBlockedIp("100.64.0.1")).toBe(true); // CGNAT (RFC 6598)
    expect(isBlockedIp("100.127.255.255")).toBe(true); // end of CGNAT range
    expect(isBlockedIp("100.128.0.1")).toBe(false); // just outside CGNAT — public
    // Node.js BlockList correctly cross-checks IPv4-mapped IPv6 against IPv4 subnets
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true); // AWS metadata via IPv4-mapped
    expect(isBlockedIp("::ffff:a9fe:a9fe")).toBe(true); // same in hex notation
    // IANA special ranges added for completeness
    expect(isBlockedIp("192.0.2.1")).toBe(true); // TEST-NET-1
    expect(isBlockedIp("198.18.1.1")).toBe(true); // benchmarking
    expect(isBlockedIp("198.51.100.1")).toBe(true); // TEST-NET-2
    expect(isBlockedIp("203.0.113.1")).toBe(true); // TEST-NET-3
    expect(isBlockedIp("240.0.0.1")).toBe(true); // reserved Class E
    expect(isBlockedIp("2001:db8::1")).toBe(true); // IPv6 documentation
  });

  it("extracts readable text, caps content, and reports trace", async () => {
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebFetchForTests(
      async () =>
        new Response(
          `<html><head><title>T</title><script>bad()</script></head><body><nav>nav</nav><main><h1>Hello</h1><p>${"a".repeat(20_000)}</p></main></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        )
    );

    const result = await webReadExecute(
      {},
      { urls: ["https://example.com/a"] },
      {
        actorUserId: "u",
        requestId: "r",
        chatSessionId: "c"
      }
    );

    const [doc] = result.data.documents as Array<{
      title: string;
      text: string;
      truncated: boolean;
      url: string;
    }>;
    expect(doc).toBeDefined();
    if (!doc) throw new Error("expected document");
    expect(doc.url).toBe("https://example.com/a");
    expect(doc.title).toBe("T");
    expect(doc.text).toContain("Hello");
    expect(doc.text).not.toContain("bad()");
    expect(doc.truncated).toBe(true);
    expect(result.data.trace).toMatchObject({
      requestedUrlCount: 1,
      fetchedUrlCount: 1,
      skippedUrlCount: 0
    });
  });

  it("validates each redirect target before following it", async () => {
    let fetchCalls = 0;
    setWebHostResolverForTests(async (hostname) =>
      hostname === "example.com" ? [{ address: "93.184.216.34", family: 4 }] : []
    );
    setWebFetchForTests(async () => {
      fetchCalls += 1;
      return new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/private" }
      });
    });

    const result = await webReadExecute(
      {},
      { urls: ["https://example.com/redirect"] },
      {
        actorUserId: "u",
        requestId: "r",
        chatSessionId: "c"
      }
    );

    expect(fetchCalls).toBe(1);
    expect(result.data.documents).toHaveLength(0);
    expect(result.data.trace).toMatchObject({
      requestedUrlCount: 1,
      fetchedUrlCount: 0,
      skippedUrlCount: 1
    });
  });

  it("connects to the checked DNS address while preserving the original host", async () => {
    const requests: Array<{ connectHost: string; hostHeader: string; servername?: string }> = [];
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(async (request) => {
      requests.push({
        connectHost: request.connectHost,
        hostHeader: request.hostHeader,
        servername: request.servername
      });
      return new Response("<title>ok</title><main>safe</main>", { status: 200 });
    });

    const result = await webReadExecute(
      {},
      { urls: ["https://example.com/a"] },
      { actorUserId: "u", requestId: "r", chatSessionId: "c" }
    );

    expect(result.data.documents).toHaveLength(1);
    expect(requests).toEqual([
      {
        connectHost: "93.184.216.34",
        hostHeader: "example.com",
        servername: "example.com"
      }
    ]);
  });

  it("blocks IPv4-mapped IPv6 private and loopback addresses", async () => {
    let fetchCalls = 0;
    setWebFetchForTests(async () => {
      fetchCalls += 1;
      return new Response("ok");
    });

    const result = await webReadExecute(
      {},
      {
        urls: [
          "http://[::ffff:127.0.0.1]/",
          "http://[::ffff:10.0.0.1]/",
          "http://[::ffff:169.254.1.1]/",
          "http://[fc00::1]/",
          "http://[fe80::1]/",
          "http://[::1]/"
        ]
      },
      { actorUserId: "u", requestId: "r", chatSessionId: "c" }
    );

    expect(isBlockedIp("[::ffff:7f00:1]")).toBe(true);
    expect(result.data.documents).toHaveLength(0);
    expect(result.data.trace).toMatchObject({
      requestedUrlCount: 6,
      fetchedUrlCount: 0,
      skippedUrlCount: 6
    });
    expect(fetchCalls).toBe(0);
  });
});

describe("fetchWebResource", () => {
  it("returns exact bounded bytes without text conversion", async () => {
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(
      async () => new Response(Uint8Array.from([0, 255, 1, 2]), { status: 200 })
    );

    const exact = await fetchWebResourceBytes("https://example.com/image");
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect([...exact.body]).toEqual([0, 255, 1, 2]);
      expect(exact.truncated).toBe(false);
    }

    const capped = await fetchWebResourceBytes("https://example.com/image", { maxBytes: 2 });
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect([...capped.body]).toEqual([0, 255]);
      expect(capped.truncated).toBe(true);
    }
  });

  it("keeps HTTPS, redirect validation, and rate limits on the byte path", async () => {
    const requests: string[] = [];
    setWebHostResolverForTests(async (hostname) => [
      {
        address: hostname === "private-target.example" ? "10.0.0.1" : "93.184.216.34",
        family: 4
      }
    ]);
    setWebHttpTransportForTests(async (request) => {
      requests.push(request.connectHost);
      return new Response("", {
        status: 302,
        headers: { location: "https://private-target.example/image" }
      });
    });

    await expect(
      fetchWebResourceBytes("http://good.example/image", { requireHttps: true })
    ).resolves.toEqual({ ok: false, reason: "not_https" });
    await expect(fetchWebResourceBytes("https://good.example/image")).resolves.toEqual({
      ok: false,
      reason: "blocked"
    });
    expect(requests).toEqual(["93.184.216.34"]);

    await expect(
      fetchWebResourceBytes("https://good.example/image", {
        rateLimiter: { acquire: async () => Promise.reject(new RateLimitExceededError()) }
      })
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });

  it("enforces HTTPS without changing readWebPage compatibility", async () => {
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(async () => new Response("ok", { status: 200 }));

    await expect(fetchWebResource("http://example.com", { requireHttps: true })).resolves.toEqual({
      ok: false,
      reason: "not_https"
    });
    await expect(readWebPage("http://example.com")).resolves.toMatchObject({ ok: true });
  });

  it("revalidates redirects and rejects private or downgraded targets", async () => {
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "http://good.example/downgraded" }
        })
    );
    await expect(
      fetchWebResource("https://good.example", { requireHttps: true })
    ).resolves.toMatchObject({ ok: false, reason: "not_https" });

    setWebHttpTransportForTests(
      async () =>
        new Response("", { status: 302, headers: { location: "https://169.254.169.254/" } })
    );
    await expect(fetchWebResource("https://good.example")).resolves.toMatchObject({
      ok: false,
      reason: "blocked"
    });
  });

  it("pins the validated address and blocks a rebind-shaped redirect", async () => {
    const requests: string[] = [];
    setWebHostResolverForTests(async (hostname) => [
      {
        address: hostname === "rebound.example" ? "10.0.0.1" : "93.184.216.34",
        family: 4
      }
    ]);
    setWebHttpTransportForTests(async (request) => {
      requests.push(request.connectHost);
      return new Response("", {
        status: 302,
        headers: { location: "https://rebound.example/private" }
      });
    });

    await expect(fetchWebResource("https://good.example")).resolves.toMatchObject({
      ok: false,
      reason: "blocked"
    });
    expect(requests).toEqual(["93.184.216.34"]);
  });

  it.each(["http://[::]/", "http://0x7f000001/", "http://[::ffff:127.0.0.1]/"])(
    "blocks adversarial literal %s before transport",
    async (url) => {
      let calls = 0;
      setWebHttpTransportForTests(async () => {
        calls += 1;
        return new Response("nope");
      });
      await expect(fetchWebResource(url)).resolves.toMatchObject({
        ok: false,
        reason: "blocked"
      });
      expect(calls).toBe(0);
    }
  );

  it("consults robots before the page and fails closed", async () => {
    const paths: string[] = [];
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(async (request) => {
      paths.push(request.url.pathname);
      return new Response("User-agent: *\nDisallow: /private", { status: 200 });
    });

    await expect(
      fetchWebResource("https://example.com/private", { robots: createRobotsGate() })
    ).resolves.toMatchObject({ ok: false, reason: "robots" });
    expect(paths).toEqual(["/robots.txt"]);

    setWebHttpTransportForTests(async () => new Response("unavailable", { status: 503 }));
    await expect(
      fetchWebResource("https://other.example/story", { robots: createRobotsGate() })
    ).resolves.toMatchObject({ ok: false, reason: "robots" });
  });

  it("maps rate limits, truncation, and timeout", async () => {
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(async () => new Response("abcdef", { status: 200 }));
    await expect(
      fetchWebResource("https://example.com", {
        rateLimiter: {
          acquire: async () => {
            throw new RateLimitExceededError();
          }
        }
      })
    ).resolves.toMatchObject({ ok: false, reason: "rate_limited" });
    await expect(fetchWebResource("https://example.com", { maxBytes: 3 })).resolves.toMatchObject({
      ok: true,
      body: "abc",
      truncated: true
    });

    setWebHttpTransportForTests(
      async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    );
    await expect(fetchWebResource("https://example.com", { timeoutMs: 1 })).resolves.toMatchObject({
      ok: false,
      reason: "timeout"
    });
  });

  it("times out a resolver that never settles", async () => {
    let transportCalls = 0;
    setWebHostResolverForTests(() => new Promise(() => {}));
    setWebHttpTransportForTests(async () => {
      transportCalls += 1;
      return new Response("unexpected");
    });

    await expect(fetchWebResource("https://example.com", { timeoutMs: 1 })).resolves.toEqual({
      ok: false,
      reason: "timeout"
    });
    expect(transportCalls).toBe(0);
  }, 100);

  it("does not start transport when a limiter wait exceeds the timeout", async () => {
    let transportCalls = 0;
    setWebHostResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    setWebHttpTransportForTests(async () => {
      transportCalls += 1;
      return new Response("unexpected");
    });

    await expect(
      fetchWebResource("https://example.com", {
        timeoutMs: 1,
        rateLimiter: { acquire: () => new Promise((resolve) => setTimeout(resolve, 50)) }
      })
    ).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(transportCalls).toBe(0);
  });
});

describe("web.search", () => {
  it("caps input and provider results", async () => {
    setWebSearchProviderForTests({
      name: "fake",
      search: async ({ limit }) => ({
        results: Array.from({ length: limit + 2 }, (_, index) => ({
          title: `Result ${index}`,
          url: `https://example.com/${index}`,
          snippet: "snippet",
          publishedAt: index === 0 ? "2026-06-19" : undefined
        })),
        trace: { provider: "fake" }
      })
    });

    const result = await webSearchExecute(
      {},
      { query: "x".repeat(500), limit: 99 },
      {
        actorUserId: "u",
        requestId: "r",
        chatSessionId: "c"
      }
    );

    expect(result.data.query).toHaveLength(200);
    expect(result.data.results).toHaveLength(5);
    expect(result.data.trace).toMatchObject({
      provider: "fake",
      resultCount: 5,
      limitApplied: true,
      queryTruncated: true
    });
  });
});
