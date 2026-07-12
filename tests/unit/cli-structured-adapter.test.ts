import { describe, expect, it, vi } from "vitest";

import { CliStructuredAdapter } from "../../packages/chat/src/live/cli-structured-adapter.js";
import type { ChatEngineFactory } from "../../packages/chat/src/live/runtime.js";

describe("CliStructuredAdapter (#982/#869/#981)", () => {
  it("runs the existing one-shot engine and returns raw reply text", async () => {
    const launch = vi.fn(async () => ({ offset: 0 }));
    const submit = vi.fn(async (_text: string) => undefined);
    const factory: ChatEngineFactory = () => ({
      provider: "anthropic",
      launch,
      submit,
      readNew: vi.fn(async () => ({
        records: [{ kind: "reply" as const, text: '{"ok":true}' }],
        offset: 12,
        complete: true
      })),
      interrupt: vi.fn(async () => undefined),
      isAlive: vi.fn(async () => false),
      kill: vi.fn(async () => undefined)
    });
    const adapter = new CliStructuredAdapter("anthropic", factory, 1_000, 0);

    const result = await adapter.generateStructured({
      model: { provider_kind: "anthropic", provider_model_id: "claude-opus-4-8" },
      messages: [{ role: "user", content: "Extract a value" }],
      schema: { type: "object", required: ["ok"] },
      maxOutputTokens: 100
    });

    expect(result).toEqual({
      rawText: '{"ok":true}',
      usage: { inputTokens: 0, outputTokens: 0 }
    });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-8", personaText: expect.any(String) })
    );
    expect(submit.mock.calls[0]?.[0]).toContain("Respond with ONLY a JSON object");
  });
});
