import { describe, expect, it } from "vitest";
import {
  SessionTokenRegistry,
  InvalidSessionTokenError
} from "../../packages/ai/src/gateway/session-tokens.js";

/**
 * #342 (RPC contract §5.3) — the reconciliation primitives on SessionTokenRegistry:
 * `listSessionIds()` enumerates the sessions the registry holds tokens for (the orphan-token
 * SOURCE that works even when the manager's `sessions` Map is empty after an api restart), and
 * `reconcile(liveSessionIds)` revokes every token whose session is not in the live set.
 */
function mint(registry: SessionTokenRegistry, chatSessionId: string): string {
  return registry.mint({
    actorUserId: chatSessionId,
    chatSessionId,
    allowedToolNames: null
  });
}

describe("SessionTokenRegistry.listSessionIds", () => {
  it("returns every distinct chatSessionId the registry holds a live token for", () => {
    const registry = new SessionTokenRegistry();
    mint(registry, "uA");
    mint(registry, "uB");
    expect(new Set(registry.listSessionIds())).toEqual(new Set(["uA", "uB"]));
  });

  it("is empty after all tokens are revoked", () => {
    const registry = new SessionTokenRegistry();
    const t = mint(registry, "uA");
    registry.revoke(t);
    expect(registry.listSessionIds()).toEqual([]);
  });

  it("omits expired tokens (purged before reporting)", () => {
    let now = 1_000;
    const registry = new SessionTokenRegistry({ clock: { now: () => now }, ttlMs: 100 });
    mint(registry, "uA");
    now = 2_000; // well past the 100ms TTL
    expect(registry.listSessionIds()).toEqual([]);
  });
});

describe("SessionTokenRegistry.reconcile", () => {
  it("revokes tokens whose session is NOT in the live set, keeps the rest", () => {
    const registry = new SessionTokenRegistry();
    const tokenA = mint(registry, "uA");
    const tokenB = mint(registry, "uB");

    registry.reconcile(new Set(["uA"])); // only uA is live

    // uA survives, uB is revoked.
    expect(registry.verify(tokenA).chatSessionId).toBe("uA");
    expect(() => registry.verify(tokenB)).toThrow(InvalidSessionTokenError);
    expect(registry.listSessionIds()).toEqual(["uA"]);
  });

  it("revokes ALL tokens when the live set is empty", () => {
    const registry = new SessionTokenRegistry();
    mint(registry, "uA");
    mint(registry, "uB");
    registry.reconcile(new Set());
    expect(registry.listSessionIds()).toEqual([]);
  });

  it("is a no-op when every held session is live (idempotent)", () => {
    const registry = new SessionTokenRegistry();
    const tokenA = mint(registry, "uA");
    registry.reconcile(new Set(["uA"]));
    registry.reconcile(new Set(["uA"]));
    expect(registry.verify(tokenA).chatSessionId).toBe("uA");
  });
});
