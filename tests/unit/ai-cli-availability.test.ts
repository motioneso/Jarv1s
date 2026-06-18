import { describe, it, expect } from "vitest";
import { cliAvailable, tmuxAvailable } from "../../packages/ai/src/cli-availability.js";

describe("cliAvailable", () => {
  it("maps anthropic to claude binary and returns true when found", async () => {
    const deps = { which: async (bin: string) => (bin === "claude" ? "/usr/bin/claude" : null) };
    expect(await cliAvailable("anthropic", deps)).toBe(true);
  });

  it("maps openai-compatible to codex binary and returns true when found", async () => {
    const deps = {
      which: async (bin: string) => (bin === "codex" ? "/usr/local/bin/codex" : null)
    };
    expect(await cliAvailable("openai-compatible", deps)).toBe(true);
  });

  it("maps google to agy binary and returns true when found", async () => {
    const deps = { which: async (bin: string) => (bin === "agy" ? "/usr/bin/agy" : null) };
    expect(await cliAvailable("google", deps)).toBe(true);
  });

  it("returns false when which returns null", async () => {
    const deps = { which: async (_bin: string) => null };
    expect(await cliAvailable("anthropic", deps)).toBe(false);
    expect(await cliAvailable("openai-compatible", deps)).toBe(false);
    expect(await cliAvailable("google", deps)).toBe(false);
  });

  it("returns false when wrong binary is found for provider", async () => {
    // Only "codex" is available, not "claude"
    const deps = {
      which: async (bin: string) => (bin === "codex" ? "/usr/local/bin/codex" : null)
    };
    expect(await cliAvailable("anthropic", deps)).toBe(false);
    expect(await cliAvailable("google", deps)).toBe(false);
  });
});

describe("tmuxAvailable", () => {
  it("returns true when tmux binary is found", async () => {
    const deps = { which: async (bin: string) => (bin === "tmux" ? "/usr/bin/tmux" : null) };
    expect(await tmuxAvailable(deps)).toBe(true);
  });

  it("returns false when tmux binary is not found", async () => {
    const deps = { which: async (_bin: string) => null };
    expect(await tmuxAvailable(deps)).toBe(false);
  });
});
