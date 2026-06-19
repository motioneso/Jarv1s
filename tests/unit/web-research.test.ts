import { describe, expect, it } from "vitest";

import { webModuleManifest } from "@jarv1s/web-research";

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
