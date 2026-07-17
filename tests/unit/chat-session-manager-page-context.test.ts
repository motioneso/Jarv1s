import { describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import type {
  ChatSessionManagerDeps,
  ChatPersistencePort
} from "../../packages/chat/src/live/chat-session-manager.js";
import type { PageContextSnapshotDto } from "../../packages/shared/src/index.js";

/**
 * #679 — ChatSessionManager page-context wiring.
 *
 * Covers: (a) a page-context block reaches the engine but never the persisted userText;
 * (b) a follow-up turn without pageContext reuses the session's cached snapshot;
 * (c) the cached snapshot expires after PAGE_CONTEXT_TTL_MS (5 minutes); (d) the
 * persistence call shape (and therefore the existing incognito gate, which lives
 * downstream of recordTurn/openNewConversation) is completely unaffected by pageContext.
 */

function pageContext(overrides: Partial<PageContextSnapshotDto> = {}): PageContextSnapshotDto {
  return {
    route: "/tasks",
    pageTitle: "Tasks",
    headings: ["Today"],
    buttons: ["Add task"],
    labels: [],
    visibleText: ["3 tasks due today"],
    focused: null,
    selectedText: null,
    errors: [],
    capturedAt: "2026-07-05T00:00:00.000Z",
    ...overrides
  };
}

/** Alternates: reply-not-complete, then complete-with-no-records — repeatable across turns. */
function makeAlternatingEngine() {
  let call = 0;
  return {
    launch: vi.fn().mockResolvedValue({ offset: 0 }),
    submit: vi.fn().mockResolvedValue(undefined),
    readNew: vi.fn().mockImplementation(async () => {
      call++;
      if (call % 2 === 1) {
        return {
          records: [{ kind: "reply", text: `reply-${Math.ceil(call / 2)}` }],
          offset: call,
          complete: false
        };
      }
      return { records: [], offset: call, complete: true };
    }),
    kill: vi.fn()
  };
}

function makeDeps(
  overrides: Partial<ChatSessionManagerDeps> = {},
  clockNow: { value: number } = { value: 0 }
): { deps: ChatSessionManagerDeps; engine: ReturnType<typeof makeAlternatingEngine> } {
  const persistence: ChatPersistencePort = {
    resolveActiveProvider: vi
      .fn()
      .mockResolvedValue({ provider: "anthropic", model: "claude-3-opus" }),
    listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
    recordTurn: vi.fn().mockResolvedValue({ userMessageId: "u1", assistantMessageId: "a1" }),
    openNewConversation: vi.fn(),
    getThreadContext: vi.fn().mockResolvedValue({ threadTitle: null, localTimezone: null }),
    touchExistingThread: vi.fn().mockResolvedValue(true)
  };

  const engine = makeAlternatingEngine();

  const deps: ChatSessionManagerDeps = {
    engineFactory: vi.fn().mockReturnValue(engine),
    persistence,
    personaFs: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined)
    },
    clock: { now: () => clockNow.value },
    idleMs: 60_000,
    neutralBase: "/tmp",
    persona: "You are Jarvis.",
    pollMs: 0,
    idleWatchdogMs: 0,
    ...overrides
  };
  return { deps, engine };
}

describe("ChatSessionManager page-context wiring (#679)", () => {
  it("folds the page-context block into the engine-bound text but never into the persisted userText", async () => {
    const { deps, engine } = makeDeps();
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what does this button do?", pageContext());

    const submittedText = (engine.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(submittedText).toContain("<page_context>");
    expect(submittedText).toContain("Route: /tasks");
    expect(submittedText).toContain("what does this button do?");

    const recordTurnCall = (deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    const persistedUserText = recordTurnCall?.[1] as string;
    expect(persistedUserText).toBe("what does this button do?");
    expect(persistedUserText).not.toContain("<page_context>");
    expect(persistedUserText).not.toContain("Route:");
  });

  it("does not attach any page-context block when no snapshot is provided", async () => {
    const { deps, engine } = makeDeps();
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "add a task called buy milk");

    const submittedText = (engine.submit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(submittedText).toBe("add a task called buy milk");
  });

  it("reuses the session's last snapshot on a follow-up turn that omits pageContext", async () => {
    const { deps, engine } = makeDeps();
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what does this button do?", pageContext());
    await manager.submitTurn("user1", "TestUser", "and what about that one?");

    const secondSubmittedText = (engine.submit as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[0] as string;
    expect(secondSubmittedText).toContain("<page_context>");
    expect(secondSubmittedText).toContain("Route: /tasks");
    expect(secondSubmittedText).toContain("and what about that one?");

    // Still never persisted on either turn.
    const calls = (deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]?.[1]).toBe("and what about that one?");
  });

  it("expires the reused snapshot after PAGE_CONTEXT_TTL_MS (5 minutes)", async () => {
    const clockNow = { value: 0 };
    const { deps, engine } = makeDeps({}, clockNow);
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what does this button do?", pageContext());

    // Advance past the 5-minute TTL.
    clockNow.value += 5 * 60_000 + 1;

    await manager.submitTurn("user1", "TestUser", "and what about that one?");

    const secondSubmittedText = (engine.submit as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[0] as string;
    expect(secondSubmittedText).not.toContain("<page_context>");
    expect(secondSubmittedText).toBe("and what about that one?");
  });

  it("reuses the snapshot when the follow-up arrives just under the TTL", async () => {
    const clockNow = { value: 0 };
    const { deps, engine } = makeDeps({}, clockNow);
    const manager = new ChatSessionManager(deps);

    await manager.submitTurn("user1", "TestUser", "what does this button do?", pageContext());
    clockNow.value += 5 * 60_000 - 1;
    await manager.submitTurn("user1", "TestUser", "and what about that one?");

    const secondSubmittedText = (engine.submit as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[0] as string;
    expect(secondSubmittedText).toContain("<page_context>");
  });

  it(
    "does not change the shape or count of persistence calls — the existing incognito gate " +
      "(downstream of recordTurn/openNewConversation, unmodified by this feature) sees an identical " +
      "call whether or not pageContext is attached",
    async () => {
      const withCtx = makeDeps();
      const withoutCtx = makeDeps();

      await new ChatSessionManager(withCtx.deps).submitTurn(
        "user1",
        "TestUser",
        "what does this button do?",
        pageContext()
      );
      await new ChatSessionManager(withoutCtx.deps).submitTurn(
        "user1",
        "TestUser",
        "what does this button do?"
      );

      const callsWith = (withCtx.deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock
        .calls;
      const callsWithout = (withoutCtx.deps.persistence.recordTurn as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(callsWith.length).toBe(1);
      expect(callsWithout.length).toBe(1);
      // Same 5-arg shape, same actorUserId/userText/assistantReply/executed regardless of pageContext.
      expect(callsWith[0]?.slice(0, 4)).toEqual(callsWithout[0]?.slice(0, 4));
    }
  );
});
