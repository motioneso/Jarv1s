import { describe, expect, it } from "vitest";

import { resolveModuleSettingsDeepLink } from "../../apps/web/src/settings/module-settings-deep-link.js";

describe("resolveModuleSettingsDeepLink", () => {
  it("routes built-in module settings surfaces directly", () => {
    expect(resolveModuleSettingsDeepLink("chat", () => false)).toBe("chat");
    expect(resolveModuleSettingsDeepLink("notifications", () => false)).toBe("notifications");
  });

  it("routes contributed module surfaces by module id", () => {
    expect(resolveModuleSettingsDeepLink("tasks", (moduleId) => moduleId === "tasks")).toEqual({
      moduleId: "tasks"
    });
  });

  it("ignores unknown module ids", () => {
    expect(resolveModuleSettingsDeepLink("unknown", () => false)).toBeNull();
  });
});
