import { describe, expect, it, vi } from "vitest";

import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import type { EngineLaunchOpts, TranscriptRecord } from "../../packages/chat/src/live/types.js";

class FakeEngine {
  readonly provider = "anthropic" as const;
  killed = false;
  purged = false;
  async launch(_opts: EngineLaunchOpts): Promise<{ offset: number }> {
    return { offset: 0 };
  }
  async submit(_text: string): Promise<void> {}
  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    return { records: [], offset: afterOffset, complete: true };
  }
  async isAlive(): Promise<boolean> {
    return !this.killed;
  }
  async kill(): Promise<void> {
    this.killed = true;
  }
  async purgeTranscripts(): Promise<void> {
    this.purged = true;
  }
  async interrupt(): Promise<void> {}
}

function privateDeps(engine: FakeEngine, incognito: boolean, now = () => 0) {
  return {
    engineFactory: () => engine,
    persistence: {
      resolveActiveProvider: vi.fn().mockResolvedValue({ provider: "anthropic", model: "sonnet" }),
      listPriorTurns: vi.fn().mockResolvedValue({ recent: [], oldSummary: null }),
      recordTurn: vi.fn().mockResolvedValue(undefined),
      openNewConversation: vi.fn().mockResolvedValue(undefined),
      getThreadContext: vi.fn().mockResolvedValue({ threadTitle: null, localTimezone: null }),
      touchExistingThread: vi.fn().mockResolvedValue(true),
      getCurrentThreadState: vi.fn().mockResolvedValue({ id: "thread-private", incognito }),
      deleteThread: vi.fn().mockResolvedValue(undefined)
    },
    personaFs: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined)
    },
    clock: { now },
    idleMs: 10,
    neutralBase: "/tmp",
    persona: "You are Jarvis."
  };
}

describe("ChatSessionManager private cleanup", () => {
  it("endPrivateSession kills engine, purges transcripts, deletes bookkeeping, and revokes token", async () => {
    const engine = new FakeEngine();
    const revoke = vi.fn();
    const deps = privateDeps(engine, true);
    const manager = new ChatSessionManager({ ...deps, revokeMcpToken: revoke });
    await manager.ensureSession("u1", "Ben");

    await manager.endPrivateSession("u1");

    expect(engine.killed).toBe(true);
    expect(engine.purged).toBe(true);
    expect(deps.persistence.deleteThread).toHaveBeenCalledWith("u1", "thread-private");
    expect(revoke).toHaveBeenCalledWith("u1");
  });

  it("clear deletes an outgoing private bookkeeping thread before opening the next chat", async () => {
    const engine = new FakeEngine();
    const deps = privateDeps(engine, true);
    const manager = new ChatSessionManager(deps);
    await manager.ensureSession("u1", "Ben");

    await manager.clear("u1");

    expect(engine.killed).toBe(true);
    expect(engine.purged).toBe(true);
    expect(deps.persistence.deleteThread).toHaveBeenCalledWith("u1", "thread-private");
    expect(deps.persistence.openNewConversation).toHaveBeenCalledWith("u1", undefined);
  });

  it("reapIdle skips private sessions with subscribers and reaps private sessions without subscribers", async () => {
    let now = 0;
    const kept = new FakeEngine();
    const keptDeps = privateDeps(kept, true, () => now);
    const keptManager = new ChatSessionManager(keptDeps);
    await keptManager.ensureSession("u1", "Ben");
    const unsubscribe = keptManager.subscribe("u1", () => undefined);
    now = 20;
    await keptManager.reapIdle();
    expect(kept.killed).toBe(false);
    unsubscribe();

    const reaped = new FakeEngine();
    const reapedDeps = privateDeps(reaped, true, () => now);
    const reapedManager = new ChatSessionManager(reapedDeps);
    await reapedManager.ensureSession("u1", "Ben");
    now = 40;
    await reapedManager.reapIdle();

    expect(reaped.killed).toBe(true);
    expect(reaped.purged).toBe(true);
    expect(reapedDeps.persistence.deleteThread).toHaveBeenCalledWith("u1", "thread-private");
  });

  it("ends a private session after last subscriber detaches, unless a subscriber returns first", async () => {
    vi.useFakeTimers();
    try {
      const engine = new FakeEngine();
      const manager = new ChatSessionManager(privateDeps(engine, true));
      await manager.ensureSession("u1", "Ben");

      const first = manager.subscribe("u1", () => undefined);
      first();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(engine.killed).toBe(false);

      const second = manager.subscribe("u1", () => undefined);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(engine.killed).toBe(false);

      second();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(engine.killed).toBe(true);
      expect(engine.purged).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
