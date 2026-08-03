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

  it("keeps a valid reply that becomes readable during bounded CLI teardown", async () => {
    let tornDown = false;
    const factory: ChatEngineFactory = () => ({
      provider: "anthropic",
      launch: vi.fn(async () => ({ offset: 0 })),
      submit: vi.fn(async () => undefined),
      readNew: vi.fn(async () =>
        tornDown
          ? {
              records: [{ kind: "reply" as const, text: '{"ok":true}' }],
              offset: 12,
              complete: true
            }
          : { records: [], offset: 0, complete: false }
      ),
      interrupt: vi.fn(async () => undefined),
      isAlive: vi.fn(async () => !tornDown),
      kill: vi.fn(async () => {
        tornDown = true;
      })
    });
    const adapter = new CliStructuredAdapter("anthropic", factory, 5, 0);

    await expect(
      adapter.generateStructured({
        model: { provider_kind: "anthropic", provider_model_id: "configured-model" },
        messages: [{ role: "user", content: "Extract a value" }],
        schema: { type: "object", required: ["ok"] },
        maxOutputTokens: 100
      })
    ).resolves.toMatchObject({ rawText: '{"ok":true}' });
  });

  it("selects a waiting foreground call before FIFO background calls", async () => {
    let factoryCalls = 0;
    let releaseActive!: () => void;
    const activeReleased = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const started: string[] = [];
    const factory: ChatEngineFactory = () => {
      const call = factoryCalls++;
      return {
        provider: "anthropic",
        launch: vi.fn(async () => {
          return { offset: 0 };
        }),
        submit: vi.fn(async (text: string) => {
          started.push(
            ["active", "background-one", "background-two", "foreground"].find((marker) =>
              text.includes(marker)
            ) ?? "unknown"
          );
        }),
        readNew: vi.fn(async () => {
          if (call === 0) await activeReleased;
          return {
            records: [{ kind: "reply" as const, text: `{"call":${call}}` }],
            offset: 1,
            complete: true
          };
        }),
        interrupt: vi.fn(async () => undefined),
        isAlive: vi.fn(async () => false),
        kill: vi.fn(async () => undefined)
      };
    };
    const adapter = new CliStructuredAdapter("anthropic", factory, 1_000, 0);
    const inputFor = (priority: "foreground" | "background", marker: string) => ({
      model: { provider_kind: "anthropic" as const, provider_model_id: "configured-model" },
      messages: [{ role: "user" as const, content: marker }],
      schema: { type: "object" },
      maxOutputTokens: 100,
      priority
    });

    const active = adapter.generateStructured(inputFor("foreground", "active"));
    await vi.waitFor(() => expect(started).toEqual(["active"]));
    const backgroundOne = adapter.generateStructured(inputFor("background", "background-one"));
    const backgroundTwo = adapter.generateStructured(inputFor("background", "background-two"));
    const foreground = adapter.generateStructured(inputFor("foreground", "foreground"));

    releaseActive();
    await Promise.all([active, backgroundOne, backgroundTwo, foreground]);

    expect(started).toEqual(["active", "foreground", "background-one", "background-two"]);
  });

  it("reports a print child exit when no transcript reply becomes readable", async () => {
    const events: Array<{ kind: string; exit?: string }> = [];
    const factory: ChatEngineFactory = () => ({
      provider: "anthropic",
      launch: vi.fn(async () => ({ offset: 0 })),
      submit: vi.fn(async () => undefined),
      readNew: vi.fn(async () => ({ records: [], offset: 0, complete: false })),
      interrupt: vi.fn(async () => undefined),
      isAlive: vi.fn(async () => false),
      kill: vi.fn(async () => undefined)
    });
    const adapter = new CliStructuredAdapter("anthropic", factory, 50, 0);

    await expect(
      adapter.generateStructured({
        model: { provider_kind: "anthropic", provider_model_id: "configured-model" },
        messages: [{ role: "user", content: "Return one JSON object." }],
        schema: { type: "object" },
        maxOutputTokens: 100,
        telemetry: { emit: (event) => events.push({ kind: event.kind, exit: event.exit }) }
      })
    ).rejects.toMatchObject({ name: "CliChatUnavailableError" });

    expect(events.map((event) => event.kind)).toEqual(["invoked", "exit", "elapsed"]);
    expect(events[1]).toMatchObject({ kind: "exit", exit: "no-reply" });
  });
});
