import { describe, expect, it, vi } from "vitest";

import type { AiRepository, GenerateStructuredDeps } from "@jarv1s/ai";
import type { DataContextDb } from "@jarv1s/db";

import { createModuleAiBridge } from "../../apps/api/src/external-module-ai-bridge.js";

describe("external module AI bridge", () => {
  it("routes CLI structured AI through the injected adapter and exposes only the object", async () => {
    const encryptedCredential = {};
    Object.defineProperty(encryptedCredential, "iv", {
      get: () => {
        throw new Error("CLI credential must not be decrypted");
      }
    });
    const aiRepository = {
      resolveModelForService: vi.fn(async () => ({
        model: {
          id: "model-secret-id",
          provider_config_id: "provider-secret-id",
          provider_kind: "anthropic",
          provider_model_id: "model-secret-name"
        },
        reason: "matched-active-model"
      })),
      selectProviderWithCredential: vi.fn(async () => ({
        id: "provider-secret-id",
        auth_method: "cli",
        encrypted_credential: encryptedCredential
      }))
    } as unknown as AiRepository;
    const generateStructured = vi.fn(async () => ({
      rawObject: { summary: "Resume-specific critique" },
      usage: { inputTokens: 12, outputTokens: 7 }
    }));
    const createCliStructuredAdapter: NonNullable<
      GenerateStructuredDeps["createCliStructuredAdapter"]
    > = vi.fn(() => ({ generateStructured }));
    const bridge = createModuleAiBridge({
      aiRepository,
      logger: { info: vi.fn(), warn: vi.fn() },
      createCliStructuredAdapter
    });

    const result = await bridge({} as DataContextDb, "job-search", {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: { summary: { type: "string" } }
      },
      prompt: "Critique this resume"
    });

    expect(result).toEqual({ ok: true, object: { summary: "Resume-specific critique" } });
    expect(createCliStructuredAdapter).toHaveBeenCalledWith("anthropic");
    expect(generateStructured).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/provider|model|usage|token/i);
  });
});
