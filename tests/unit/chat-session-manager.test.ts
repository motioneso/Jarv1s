import { describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";

function makeMinimalDeps(overrides: Partial<ConstructorParameters<typeof ChatSessionManager>[0]> = {}) {
  return {
    engineFactory: vi.fn(),
    persistence: {
      resolveActiveProvider: vi.fn(),
      listPriorTurns: vi.fn().mockResolvedValue([]),
      recordTurn: vi.fn(),
      openNewConversation: vi.fn()
    },
    personaFs: { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) },
    clock: { now: () => Date.now() },
    idleMs: 60_000,
    neutralBase: "/tmp",
    persona: "You are Jarvis.",
    ...overrides
  };
}

describe("ChatSessionManager.injectRecord", () => {
  it("fans out the record to all subscribers of that user", () => {
    const manager = new ChatSessionManager(makeMinimalDeps());
    const received: unknown[] = [];
    manager.subscribe("u1", (r) => received.push(r));

    manager.injectRecord("u1", { kind: "action_request", text: "Approve?", actionRequestId: "ar_1", toolName: "t", summary: "s" });

    expect(received).toHaveLength(1);
    expect((received[0] as { kind: string }).kind).toBe("action_request");
  });

  it("does nothing when no subscribers are registered", () => {
    const manager = new ChatSessionManager(makeMinimalDeps());
    expect(() => manager.injectRecord("u_nobody", { kind: "action_request", text: "x" })).not.toThrow();
  });
});

describe("ChatSessionManager MCP lifecycle hooks", () => {
  it("accepts mintMcpToken in deps without throwing", () => {
    const mint = vi.fn().mockReturnValue({ token: "jst_x", mcpServerUrl: "http://localhost:3000/api/mcp" });
    expect(() => new ChatSessionManager(makeMinimalDeps({ mintMcpToken: mint }))).not.toThrow();
  });
});
