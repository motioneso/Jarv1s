import { describe, expect, it, vi } from "vitest";

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
    // Under vitest the test/dev signal is present, so "stub" is honored as-is. The next two
    // tests cover what happens when that signal is absent — see #1313.
    expect(createEmbeddingProvider(config).modelName).toBe("stub");
  });

  // #1313: the registry enum no longer offers "stub", but that only closes the settings/PATCH
  // write path. This is the last line of defense — a real instance that reaches "stub" some
  // other way (a legacy instance_settings row written before the fix, or a raw
  // JARVIS_EMBED_PROVIDER=stub env var) must NOT quietly serve fake vectors, because search
  // then returns noise while the instance looks perfectly healthy.
  it("falls back to the real local provider when stub is requested without a test/dev signal (#1313)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A production-shaped env: no NODE_ENV=test, no VITEST, no explicit escape hatch.
    const provider = createEmbeddingProvider({ kind: "stub" }, { NODE_ENV: "production" });

    expect(provider.modelName).not.toBe("stub");
    // The fallback is deliberately loud — a silent downgrade is what we're preventing.
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("ai.embed_provider");

    warn.mockRestore();
  });

  // #1313: CI prod-smoke (.github/workflows/ci.yml) and UAT bare instances
  // (tests/uat/provisioner.ts) both run NODE_ENV=production yet legitimately need the stub, so
  // they set this explicit escape hatch. If this stops working, those runs silently start
  // downloading a real embedding model.
  it("still honors stub under the explicit escape hatch on a production-shaped env (#1313)", () => {
    const provider = createEmbeddingProvider(
      { kind: "stub" },
      { NODE_ENV: "production", JARVIS_ALLOW_STUB_EMBEDDINGS: "1" }
    );

    expect(provider.modelName).toBe("stub");
  });
});
