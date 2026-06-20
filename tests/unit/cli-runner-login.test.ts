/**
 * cli-runner LOGIN tests (#342 Phase 3, login-contract §L):
 *   - the LoginService flow: begin → awaiting + allowlisted surface; poll → ready (probe + smoke);
 *     submitToken fed ARGV-FREE (load-buffer→paste-buffer, token never in any run arg); a stale
 *     loginId ⇒ LoginBadRequestError; cancel idempotent; startup sweep kills jarv1s-login-*;
 *   - §L.6.2 surface chokepoint: a non-allowlisted URL is dropped; a userCode is suppressed
 *     post-submit;
 *   - §L.6.3 redactExact: the pasted token is scrubbed from an error message;
 *   - §L.6.1 unified exclusivity gate (engine-host): chat-live ⇒ beginLogin unavailable;
 *     login-in-flight ⇒ launch unavailable + a 2nd beginLogin unavailable;
 *   - §L.1.3 adapter validation: orphan / too-broad-pathPrefix adapters are dropped.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, vi } from "vitest";

import type { TmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";
import { CliChatEngineHost } from "../../packages/cli-runner/src/engine-host.js";
import { LoginService, LoginBadRequestError } from "../../packages/cli-runner/src/login-service.js";
import { LOGIN_ADAPTERS, loadLoginAdapters } from "../../packages/cli-runner/src/login-adapters.js";
import { CliChatUnavailableError } from "../../packages/chat/src/live/errors.js";
import {
  LOGIN_SESSION_PREFIX,
  SESSION_PREFIX
} from "../../packages/chat/src/live/cli-chat-engine.js";
import type { ProbeProviderResult } from "../../packages/chat/src/live/cli-chat-engine.js";
import type { LoginAdapter } from "../../packages/chat/src/live/login-contract.js";
import type {
  CatalogEntry,
  ProviderCatalog
} from "../../packages/chat/src/live/install-contract.js";
import type { RpcProviderKind } from "../../packages/chat/src/live/rpc-contract.js";

/** A controllable probe whose status the test flips between calls. */
function makeProbe(initial: ProbeProviderResult): {
  fn: (p: RpcProviderKind) => Promise<ProbeProviderResult>;
  set: (r: ProbeProviderResult) => void;
} {
  let current = initial;
  return {
    fn: async () => current,
    set: (r) => {
      current = r;
    }
  };
}

/** A fake TmuxIo modelling a live mux-session set + a configurable capture-pane snapshot. */
function makeLoginIo(pane = ""): {
  io: TmuxIo;
  live: Set<string>;
  calls: { cmd: string; args: string[] }[];
  setPane: (p: string) => void;
} {
  const live = new Set<string>();
  const calls: { cmd: string; args: string[] }[] = [];
  let paneText = pane;
  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args: [...args] });
    if (cmd === "tmux") {
      const verb = args[0];
      if (verb === "new-session") {
        live.add(args[args.indexOf("-s") + 1]!);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (verb === "list-sessions") {
        return { code: 0, stdout: [...live].join("\n"), stderr: "" };
      }
      if (verb === "kill-session") {
        live.delete(args[args.indexOf("-t") + 1]!.replace(/^=/, ""));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (verb === "capture-pane") {
        return { code: 0, stdout: paneText, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  return {
    io: {
      run: run as unknown as TmuxIo["run"],
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined)
    },
    live,
    calls,
    setPane: (p) => {
      paneText = p;
    }
  };
}

let homeBase: string;
beforeEach(async () => {
  homeBase = await mkdtemp(path.join(tmpdir(), "jarv1s-login-test-"));
});

function makeService(
  io: TmuxIo,
  probe: (p: RpcProviderKind) => Promise<ProbeProviderResult>
): LoginService {
  return new LoginService({
    io,
    adapters: LOGIN_ADAPTERS,
    probe,
    homeBase,
    settleMs: 0,
    startTimeoutMs: 5_000,
    loginTimeoutMs: 60_000
  });
}

describe("LoginService flow (§L.2/§L.3)", () => {
  it("begin returns awaiting_token with the allowlisted authorization URL", async () => {
    const f = makeLoginIo("Open https://claude.ai/oauth/authorize?code=abc to continue");
    const probe = makeProbe({ status: "needs_login" });
    const svc = makeService(f.io, probe.fn);

    const loginId = svc.reserve("anthropic");
    const out = await svc.start(loginId);

    expect(out.status).toBe("awaiting_token"); // claude adapter mode = paste
    expect(out.authorizationUrl).toBe("https://claude.ai/oauth/authorize?code=abc");
    expect(await svc.isLoginActive()).toBe(true);
    await svc.cancel("anthropic", loginId);
    expect(await svc.isLoginActive()).toBe(false);
  });

  it("DROPS a non-allowlisted authorization URL (§L.6.2)", async () => {
    const f = makeLoginIo("Visit https://evil.example.com/oauth/authorize?code=x");
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    const loginId = svc.reserve("anthropic");
    const out = await svc.start(loginId);
    expect(out.authorizationUrl).toBeUndefined();
    await svc.cancel("anthropic", loginId);
  });

  it("poll settles ready (probe + runtime smoke) and tears the session down", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const probe = makeProbe({ status: "needs_login" });
    const svc = makeService(f.io, probe.fn);
    const loginId = svc.reserve("anthropic");
    await svc.start(loginId);
    expect(f.live.has(`${LOGIN_SESSION_PREFIX}anthropic`)).toBe(true);

    probe.set({ status: "ready" });
    const out = await svc.poll("anthropic", loginId);
    expect(out.status).toBe("ready");
    expect(f.live.has(`${LOGIN_SESSION_PREFIX}anthropic`)).toBe(false);
    expect(await svc.isLoginActive()).toBe(false);
  });

  it("submitToken feeds the code ARGV-FREE (load-buffer→paste-buffer) — token in NO run arg (§L.6.3)", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const probe = makeProbe({ status: "needs_login" });
    const svc = makeService(f.io, probe.fn);
    const loginId = svc.reserve("anthropic");
    await svc.start(loginId);

    const TOKEN = "PASTED-AUTH-CODE-9f8e7d6c";
    await svc.submitToken("anthropic", loginId, TOKEN);

    // The token was pasted via a tmux BUFFER (load-buffer), never as an argv.
    expect(f.calls.some((c) => c.cmd === "tmux" && c.args[0] === "load-buffer")).toBe(true);
    expect(f.calls.some((c) => c.cmd === "tmux" && c.args[0] === "paste-buffer")).toBe(true);
    for (const call of f.calls) {
      expect(call.args).not.toContain(TOKEN); // NEVER in /proc/cmdline (no send-keys-with-token)
    }
    await svc.cancel("anthropic", loginId);
  });

  it("NEVER surfaces a userCode after a submit, even if the pane echoes a code-shaped token (§L.6.2)", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const probe = makeProbe({ status: "needs_login" });
    const svc = makeService(f.io, probe.fn);
    const loginId = svc.reserve("anthropic");
    await svc.start(loginId);

    const TOKEN = "PASTEDCODE12345";
    f.setPane(`you typed ${TOKEN} into the prompt`);
    const out = await svc.submitToken("anthropic", loginId, TOKEN);
    expect(out.userCode).toBeUndefined();
    await svc.cancel("anthropic", loginId);
  });

  it("redactExact scrubs the pasted token from an error message (§L.6.3)", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const probe = makeProbe({ status: "needs_login" });
    const svc = makeService(f.io, probe.fn);
    const loginId = svc.reserve("anthropic");
    await svc.start(loginId);

    const TOKEN = "BADCODE-abcdef123456";
    probe.set({ status: "error", message: `provider rejected ${TOKEN} as invalid` });
    const out = await svc.submitToken("anthropic", loginId, TOKEN);
    expect(out.status).toBe("error");
    expect(out.message ?? "").not.toContain(TOKEN);
  });

  it("rejects a stale loginId with LoginBadRequestError", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    const loginId = svc.reserve("anthropic");
    await svc.start(loginId);
    await expect(svc.poll("anthropic", "not-the-id")).rejects.toBeInstanceOf(LoginBadRequestError);
    await svc.cancel("anthropic", loginId);
  });

  it("cancel is idempotent for a non-existent login", async () => {
    const f = makeLoginIo();
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    await expect(svc.cancel("anthropic", "nope")).resolves.toBeUndefined();
  });

  it("short-circuits to ready when the provider is already authenticated", async () => {
    const f = makeLoginIo();
    const svc = makeService(f.io, makeProbe({ status: "ready" }).fn);
    const loginId = svc.reserve("anthropic");
    const out = await svc.start(loginId);
    expect(out.status).toBe("ready");
    expect(await svc.isLoginActive()).toBe(false);
  });

  it("startupSweep kills every jarv1s-login-* session (§L.3.4)", async () => {
    const f = makeLoginIo();
    f.live.add(`${LOGIN_SESSION_PREFIX}anthropic`);
    f.live.add(`${LOGIN_SESSION_PREFIX}openai-compatible`);
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    await svc.startupSweep();
    expect(f.live.size).toBe(0);
  });

  it("rejects beginLogin for a provider with no adapter (agy)", async () => {
    const f = makeLoginIo();
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    expect(svc.hasAdapter("google")).toBe(false);
    expect(() => svc.reserve("google")).toThrow(LoginBadRequestError);
  });
});

describe("§L.6.1 unified exclusivity gate (engine-host)", () => {
  function makeHost(io: TmuxIo, svc: LoginService): CliChatEngineHost {
    return new CliChatEngineHost({
      io,
      neutralBase: "/data/cli-auth/chat",
      singleUser: true,
      loginService: svc,
      cliPresent: async () => true,
      multiplexerUsable: async () => true
    });
  }

  it("rejects a chat launch AND a 2nd beginLogin while a login is in flight", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    const host = makeHost(f.io, svc);

    const begun = await host.beginLogin("anthropic");
    expect(begun.status).toBe("awaiting_token");

    await expect(host.beginLogin("anthropic")).rejects.toBeInstanceOf(CliChatUnavailableError);
    await expect(
      host.launch("user-1", { provider: "anthropic", personaText: "p" })
    ).rejects.toBeInstanceOf(CliChatUnavailableError);

    await host.cancelLogin("anthropic", begun.loginId);
  });

  it("rejects beginLogin while a chat session is live", async () => {
    const f = makeLoginIo("https://claude.ai/oauth/authorize?code=abc");
    const svc = makeService(f.io, makeProbe({ status: "needs_login" }).fn);
    const host = makeHost(f.io, svc);
    f.live.add(`${SESSION_PREFIX}user-9`); // a live chat session
    await expect(host.beginLogin("anthropic")).rejects.toBeInstanceOf(CliChatUnavailableError);
  });
});

describe("§L.1.3 login-adapter validation", () => {
  const adapter = (provider: RpcProviderKind, pathPrefix = "/oauth"): LoginAdapter => ({
    provider,
    loginArgv: [provider === "anthropic" ? "claude" : "codex", "login"],
    mode: "paste",
    authUrlAllowlist: [{ host: "claude.ai", pathPrefix }],
    userCodePattern: /^[A-Za-z0-9]{6,}$/,
    extractSurface: () => ({})
  });

  const catalogWith = (anthropicStatus: "supported" | "blocked"): ProviderCatalog => {
    const entry = (p: RpcProviderKind, status: "supported" | "blocked"): CatalogEntry =>
      status === "supported"
        ? {
            provider: p,
            status,
            recipe: {
              kind: "npm",
              pkg: p === "anthropic" ? "@anthropic-ai/claude-code" : "@openai/codex",
              version: "1.0.0",
              lockfile: "x",
              binary: p === "anthropic" ? "claude" : "codex",
              selfUpdateDisable: { kind: "env", key: "X", value: "1" }
            }
          }
        : { provider: p, status, blockedReason: "blocked" };
    return {
      anthropic: entry("anthropic", anthropicStatus),
      "openai-compatible": entry("openai-compatible", "supported"),
      google: { provider: "google", status: "blocked", blockedReason: "spike" }
    };
  };

  it("accepts a complete adapter for an install-supported provider", () => {
    const { adapters, issues } = loadLoginAdapters(catalogWith("supported"), {
      anthropic: adapter("anthropic"),
      "openai-compatible": undefined,
      google: undefined
    });
    expect(adapters.anthropic).toBeDefined();
    expect(issues).toHaveLength(0);
  });

  it("DROPS an orphan adapter (provider not install-supported)", () => {
    const { adapters, issues } = loadLoginAdapters(catalogWith("blocked"), {
      anthropic: adapter("anthropic"),
      "openai-compatible": undefined,
      google: undefined
    });
    expect(adapters.anthropic).toBeUndefined();
    expect(issues.some((i) => i.provider === "anthropic")).toBe(true);
  });

  it("DROPS an adapter whose pathPrefix is too broad ('/')", () => {
    const { adapters, issues } = loadLoginAdapters(catalogWith("supported"), {
      anthropic: adapter("anthropic", "/"),
      "openai-compatible": undefined,
      google: undefined
    });
    expect(adapters.anthropic).toBeUndefined();
    expect(issues.some((i) => i.reason.includes("too broad"))).toBe(true);
  });
});
