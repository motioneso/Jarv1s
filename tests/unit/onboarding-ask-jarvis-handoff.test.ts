import { describe, expect, it } from "vitest";

import {
  ASK_JARVIS_STARTER,
  consumeAskJarvis,
  requestAskJarvis
} from "../../apps/web/src/onboarding/ask-jarvis-handoff.js";

/** Minimal in-memory storage implementing the Pick<Storage, ...> the handoff accepts. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k)
  };
}

describe("ask-jarvis-handoff", () => {
  it("ASK_JARVIS_STARTER is a non-empty, provider-agnostic setup-check prompt", () => {
    expect(ASK_JARVIS_STARTER.trim().length).toBeGreaterThan(0);
    expect(ASK_JARVIS_STARTER.toLowerCase()).toContain("setup");
    // Provider-agnostic: never names a concrete provider/model (Hard Invariant).
    expect(ASK_JARVIS_STARTER.toLowerCase()).not.toMatch(
      /anthropic|claude|openai|gpt|gemini|google|codex|ollama/
    );
  });

  it("consume returns false when nothing was requested", () => {
    expect(consumeAskJarvis(memoryStorage())).toBe(false);
  });

  it("request then consume returns true (the handoff crosses the remount)", () => {
    const storage = memoryStorage();
    requestAskJarvis(storage);
    expect(consumeAskJarvis(storage)).toBe(true);
  });

  it("is one-shot: a second consume returns false (a refresh does not re-trigger)", () => {
    const storage = memoryStorage();
    requestAskJarvis(storage);
    expect(consumeAskJarvis(storage)).toBe(true);
    expect(consumeAskJarvis(storage)).toBe(false);
  });

  it("degrades silently when storage is unavailable (no throw)", () => {
    expect(() => requestAskJarvis(undefined)).not.toThrow();
    expect(consumeAskJarvis(undefined)).toBe(false);
  });

  it("swallows storage errors (private browsing / quota) instead of crashing the finish path", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      }
    };
    expect(() => requestAskJarvis(throwing)).not.toThrow();
    expect(consumeAskJarvis(throwing)).toBe(false);
  });
});
