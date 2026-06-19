import { afterEach, describe, expect, it } from "vitest";

import {
  setWebFetchForTests,
  setWebHostResolverForTests,
  setWebSearchProviderForTests,
  webModuleManifest,
  webReadExecute,
  webSearchExecute
} from "@jarv1s/web-research";

afterEach(() => {
  setWebFetchForTests(undefined);
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
    expect(tools.every((tool) => tool.risk === "read")).toBe(true);
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
