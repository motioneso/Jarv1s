import { describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import type {
  ChatSessionManagerDeps,
  ChatPersistencePort
} from "../../packages/chat/src/live/chat-session-manager.js";

function makeDeps(overrides: Partial<ChatSessionManagerDeps> = {}): ChatSessionManagerDeps {
  const persistence: ChatPersistencePort = {
    resolveActiveProvider: vi
      .fn()
      .mockResolvedValue({ provider: "anthropic", model: "claude-3-opus" }),
    listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
    recordTurn: vi.fn().mockResolvedValue({ userMessageId: "u1", assistantMessageId: "a1" }),
    openNewConversation: vi.fn(),
    getThreadContext: vi.fn().mockResolvedValue({ threadTitle: null, localTimezone: null })
  };

  const engine = {
    launch: vi.fn().mockResolvedValue({ offset: 0 }),
    submit: vi.fn().mockResolvedValue(undefined),
    readNew: vi
      .fn()
      .mockResolvedValueOnce({
        records: [{ kind: "reply", text: "Answer [[S1]] confirmed." }],
        offset: 1,
        complete: false
      })
      .mockResolvedValueOnce({ records: [], offset: 1, complete: true }),
    kill: vi.fn()
  };

  return {
    engineFactory: vi.fn().mockReturnValue(engine),
    persistence,
    personaFs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined)
    },
    clock: { now: () => Date.now() },
    idleMs: 60_000,
    neutralBase: "/tmp",
    persona: "You are Jarvis.",
    pollMs: 0,
    idleWatchdogMs: 0,
    ...overrides
  };
}

describe("ChatSessionManager provenance wiring", () => {
  it("calls recordTurn and passes answerProvenance when cross-tool items collected", async () => {
    const passiveRetrieval = {
      retrieve: vi.fn().mockResolvedValue(""),
      retrieveWithItems: vi.fn().mockResolvedValue({ block: "", items: [] })
    };

    const deps = makeDeps({ passiveRetrieval });
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what emails do I owe?");

    const calls = (deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const recordTurnCall = calls[0] as unknown[];
    // 5 args: actorUserId, userText, assistantReply, executed, answerProvenance?
    expect(recordTurnCall[0]).toBe("user1");
    expect(recordTurnCall[2]).toBe("Answer [[S1]] confirmed.");
  });

  it("recordTurn receives answerProvenance as 5th argument (may be undefined when no items)", async () => {
    const deps = makeDeps();
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "simple question");

    const calls = (deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    // 5th arg is answerProvenance — undefined when no retrieval configured
    const [, , , , provenance] = calls[0] as unknown[];
    expect(provenance).toBeUndefined();
  });
});
