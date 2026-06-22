import { describe, expect, it } from "vitest";

import { makeProviderConnectionCheckProbe } from "../../packages/module-registry/src/chat-multiplexer.js";
import type { TmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("makeProviderConnectionCheckProbe", () => {
  it("checks Claude with claude auth status instead of opening an interactive engine", async () => {
    const runs: Array<{ cmd: string; args: readonly string[] }> = [];
    const commandIo = {
      run: async (cmd, args) => {
        runs.push({ cmd, args });
        return { code: 0, stdout: JSON.stringify({ loggedIn: true }) };
      }
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("anthropic provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    const result = await probe("anthropic");

    expect(result).toEqual({ status: "ready" });
    expect(runs).toEqual([{ cmd: "claude", args: ["auth", "status"] }]);
  });

  it("treats logged-out Claude auth status as needing login", async () => {
    const commandIo = {
      run: async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: false }) })
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("anthropic provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    await expect(probe("anthropic")).resolves.toEqual({ status: "needs_login" });
  });

  it("checks Codex with codex login status instead of opening an interactive engine", async () => {
    const runs: Array<{ cmd: string; args: readonly string[] }> = [];
    const commandIo = {
      run: async (cmd, args) => {
        runs.push({ cmd, args });
        return { code: 0, stdout: "Logged in using ChatGPT\n" };
      }
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("codex provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    const result = await probe("openai-compatible");

    expect(result).toEqual({ status: "ready" });
    expect(runs).toEqual([{ cmd: "codex", args: ["login", "status"] }]);
  });

  it("treats logged-out Codex login status as needing login", async () => {
    const commandIo = {
      run: async () => ({ code: 1, stdout: "Not logged in\n" })
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("codex provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    await expect(probe("openai-compatible")).resolves.toEqual({ status: "needs_login" });
  });

  it("checks Google with agy print mode instead of opening an interactive engine", async () => {
    const runs: Array<{ cmd: string; args: readonly string[]; cwd?: string }> = [];
    const commandIo = {
      run: async (cmd, args, opts) => {
        runs.push({ cmd, args, cwd: opts?.cwd });
        return { code: 0, stdout: "OK\n" };
      }
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("google provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    const result = await probe("google");

    expect(result).toEqual({ status: "ready" });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cmd).toBe("agy");
    expect(runs[0]!.args).toEqual(["--print", "Reply with exactly OK."]);
    expect(runs[0]!.cwd).toMatch(/jarv1s-provider-check-/);
  });

  it("treats an agy authentication prompt as needing login", async () => {
    const commandIo = {
      run: async () => ({
        code: 0,
        stdout: "Waiting for authentication (timeout 30s)...\nError: authentication timed out\n"
      })
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("google provider checks should not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    await expect(probe("google")).resolves.toEqual({ status: "needs_login" });
  });

  it("treats a non-auth Google crash as error, not needs_login", async () => {
    const commandIo = {
      run: async () => ({
        code: 1,
        stdout: "Fatal: agy binary crashed (segfault)\n",
        stderr: ""
      })
    } satisfies Pick<TmuxIo, "run">;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("google checks must not open an interactive engine");
      },
      cliPresent: async () => true,
      skipInstallCheck: true,
      commandIo
    });

    await expect(probe("google")).resolves.toEqual({ status: "error" });
  });
});
