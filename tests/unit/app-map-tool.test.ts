import { describe, expect, it, vi } from "vitest";
import { sanitizeAssistantToolResult } from "@jarv1s/ai";
import { createAppMapReadService, appGetMapSliceOutputSchema } from "@jarv1s/settings";

const artifact = {
  schemaVersion: 1,
  build: { version: "1.2.3", buildId: "abc123" },
  screens: [
    {
      moduleId: "news",
      id: "news",
      label: "News",
      description: "News screen.",
      path: "/news",
      scope: "user"
    },
    {
      moduleId: "settings",
      id: "admin",
      label: "Admin",
      description: "Admin screen.",
      path: "/settings/admin",
      scope: "admin"
    },
    {
      moduleId: "hidden",
      id: "hidden",
      label: "Hidden",
      description: "Hidden screen.",
      path: "/hidden",
      scope: "user"
    },
    {
      moduleId: "news",
      id: "news-labs",
      label: "News Labs",
      description: "Unreleased News screen.",
      path: "/news/labs",
      scope: "user",
      featureFlagId: "news.labs"
    }
  ],
  settings: [],
  features: [],
  errors: [],
  remediations: [],
  narrative: { authoritative: false, markdown: "release prose" }
} as const;

describe("AppMapReadService", () => {
  it("filters inactive, admin-only, and live flagged-OFF entries before slicing", async () => {
    const resolveFeatureFlagState = vi.fn((featureFlagId: string) => featureFlagId !== "news.labs");
    const service = createAppMapReadService({
      artifact,
      resolveActiveModules: vi.fn().mockResolvedValue([{ id: "news" }, { id: "settings" }]),
      resolveFeatureFlagState,
      getUser: vi.fn().mockResolvedValue({ is_instance_admin: false }),
      logGap: vi.fn()
    });
    const result = await service.query({} as never, "user-1", { query: "screen", limit: 8 });
    expect(result.items.map((item) => item.id)).toEqual(["news"]);
    expect(result.items.map((item) => item.id)).not.toContain("news-labs");
    expect(resolveFeatureFlagState).toHaveBeenCalledWith("news.labs");
  });

  it("returns at most eight schema-sanitized items", async () => {
    const service = createAppMapReadService({
      artifact: {
        ...artifact,
        screens: Array.from({ length: 12 }, (_, i) => ({
          moduleId: "news",
          id: `n${i}`,
          label: `N${i}`,
          description: "News screen.",
          path: `/n${i}`,
          scope: "user" as const
        }))
      },
      resolveActiveModules: vi.fn().mockResolvedValue([{ id: "news" }]),
      resolveFeatureFlagState: vi.fn().mockReturnValue(true),
      getUser: vi.fn().mockResolvedValue({ is_instance_admin: true }),
      logGap: vi.fn()
    });
    const slice = await service.query({} as never, "admin-1", { query: "news", limit: 99 });
    expect(slice.items).toHaveLength(8);
    const sanitized = sanitizeAssistantToolResult(appGetMapSliceOutputSchema, {
      data: { ...slice, secret: "drop" }
    });
    expect(sanitized.data).not.toHaveProperty("secret");
  });

  it("logs an undeclared query as a coverage gap", async () => {
    const logGap = vi.fn();
    const service = createAppMapReadService({
      artifact,
      resolveActiveModules: vi.fn().mockResolvedValue([{ id: "news" }]),
      resolveFeatureFlagState: vi.fn().mockReturnValue(true),
      getUser: vi.fn().mockResolvedValue({ is_instance_admin: false }),
      logGap
    });
    await service.query({} as never, "u1", { query: "quantum sandwich settings" });
    expect(logGap).toHaveBeenCalledWith({ kind: "query", value: "quantum sandwich settings" });
  });
});
