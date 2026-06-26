import { describe, expect, it } from "vitest";

import {
  EMBED_MODEL_CONFIG_KEY,
  EMBED_PROVIDER_CONFIG_KEY
} from "../../packages/settings/src/runtime-config-keys.js";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  type EmbeddingRuntimeConfigResolver
} from "../../packages/memory/src/embedding-provider-config.js";

describe("runtime embedding config", () => {
  it("reads provider and optional model from a runtime resolver", async () => {
    const resolver: EmbeddingRuntimeConfigResolver = {
      resolveEnum: async (key) => {
        expect(key).toBe(EMBED_PROVIDER_CONFIG_KEY);
        return "local";
      },
      resolveString: async (key) => {
        expect(key).toBe(EMBED_MODEL_CONFIG_KEY);
        return "Xenova/bge-small-en-v1.5";
      }
    };

    await expect(getEmbeddingProviderConfig(resolver)).resolves.toEqual({
      kind: "local",
      modelId: "Xenova/bge-small-en-v1.5"
    });
  });

  it("omits blank model ids and leaves provider construction synchronous", async () => {
    const resolver: EmbeddingRuntimeConfigResolver = {
      resolveEnum: async () => "stub",
      resolveString: async () => ""
    };

    const config = await getEmbeddingProviderConfig(resolver);

    expect(config).toEqual({ kind: "stub" });
    expect(createEmbeddingProvider(config).modelName).toBe("stub");
  });
});
