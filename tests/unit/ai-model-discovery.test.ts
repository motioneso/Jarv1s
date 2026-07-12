import { describe, expect, it } from "vitest";

import { CLI_STATIC_MODELS, ModelDiscoveryService } from "@jarv1s/ai";

describe("CLI model discovery (#982/#869)", () => {
  it("curates active-ready Codex ids with service tiers", async () => {
    const result = await new ModelDiscoveryService().discoverModels("codex", {
      providerKind: "openai-compatible",
      authMethod: "cli",
      baseUrl: null,
      credential: { cli: true }
    });

    expect(CLI_STATIC_MODELS["openai-compatible"]).toBeDefined();
    expect(
      Object.fromEntries(result.models.map((model) => [model.providerModelId, model.tier]))
    ).toMatchObject({
      "gpt-5.6-sol": "reasoning",
      "gpt-5.6-terra": "interactive",
      "gpt-5.6-luna": "economy"
    });
  });
});
