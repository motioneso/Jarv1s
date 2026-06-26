import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "../../packages/db/src/index.js";
import {
  EMBED_MODEL_CONFIG_KEY,
  EMBED_PROVIDER_CONFIG_KEY
} from "../../packages/settings/src/runtime-config-keys.js";
import { RuntimeConfigResolver } from "../../packages/settings/src/runtime-config-resolver.js";

function scopedDbWithSetting(value: unknown): DataContextDb {
  const row = value === undefined ? undefined : { value };
  return {
    [dataContextBrand]: true,
    db: {
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => row
          })
        })
      })
    }
  } as unknown as DataContextDb;
}

describe("RuntimeConfigResolver", () => {
  it("resolves instance values before env and defaults", async () => {
    const resolver = new RuntimeConfigResolver(scopedDbWithSetting({ value: "stub" }), {
      JARVIS_EMBED_PROVIDER: "local"
    });

    await expect(resolver.resolveEnum(EMBED_PROVIDER_CONFIG_KEY)).resolves.toBe("stub");
    await expect(resolver.getStatus(EMBED_PROVIDER_CONFIG_KEY)).resolves.toEqual({
      value: "stub",
      source: "instance"
    });
  });

  it("falls back to env and then declared default", async () => {
    const envResolver = new RuntimeConfigResolver(scopedDbWithSetting(undefined), {
      JARVIS_EMBED_MODEL: "bge-small"
    });
    const defaultResolver = new RuntimeConfigResolver(scopedDbWithSetting(undefined), {});

    await expect(envResolver.resolveString(EMBED_MODEL_CONFIG_KEY)).resolves.toBe("bge-small");
    await expect(envResolver.getStatus(EMBED_MODEL_CONFIG_KEY)).resolves.toEqual({
      value: "bge-small",
      source: "env"
    });
    await expect(defaultResolver.resolveString(EMBED_MODEL_CONFIG_KEY)).resolves.toBe("");
    await expect(defaultResolver.getStatus(EMBED_MODEL_CONFIG_KEY)).resolves.toEqual({
      value: "",
      source: "default"
    });
  });

  it("rejects invalid enum values at the resolver boundary", async () => {
    const resolver = new RuntimeConfigResolver(scopedDbWithSetting({ value: "stb" }), {});

    await expect(resolver.resolveEnum(EMBED_PROVIDER_CONFIG_KEY)).rejects.toThrow(
      'Invalid runtime config "ai.embed_provider" value "stb"'
    );
  });
});
