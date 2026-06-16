import { describe, expect, it } from "vitest";

import {
  resolveChatModelOverride,
  type ChatModelOverrideCandidate
} from "../../packages/ai/src/chat-model-override.js";

function model(
  id: string,
  input: Partial<ChatModelOverrideCandidate> = {}
): ChatModelOverrideCandidate {
  return {
    id,
    providerStatus: "active",
    capabilities: ["chat"],
    status: "active",
    allowUserOverride: true,
    ...input
  };
}

describe("resolveChatModelOverride", () => {
  it("returns default when global override is disabled", () => {
    const defaultModel = model("default");
    const override = model("override");

    const result = resolveChatModelOverride({
      defaultModel,
      requestedModelId: override.id,
      overrideEnabled: false,
      models: [defaultModel, override]
    });

    expect(result.selectedModel).toBe(defaultModel);
    expect(result.effectiveOverrideModelId).toBeNull();
  });

  it("returns override when global override is enabled and model is allowed", () => {
    const defaultModel = model("default");
    const override = model("override");

    const result = resolveChatModelOverride({
      defaultModel,
      requestedModelId: override.id,
      overrideEnabled: true,
      models: [defaultModel, override]
    });

    expect(result.selectedModel).toBe(override);
    expect(result.effectiveOverrideModelId).toBe(override.id);
  });

  it("returns default when override model is disallowed", () => {
    const defaultModel = model("default");
    const disallowed = model("expensive", { allowUserOverride: false });

    const result = resolveChatModelOverride({
      defaultModel,
      requestedModelId: disallowed.id,
      overrideEnabled: true,
      models: [defaultModel, disallowed]
    });

    expect(result.selectedModel).toBe(defaultModel);
    expect(result.effectiveOverrideModelId).toBeNull();
  });

  it("returns default when override model was removed", () => {
    const defaultModel = model("default");

    const result = resolveChatModelOverride({
      defaultModel,
      requestedModelId: "removed-model",
      overrideEnabled: true,
      models: [defaultModel]
    });

    expect(result.selectedModel).toBe(defaultModel);
    expect(result.effectiveOverrideModelId).toBeNull();
  });

  it("keeps instance default selectable even when its allow flag is false", () => {
    const defaultModel = model("default", { allowUserOverride: false });
    const override = model("override");

    const result = resolveChatModelOverride({
      defaultModel,
      requestedModelId: null,
      overrideEnabled: true,
      models: [defaultModel, override]
    });

    expect(result.selectedModel).toBe(defaultModel);
    expect(result.allowedModels.map((m) => m.id)).toEqual(["default", "override"]);
  });
});
