/**
 * Unit tests for ChatSessionManager — the per-user live-session orchestrator.
 *
 * No real tmux/DB/fs: every side-effect (engine, persistence, persona fs, clock)
 * is injected as an in-memory fake. The manager is asserted purely against the
 * behaviour it drives across those seams.
 */
import { describe, expect, it } from "vitest";

import type { ProviderKind } from "../../packages/ai/src/index.js";
import {
  ChatSessionManager,
  type ChatPersistencePort,
  type ChatSessionManagerDeps,
  type Clock
} from "../../packages/chat/src/live/chat-session-manager.js";
import type { PersonaFs } from "../../packages/chat/src/live/persona.js";
import type { CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "../../packages/chat/src/live/types.js";

// ─── fakes ───────────────────────────────────────────────────────────────────

/**
 * Fake engine: records launch opts + submitted text, and serves a single
 * scripted reply on the first readNew after each submit.
 */
class FakeEngine implements CliChatEngine {
  launchCount = 0;
  killed = false;
  readonly launchOpts: EngineLaunchOpts[] = [];
  readonly submitted: string[] = [];
  cleared = 0;

  /** Pending reply records to drain on the next readNew (set on submit). */
  private pending: TranscriptRecord[] = [];
  private alive = true;

  constructor(
    public readonly provider: ProviderKind,
    public readonly sessionKey: string,
    private readonly replyFor: (text: string) => string
  ) {}

  async launch(opts: EngineLaunchOpts): Promise<void> {
    this.launchCount += 1;
    this.launchOpts.push(opts);
  }

  async submit(text: string): Promise<void> {
    this.submitted.push(text);
    this.pending = [
      { kind: "thinking", text: "considering" },
      { kind: "reply", text: this.replyFor(text) }
    ];
  }

  async clear(): Promise<void> {
    this.cleared += 1;
    this.pending = [];
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.pending.length === 0) {
      return { records: [], offset: afterOffset, complete: false };
    }
    const records = this.pending;
    this.pending = [];
    return { records, offset: afterOffset + 1, complete: true };
  }

  async isAlive(): Promise<boolean> {
    return this.alive;
  }

  async kill(): Promise<void> {
    this.killed = true;
    this.alive = false;
  }
}

class FakePersistence implements ChatPersistencePort {
  active: { provider: ProviderKind; model: string } = {
    provider: "anthropic",
    model: "claude-x"
  };
  turns: { role: "user" | "assistant"; content: string }[] = [];
  readonly recorded: {
    userText: string;
    assistantReply: string;
    executed: { provider: ProviderKind; model: string };
  }[] = [];
  newConversations = 0;

  async resolveActiveProvider(): Promise<{ provider: ProviderKind; model: string }> {
    return this.active;
  }

  async listPriorTurns(): Promise<{ role: "user" | "assistant"; content: string }[]> {
    return [...this.turns];
  }

  async recordTurn(
    _actorUserId: string,
    userText: string,
    assistantReply: string,
    executed: { provider: ProviderKind; model: string }
  ): Promise<void> {
    this.recorded.push({ userText, assistantReply, executed });
    this.turns.push({ role: "user", content: userText });
    this.turns.push({ role: "assistant", content: assistantReply });
  }

  async openNewConversation(): Promise<void> {
    this.newConversations += 1;
    this.turns = [];
  }
}

class FakeClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const noopPersonaFs: PersonaFs = {
  async mkdir() {},
  async writeFile() {}
};

// ─── harness ─────────────────────────────────────────────────────────────────

interface Harness {
  manager: ChatSessionManager;
  persistence: FakePersistence;
  clock: FakeClock;
  engines: FakeEngine[];
}

function makeManager(over: Partial<ChatSessionManagerDeps> = {}): Harness {
  const persistence = new FakePersistence();
  const clock = new FakeClock();
  const engines: FakeEngine[] = [];

  const deps: ChatSessionManagerDeps = {
    engineFactory: (provider, sessionKey) => {
      const e = new FakeEngine(provider, sessionKey, (text) => `reply to: ${text}`);
      engines.push(e);
      return e;
    },
    persistence,
    personaFs: noopPersonaFs,
    clock,
    idleMs: 1_000,
    neutralBase: "/tmp/jarvis-test",
    persona: "I am Jarvis, {{userName}}.",
    pollMs: 0,
    ...over
  };

  return { manager: new ChatSessionManager(deps), persistence, clock, engines };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("ChatSessionManager", () => {
  it("launches exactly once per user and reuses the engine on a second turn", async () => {
    const { manager, engines } = makeManager();

    await manager.submitTurn("user-1", "Ben", "hello");
    await manager.submitTurn("user-1", "Ben", "again");

    expect(engines).toHaveLength(1);
    expect(engines[0]?.launchCount).toBe(1);
    expect(engines[0]?.submitted).toEqual(["hello", "again"]);
  });

  it("emits records to subscribers, returns the reply, and persists the turn", async () => {
    const { manager, persistence } = makeManager();

    const seen: TranscriptRecord[] = [];
    const unsubscribe = manager.subscribe("user-1", (r) => seen.push(r));

    const { reply } = await manager.submitTurn("user-1", "Ben", "hello");
    unsubscribe();

    expect(reply).toBe("reply to: hello");
    // user echo + thinking + reply all fanned out
    expect(seen).toContainEqual({ kind: "user", text: "hello" });
    expect(seen).toContainEqual({ kind: "thinking", text: "considering" });
    expect(seen).toContainEqual({ kind: "reply", text: "reply to: hello" });

    expect(persistence.recorded).toHaveLength(1);
    expect(persistence.recorded[0]).toEqual({
      userText: "hello",
      assistantReply: "reply to: hello",
      executed: { provider: "anthropic", model: "claude-x" }
    });
  });

  it("fans out records to multiple subscribers (multi-tab)", async () => {
    const { manager } = makeManager();
    const a: TranscriptRecord[] = [];
    const b: TranscriptRecord[] = [];
    manager.subscribe("user-1", (r) => a.push(r));
    manager.subscribe("user-1", (r) => b.push(r));

    await manager.submitTurn("user-1", "Ben", "hello");

    expect(a).toContainEqual({ kind: "reply", text: "reply to: hello" });
    expect(b).toContainEqual({ kind: "reply", text: "reply to: hello" });
  });

  it("reaps idle sessions; the next turn respawns a NEW engine and replays prior turns", async () => {
    const { manager, persistence, clock, engines } = makeManager();

    await manager.submitTurn("user-1", "Ben", "hello");
    expect(engines).toHaveLength(1);
    expect(persistence.turns).toHaveLength(2); // user + assistant

    clock.advance(2_000); // past idleMs
    await manager.reapIdle();
    expect(engines[0]?.killed).toBe(true);

    await manager.submitTurn("user-1", "Ben", "second question");

    // A brand-new engine was created.
    expect(engines).toHaveLength(2);
    expect(engines[1]?.launchCount).toBe(1);

    // The new engine was seeded with prior-turn content before the new prompt.
    const seed = engines[1]?.submitted[0] ?? "";
    expect(seed).toContain("hello");
    expect(seed).toContain("reply to: hello");
    // ...and the actual new prompt followed the replay.
    expect(engines[1]?.submitted).toContain("second question");
  });

  it("switchProvider kills the old engine, launches one for the new provider, and replays prior turns", async () => {
    const { manager, persistence, engines } = makeManager();

    await manager.submitTurn("user-1", "Ben", "hello");
    expect(engines[0]?.provider).toBe("anthropic");

    // Operator switched their active chat provider.
    persistence.active = { provider: "google", model: "gemini-y" };
    await manager.switchProvider("user-1", "Ben");

    expect(engines[0]?.killed).toBe(true);
    expect(engines).toHaveLength(2);
    expect(engines[1]?.provider).toBe("google");

    // Prior turns replayed into the new provider's engine.
    const seed = engines[1]?.submitted[0] ?? "";
    expect(seed).toContain("hello");
    expect(seed).toContain("reply to: hello");

    // Next turn persists under the NEW provider/model.
    await manager.submitTurn("user-1", "Ben", "still you?");
    const last = persistence.recorded.at(-1);
    expect(last?.executed).toEqual({ provider: "google", model: "gemini-y" });
  });

  it("clear() clears the live engine and opens a new conversation", async () => {
    const { manager, persistence, engines } = makeManager();

    await manager.submitTurn("user-1", "Ben", "hello");
    await manager.clear("user-1");

    expect(engines[0]?.cleared).toBe(1);
    expect(persistence.newConversations).toBe(1);
    expect(persistence.turns).toHaveLength(0);
  });

  it("does not double-launch when ensureSession is called concurrently", async () => {
    const { manager, engines } = makeManager();

    await Promise.all([
      manager.ensureSession("user-1", "Ben"),
      manager.ensureSession("user-1", "Ben")
    ]);

    expect(engines).toHaveLength(1);
    expect(engines[0]?.launchCount).toBe(1);
  });

  it("keeps separate engines per user", async () => {
    const { manager, engines } = makeManager();

    await manager.submitTurn("user-1", "Ben", "hi");
    await manager.submitTurn("user-2", "Ada", "hi");

    expect(engines).toHaveLength(2);
    expect(engines[0]?.sessionKey).not.toBe(engines[1]?.sessionKey);
  });
});
