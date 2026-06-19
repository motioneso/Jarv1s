import { describe, expect, it } from "vitest";

import { setWebSearchProviderForTests, webModuleManifest, webSearchExecute } from "@jarv1s/web-research";

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

    const result = await webSearchExecute({}, { query: "x".repeat(500), limit: 99 }, {
      actorUserId: "u",
      requestId: "r",
      chatSessionId: "c"
    });

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
