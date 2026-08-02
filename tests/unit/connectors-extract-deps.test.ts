import { describe, expect, it, vi } from "vitest";

import type { AiRepository } from "@jarv1s/ai";
import { createCliStructuredAdapterFactory, type ChatEngineFactory } from "@jarv1s/chat";
import type { DataContextDb } from "@jarv1s/db";

import { buildEmailExtractDeps } from "../../packages/connectors/src/extract-deps.js";

const ACTIONABLE_SIGNALS = {
  summary: "A launch plan needs approval today.",
  billsDue: [],
  actionItems: [],
  deadlines: [],
  actionability: {
    category: "needs_action",
    reason: "The sender requests approval.",
    suggestedTasks: [{ text: "Approve the launch plan" }]
  },
  mayGetLostInShuffle: true,
  importance: "high",
  confidence: 0.95
};

const MODEL = {
  id: "model-fixture",
  provider_config_id: "provider-fixture",
  provider_kind: "anthropic",
  provider_model_id: "model-fixture",
  tier: "economy"
};

describe("buildEmailExtractDeps", () => {
  it("routes a CLI-marker provider through the existing structured transport", async () => {
    const repository = {
      selectModelForCapability: vi.fn(async () => MODEL),
      resolveModelForService: vi.fn(async () => ({
        model: MODEL,
        reason: "matched-active-model" as const
      })),
      selectProviderWithCredential: vi.fn(async () => ({
        auth_method: "cli",
        encrypted_credential: { marker: "sealed" },
        base_url: null
      }))
    } as unknown as AiRepository;
    const decryptJson = vi.fn(() => ({ cli: true }));
    const engineFactory: ChatEngineFactory = vi.fn(() => ({
      provider: "anthropic" as const,
      launch: vi.fn(async () => ({ offset: 0 })),
      submit: vi.fn(async () => undefined),
      readNew: vi.fn(async () => ({
        records: [{ kind: "reply" as const, text: JSON.stringify(ACTIONABLE_SIGNALS) }],
        offset: 1,
        complete: true
      })),
      interrupt: vi.fn(async () => undefined),
      isAlive: vi.fn(async () => false),
      kill: vi.fn(async () => undefined)
    }));
    const deps = buildEmailExtractDeps({} as DataContextDb, repository, { decryptJson } as never, {
      createCliStructuredAdapter: createCliStructuredAdapterFactory(engineFactory)
    });

    const model = await deps.selectModel("economy");
    expect(model).toBeDefined();
    const reply = await deps.runChat(model!, "Extract actionable email signals.");

    expect(JSON.parse(reply.text)).toEqual(ACTIONABLE_SIGNALS);
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("preserves the API-key structured transport", async () => {
    const repository = {
      resolveModelForService: vi.fn(async () => ({
        model: MODEL,
        reason: "matched-active-model" as const
      })),
      selectProviderWithCredential: vi.fn(async () => ({
        auth_method: "api_key",
        encrypted_credential: { ciphertext: "sealed" },
        base_url: null
      }))
    } as unknown as AiRepository;
    const decryptJson = vi.fn(() => ({ apiKey: "fixture-key" }));
    const generateStructured = vi.fn(async () => ({
      rawObject: ACTIONABLE_SIGNALS,
      usage: { inputTokens: 1, outputTokens: 1 }
    }));
    const createAdapter = vi.fn(() => ({ generateStructured }));
    const createCliStructuredAdapter = vi.fn();
    const deps = buildEmailExtractDeps({} as DataContextDb, repository, { decryptJson } as never, {
      createAdapter,
      createCliStructuredAdapter
    });

    const model = await deps.selectModel("economy");
    const reply = await deps.runChat(model!, "Extract actionable email signals.");

    expect(JSON.parse(reply.text)).toEqual(ACTIONABLE_SIGNALS);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(decryptJson).toHaveBeenCalledTimes(1);
    expect(createCliStructuredAdapter).not.toHaveBeenCalled();
  });
});
