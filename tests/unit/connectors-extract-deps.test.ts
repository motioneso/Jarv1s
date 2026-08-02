import { describe, expect, it, vi } from "vitest";

import type { AiRepository } from "@jarv1s/ai";
import { createCliStructuredAdapterFactory, type ChatEngineFactory } from "@jarv1s/chat";
import type { DataContextDb } from "@jarv1s/db";

import { buildEmailExtractDeps } from "../../packages/connectors/src/extract-deps.js";
import {
  extractEmailSignals,
  type ParsedEmail
} from "../../packages/connectors/src/email-extract.js";

const ACTIONABLE_SIGNALS = {
  summary: "A launch plan needs approval today.",
  billsDue: [],
  actionItems: [],
  deadlines: [],
  actionability: {
    category: "needs_action",
    reason: "The sender requests approval.",
    inferredSubject: "Launch plan approval",
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
  it("releases the CLI slot before the extraction after a caller timeout", async () => {
    const repository = {
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
    let engineIndex = 0;
    const engineFactory: ChatEngineFactory = vi.fn(() => {
      const index = engineIndex++;
      return {
        provider: "anthropic" as const,
        launch: vi.fn(async () => ({ offset: 0 })),
        submit: vi.fn(async () => undefined),
        readNew: vi.fn(async () => {
          if (index === 1) await new Promise((resolve) => setTimeout(resolve, 250));
          return {
            records: [{ kind: "reply" as const, text: JSON.stringify(ACTIONABLE_SIGNALS) }],
            offset: 1,
            complete: true
          };
        }),
        interrupt: vi.fn(async () => undefined),
        isAlive: vi.fn(async () => false),
        kill: vi.fn(async () => undefined)
      };
    });
    const warn = vi.fn();
    const deps = buildEmailExtractDeps(
      {} as DataContextDb,
      repository,
      { decryptJson: vi.fn() } as never,
      {
        createCliStructuredAdapter: createCliStructuredAdapterFactory(engineFactory),
        logger: { info: vi.fn(), warn }
      }
    );
    const fixtures: ParsedEmail[] = ["one", "two", "three"].map((id) => ({
      externalId: `synthetic-${id}`,
      historyId: `history-${id}`,
      subject: `Synthetic request ${id}`,
      from: "sender@example.invalid",
      recipients: ["recipient@example.invalid"],
      receivedAt: "2026-08-01T12:00:00.000Z",
      labelIds: ["INBOX"],
      snippet: "A harmless synthetic request.",
      body: `Please complete harmless synthetic request ${id}.`,
      bodyTruncated: false
    }));
    const outcomes = [];

    for (const fixture of fixtures) {
      const startedAt = performance.now();
      const result = await extractEmailSignals(fixture, deps, { callTimeoutMs: 100 });
      const elapsedMs = Math.round(performance.now() - startedAt);
      const actionability = result.signals.actionability;
      outcomes.push({
        summary: result.summary !== null,
        complete:
          Boolean(actionability?.inferredSubject) &&
          Boolean(actionability?.suggestedTasks?.length) &&
          (result.signals.confidence ?? 0) > 0,
        category:
          result.summary !== null ? "ok" : elapsedMs >= 80 ? "caller_timeout" : "provider_busy",
        elapsedMs
      });
    }
    expect(
      outcomes.map(({ summary, complete, category }) => ({ summary, complete, category })),
      `sanitized outcomes: ${JSON.stringify(outcomes)}`
    ).toEqual([
      { summary: true, complete: true, category: "ok" },
      { summary: false, complete: false, category: "caller_timeout" },
      { summary: true, complete: true, category: "ok" }
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "CLI structured generation is already busy" }),
      "ai.structured provider error"
    );
  });

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
    const signal = new AbortController().signal;
    const reply = await deps.runChat(model!, "Extract actionable email signals.", signal);

    expect(JSON.parse(reply.text)).toEqual(ACTIONABLE_SIGNALS);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ signal }));
    expect(decryptJson).toHaveBeenCalledTimes(1);
    expect(createCliStructuredAdapter).not.toHaveBeenCalled();
  });
});
