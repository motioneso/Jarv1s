import { describe, expect, it } from "vitest";

import {
  BRAVE_API_KEY_CONFIG_KEY,
  EMBED_MODEL_CONFIG_KEY,
  EMBED_PROVIDER_CONFIG_KEY,
  RUNTIME_CONFIG_REGISTRY,
  getRuntimeConfigEntry
} from "../../packages/settings/src/runtime-config-keys.js";
import {
  KNOWN_INSTANCE_SETTING_KEYS,
  SECRET_INSTANCE_SETTING_KEYS
} from "../../packages/settings/src/instance-settings-keys.js";

describe("runtime config registry", () => {
  it("registers embedding keys as non-secret instance settings", () => {
    expect(getRuntimeConfigEntry(EMBED_PROVIDER_CONFIG_KEY)).toMatchObject({
      key: "ai.embed_provider",
      type: "enum",
      defaultValue: "local",
      envVar: "JARVIS_EMBED_PROVIDER",
      enumValues: ["local", "stub"],
      moduleOwner: "memory"
    });
    expect(getRuntimeConfigEntry(EMBED_MODEL_CONFIG_KEY)).toMatchObject({
      key: "ai.embed_model",
      type: "string",
      defaultValue: "",
      envVar: "JARVIS_EMBED_MODEL",
      moduleOwner: "memory"
    });
    expect(KNOWN_INSTANCE_SETTING_KEYS.has(EMBED_PROVIDER_CONFIG_KEY)).toBe(true);
    expect(KNOWN_INSTANCE_SETTING_KEYS.has(EMBED_MODEL_CONFIG_KEY)).toBe(true);
    expect(SECRET_INSTANCE_SETTING_KEYS.has(EMBED_PROVIDER_CONFIG_KEY)).toBe(false);
    expect(SECRET_INSTANCE_SETTING_KEYS.has(EMBED_MODEL_CONFIG_KEY)).toBe(false);
    expect(SECRET_INSTANCE_SETTING_KEYS.has(BRAVE_API_KEY_CONFIG_KEY)).toBe(true);
    expect(RUNTIME_CONFIG_REGISTRY).toHaveLength(3);
  });
});
