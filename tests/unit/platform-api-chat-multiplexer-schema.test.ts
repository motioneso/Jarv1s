import { describe, expect, it } from "vitest";

import { chatMultiplexerSettingsSchema } from "../../packages/shared/src/platform-api.js";

describe("chatMultiplexerSettingsSchema", () => {
  it("declares all live-status fields in both properties and required", () => {
    const fields = [
      "multiplexer",
      "available",
      "herdrInstalled",
      "active",
      "activeSource",
      "envOverride"
    ];
    for (const field of fields) {
      expect(chatMultiplexerSettingsSchema.properties).toHaveProperty(field);
      expect(chatMultiplexerSettingsSchema.required).toContain(field);
    }
  });

  it("allows null for active/activeSource/envOverride", () => {
    const active = chatMultiplexerSettingsSchema.properties.active as { type: readonly string[] };
    const activeSource = chatMultiplexerSettingsSchema.properties.activeSource as {
      type: readonly string[];
    };
    const envOverride = chatMultiplexerSettingsSchema.properties.envOverride as {
      type: readonly string[];
    };
    expect(active.type).toContain("null");
    expect(activeSource.type).toContain("null");
    expect(envOverride.type).toContain("null");
  });
});
