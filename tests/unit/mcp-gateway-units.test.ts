import { describe, expect, it } from "vitest";

import {
  ConfirmationRegistry,
  InvalidSessionTokenError,
  resolvePolicy,
  SessionTokenRegistry,
  ToolInputValidationError,
  validateToolInput
} from "@jarv1s/ai";
import type { ModuleAssistantToolManifest, ToolContext, ToolResult } from "@jarv1s/module-sdk";

describe("module-sdk tool contract", () => {
  it("lets a module declare a tool with an execute handler", async () => {
    const ctx: ToolContext = { actorUserId: "u1", requestId: "r1", chatSessionId: "s1" };
    const tool: ModuleAssistantToolManifest = {
      name: "example.read",
      description: "Echo back a value.",
      permissionId: "example.view",
      risk: "read",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
      execute: async (_scopedDb, input): Promise<ToolResult> => ({ data: { echo: input.value } })
    };

    const result = await tool.execute!({} as never, { value: "hi" }, ctx);
    expect(result.data).toEqual({ echo: "hi" });
  });
});

describe("gateway policy", () => {
  it("runs reads, confirms writes, always confirms destructive", () => {
    expect(resolvePolicy("read")).toBe("run");
    expect(resolvePolicy("write")).toBe("confirm");
    expect(resolvePolicy("destructive")).toBe("confirm");
  });
});

describe("session token registry", () => {
  it("mints a token that resolves to its identity, and fails after revoke", () => {
    const registry = new SessionTokenRegistry();
    const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    expect(registry.verify(token)).toEqual({
      actorUserId: "u1",
      chatSessionId: "s1",
      allowedToolNames: null
    });

    registry.revoke(token);
    expect(() => registry.verify(token)).toThrow(InvalidSessionTokenError);
    expect(() => registry.verify("never-minted")).toThrow(InvalidSessionTokenError);
  });

  it("expires a token once its TTL elapses with no activity", () => {
    let nowMs = 1_000;
    const registry = new SessionTokenRegistry({ clock: { now: () => nowMs }, ttlMs: 10_000 });
    const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    nowMs += 9_999;
    expect(registry.verify(token).actorUserId).toBe("u1"); // still inside window

    // verify() slid the window forward; advance past the *new* expiry.
    nowMs += 10_000;
    expect(() => registry.verify(token)).toThrow(InvalidSessionTokenError);
    // A second verify on the same (now-deleted) token still fails.
    expect(() => registry.verify(token)).toThrow(InvalidSessionTokenError);
  });

  it("verify() slides the TTL so an in-use token never expires mid-flight", () => {
    let nowMs = 0;
    const registry = new SessionTokenRegistry({ clock: { now: () => nowMs }, ttlMs: 10_000 });
    const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    // Verify every 9s for a "long turn" well past one TTL window — it stays valid.
    for (let i = 0; i < 20; i++) {
      nowMs += 9_000;
      expect(registry.verify(token).actorUserId).toBe("u1");
    }
  });

  it("touchBySessionId refreshes the TTL for an active-but-tool-idle session", () => {
    let nowMs = 0;
    const registry = new SessionTokenRegistry({ clock: { now: () => nowMs }, ttlMs: 10_000 });
    const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    nowMs += 9_000;
    registry.touchBySessionId("s1"); // chat activity, no tool call
    nowMs += 9_000; // 18s since mint, but only 9s since touch
    expect(registry.verify(token).actorUserId).toBe("u1");

    // touch only affects the matching session.
    nowMs += 9_000;
    registry.touchBySessionId("other-session");
    nowMs += 2_000;
    expect(() => registry.verify(token)).toThrow(InvalidSessionTokenError);
  });

  it("sweeps expired entries on mint so orphaned tokens cannot accumulate", () => {
    let nowMs = 0;
    const registry = new SessionTokenRegistry({ clock: { now: () => nowMs }, ttlMs: 10_000 });
    const orphan = registry.mint({
      actorUserId: "u1",
      chatSessionId: "s1",
      allowedToolNames: null
    });

    nowMs += 20_000; // orphan now expired, never revoked
    // A fresh mint sweeps the expired orphan; verifying it confirms it is gone.
    registry.mint({ actorUserId: "u2", chatSessionId: "s2", allowedToolNames: null });
    expect(() => registry.verify(orphan)).toThrow(InvalidSessionTokenError);
  });
});

describe("confirmation registry", () => {
  it("settles an awaited id with the resolved status", async () => {
    const registry = new ConfirmationRegistry();
    const pending = registry.awaitResolution("a1", 1000);
    registry.resolve("a1", "confirmed");
    await expect(pending).resolves.toBe("confirmed");
  });

  it("returns 'timeout' when not resolved in time", async () => {
    const registry = new ConfirmationRegistry();
    await expect(registry.awaitResolution("a2", 10)).resolves.toBe("timeout");
  });

  it("ignores resolve for an unknown id", () => {
    const registry = new ConfirmationRegistry();
    expect(() => registry.resolve("nope", "confirmed")).not.toThrow();
  });
});

describe("tool input validation", () => {
  const schema = {
    type: "object",
    required: ["taskId"],
    properties: { taskId: { type: "string" }, count: { type: "number" } }
  };

  it("accepts valid input", () => {
    expect(validateToolInput(schema, { taskId: "t1", count: 2 })).toEqual({
      taskId: "t1",
      count: 2
    });
  });

  it("rejects a missing required key", () => {
    expect(() => validateToolInput(schema, { count: 2 })).toThrow(ToolInputValidationError);
  });

  it("rejects a wrong declared type", () => {
    expect(() => validateToolInput(schema, { taskId: 5 })).toThrow(ToolInputValidationError);
  });

  it("accepts anything when no schema is declared", () => {
    expect(validateToolInput(undefined, { whatever: true })).toEqual({ whatever: true });
  });
});
