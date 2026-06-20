import { describe, expect, it, vi } from "vitest";
import {
  CliChatEngineImpl,
  deriveNeutralDir,
  killMuxSessionByName,
  listLiveMuxSessions,
  sanitizeSessionKey,
  probeProvider,
  SESSION_PREFIX
} from "../../packages/chat/src/live/cli-chat-engine.js";
import { CliChatUnavailableError } from "../../packages/chat/src/live/errors.js";
import type { Multiplexer } from "../../packages/ai/src/adapters/multiplexer.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

describe("CliChatEngineImpl — Claude MCP lockdown", () => {
  it("uses --allowedTools mcp__jarvis__* and the mcp-config PATH (token off the launch line)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "test-session", io);
    const launched = await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    // launch() now returns the post-drain offset (§4.0); the in-process engine does not
    // own the drain, so it returns { offset: 0 }.
    expect(launched).toEqual({ offset: 0 });

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    expect(sendKeysCall).toBeDefined();
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain("--allowedTools");
    expect(launchLine).toContain("mcp__jarvis__*");
    expect(launchLine).not.toContain('--tools ""');
    // §6.2: the launch line carries the mcp-config FILE PATH, never the token/JSON.
    expect(launchLine).toContain(".jarvis-claude-mcp.json");
    expect(launchLine).not.toContain("jst_abc");
    expect(launchLine).not.toContain("Bearer");
    expect(launchLine).not.toContain("Authorization");
    expect(launchLine).toContain("--permission-mode default");
    expect(launchLine).toContain("--strict-mcp-config");
    expect(launchLine).not.toContain("web_search");
    expect(launchLine).not.toContain("browser");
    expect(launchLine).not.toContain("browse");

    // The token + url live ONLY in the 0600 .jarvis-claude-mcp.json file (§6.2/§6.5).
    const mcpWrite = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith(".jarvis-claude-mcp.json")
    );
    expect(mcpWrite).toBeDefined();
    expect(mcpWrite![1]).toContain("jst_abc");
    expect(io.run).toHaveBeenCalledWith("chmod", ["600", "/tmp/neutral/.jarvis-claude-mcp.json"]);
  });

  it("removes the entire per-session neutral dir on kill (§6.5)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "kill-session", io);
    await engine.launch({
      neutralDir: "/tmp/neutral-kill",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });
    await engine.kill();
    // The whole dir is removed (covers the Claude mcp-config file + persona), not one file.
    expect(io.run).toHaveBeenCalledWith("rm", ["-rf", "/tmp/neutral-kill"]);
  });

  it("falls back to --tools '' when no mcpToken is provided", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "test-session", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain('--tools ""');
    expect(launchLine).not.toContain("--allowedTools");
    expect(launchLine).toContain("--permission-mode default");
    expect(launchLine).toContain("--strict-mcp-config");
    expect(launchLine).not.toContain("web_search");
    expect(launchLine).not.toContain("browser");
    expect(launchLine).not.toContain("browse");
  });
});

describe("CliChatEngineImpl — Codex launch", () => {
  it("launches codex with MCP config -c flags and a sourced token file", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("openai-compatible", "codex-session", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_codex",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain("codex");
    expect(launchLine).toContain(".jarvis-mcp-token.env");
    expect(launchLine).toContain('bearer_token_env_var="JARVIS_MCP_TOKEN"');
    expect(launchLine).not.toContain("JARVIS_MCP_TOKEN=jst_codex");
    expect(launchLine).not.toContain("jst_codex");
    expect(launchLine).toContain("mcp_servers.jarvis.url");
    expect(launchLine).toContain("shell_tool=false");
    expect(launchLine).toContain("apply_patch_tool=false");
    expect(launchLine).toContain("sandbox read-only");
    expect(launchLine).toContain("-a never");
    expect(launchLine).not.toContain("web_search");
    expect(launchLine).not.toContain("browser");
    expect(launchLine).not.toContain("browse");

    const writeCall = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith(".jarvis-mcp-token.env")
    );
    expect(writeCall?.[1]).toContain("jst_codex");
    expect(io.run).toHaveBeenCalledWith("chmod", ["600", "/tmp/neutral/.jarvis-mcp-token.env"]);

    await engine.kill();
    // §6.5: kill removes the ENTIRE per-session neutral dir (not just the token file).
    expect(io.run).toHaveBeenCalledWith("rm", ["-rf", "/tmp/neutral"]);
  });
});

describe("CliChatEngineImpl — Gemini launch", () => {
  it("writes .gemini/settings.json and launches agy with supported flags", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("google", "gemini-session", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_gemini",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    const writeCall = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes(".gemini/settings.json")
    );
    expect(writeCall).toBeDefined();
    const settingsContent = JSON.parse(writeCall![1] as string);
    expect(settingsContent.mcpServers.jarvis.httpUrl).toBe("http://127.0.0.1:3000/api/mcp");
    expect(settingsContent.mcpServers.jarvis.headers.Authorization).toBe("Bearer jst_gemini");

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain("agy");
    expect(launchLine).not.toContain("gemini");
    expect(launchLine).toContain("--sandbox");
    expect(launchLine).not.toContain("--allowed-mcp-server-names");
    expect(launchLine).not.toContain("web_search");
    expect(launchLine).not.toContain("browser");
    expect(launchLine).not.toContain("browse");
  });
});

describe("CliChatEngineImpl — homeBase seam (#deployable-stack §6)", () => {
  it("resolves the transcript path under the provided homeBase", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "host-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath().startsWith("/host-home/.claude/projects/")).toBe(true);
  });

  it("falls back to the OS home when no homeBase is given", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "local-session", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    expect(engine.transcriptPath()).not.toContain("/host-home/");
    expect(engine.transcriptPath()).toContain("/.claude/projects/");
  });
});

// Branch-review LOW (cli-chat-engine.ts:113): only Claude is launched with
// `--session-id`, so only Claude's transcript filename is `<sessionId>.jsonl`.
// Codex/Gemini name their own file (`rollout-…`/`session-…`); pinning
// `<sessionId>.jsonl` for them would read a file that never exists, so replies could
// never be read back. readNew() must resolve the NEWEST `.jsonl` under the glob dir.
describe("CliChatEngineImpl — non-Claude transcript resolution", () => {
  it("Claude still reads the session-id-pinned transcript path", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "claude-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    io.readFile.mockResolvedValue("");
    await engine.readNew(0);

    // Claude reads the pinned <sessionId>.jsonl directly; it never globs with `ls -t`.
    const lsCall = io.run.mock.calls.find((c: unknown[]) => c[0] === "ls");
    expect(lsCall).toBeUndefined();
    const readPath = io.readFile.mock.calls[0]?.[0] as string;
    expect(readPath).toMatch(/\/host-home\/\.claude\/projects\/.+\/[0-9a-f-]+\.jsonl$/);
  });

  it("Codex resolves the newest .jsonl in the glob dir (not <sessionId>.jsonl)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("openai-compatible", "codex-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_codex",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    // `ls -t` returns newest-first; the codex CLI named its own file.
    io.run.mockImplementation(async (cmd: string) => {
      if (cmd === "ls") {
        return {
          code: 0,
          stdout:
            "rollout-2026-06-13T10-00-00-abcdef.jsonl\nrollout-2026-06-13T09-00-00-old.jsonl\n",
          stderr: ""
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    io.readFile.mockResolvedValue("");

    await engine.readNew(0);

    const lsCall = io.run.mock.calls.find((c: unknown[]) => c[0] === "ls");
    expect(lsCall).toBeDefined();
    // The glob dir is under ~/.codex/sessions, NOT ~/.claude/projects.
    expect((lsCall![1] as string[])[1]).toContain("/host-home/.codex/sessions/");
    const readPath = io.readFile.mock.calls[0]?.[0] as string;
    expect(readPath).toContain("/host-home/.codex/sessions/");
    expect(readPath.endsWith("rollout-2026-06-13T10-00-00-abcdef.jsonl")).toBe(true);
  });

  it("Codex skips newer transcripts from other cwd values when resolving provider-check output", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("openai-compatible", "codex-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({
      neutralDir: "/tmp/jarv1s-provider-check-abc123",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_codex",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    io.run.mockImplementation(async (cmd: string) => {
      if (cmd === "ls") {
        return {
          code: 0,
          stdout:
            "rollout-2026-06-13T10-01-00-active-codex-session.jsonl\n" +
            "rollout-2026-06-13T10-00-00-provider-check.jsonl\n",
          stderr: ""
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    io.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("active-codex-session.jsonl")) {
        return [
          JSON.stringify({
            type: "session_meta",
            payload: { cwd: "~/Jarv1s" }
          }),
          JSON.stringify({
            type: "event_msg",
            payload: { type: "agent_message", message: "unrelated" }
          })
        ].join("\n");
      }
      return [
        JSON.stringify({
          type: "session_meta",
          payload: { cwd: "/tmp/jarv1s-provider-check-abc123" }
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_complete", last_agent_message: "OK" }
        })
      ].join("\n");
    });

    const result = await engine.readNew(0);

    const readPath = io.readFile.mock.calls.at(-1)?.[0] as string;
    expect(readPath.endsWith("rollout-2026-06-13T10-00-00-provider-check.jsonl")).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.records.at(-1)).toEqual({ kind: "reply", text: "OK" });
  });

  it("Codex readNew tolerates an empty glob dir (no .jsonl yet)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("openai-compatible", "codex-empty", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    io.run.mockImplementation(async (cmd: string) => {
      if (cmd === "ls") return { code: 0, stdout: "\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const res = await engine.readNew(0);
    expect(res.records).toEqual([]);
    expect(res.complete).toBe(false);
    expect(res.offset).toBe(0);
    // No transcript file was resolved, so readFile is never attempted.
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it("Gemini resolves the newest .jsonl under the cwd-specific ~/.gemini/tmp project chats dir", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("google", "gemini-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({
      neutralDir: "/tmp/jarv1s-provider-check-AbC123",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_gemini",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    io.run.mockImplementation(async (cmd: string) => {
      if (cmd === "ls") {
        return { code: 0, stdout: "session-2026-06-13T10-00-00-xyz.jsonl\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    io.readFile.mockResolvedValue("");

    await engine.readNew(0);

    const readPath = io.readFile.mock.calls[0]?.[0] as string;
    expect(readPath).toContain("/host-home/.gemini/tmp/jarv1s-provider-check-abc123/chats/");
    expect(readPath.endsWith("session-2026-06-13T10-00-00-xyz.jsonl")).toBe(true);
  });
});

// Branch-review LOW (cli-chat-engine.ts:253): the launch line carries the per-session
// MCP bearer token inline (Codex env-var prefix). A backend whose thrown error echoes
// the launch line must never carry the token into the server log via the wrapped cause.
describe("CliChatEngineImpl — failure-path token redaction", () => {
  function throwingMux(message: string): Multiplexer {
    return {
      kind: "tmux",
      open: vi.fn().mockRejectedValue(new Error(message)),
      submit: vi.fn(),
      isAlive: vi.fn().mockResolvedValue(false),
      kill: vi.fn(),
      attachCommand: () => ""
    };
  }

  it("redacts a token-bearing cause when mux.open() fails", async () => {
    const io = makeIo();
    const mux = throwingMux(
      "Command failed: tmux send-keys ... JARVIS_MCP_TOKEN=jst_supersecret codex --sandbox read-only"
    );
    const engine = new CliChatEngineImpl("openai-compatible", "codex-fail", io, { mux });

    let caught: unknown;
    try {
      await engine.launch({
        neutralDir: "/tmp/neutral",
        personaPath: "/tmp/persona.txt",
        mcpToken: "jst_supersecret",
        mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliChatUnavailableError);
    const cause = (caught as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(Error);
    const causeMsg = (cause as Error).message;
    // The token must NOT survive into the cause that gets logged server-side.
    expect(causeMsg).not.toContain("jst_supersecret");
    expect(causeMsg).not.toContain("JARVIS_MCP_TOKEN=jst_");
    expect(causeMsg).toContain("[redacted]");
    // The original stack (which can also embed the launch line) is dropped.
    expect((cause as Error).stack).toBeUndefined();
  });
});

// ─── #342 cli-runner path: personaText write + server-side replay-drain ──────────
describe("CliChatEngineImpl — #342 personaText + server-owned drain", () => {
  it("writes the persona FILE from personaText (0600) and points the CLI at it", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "rpc-session", io, { ownsDrain: true });
    await engine.launch({
      neutralDir: "/data/cli-auth/chat/user-1",
      // personaPath is ignored when personaText is present (the server writes the file).
      personaPath: "/data/cli-auth/chat/user-1/persona.md",
      personaText: "You are Jarvis.",
      mcpToken: "jst_x",
      mcpServerUrl: "http://api:3000/api/mcp"
    });

    const personaWrite = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]).endsWith("/persona.md")
    );
    expect(personaWrite).toBeDefined();
    expect(personaWrite![1]).toBe("You are Jarvis.");
    expect(io.run).toHaveBeenCalledWith("chmod", ["600", "/data/cli-auth/chat/user-1/persona.md"]);

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain("--append-system-prompt-file");
    expect(launchLine).toContain("/data/cli-auth/chat/user-1/persona.md");
  });

  it("returns offset 0 when no replayBatch is given (fresh conversation)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "rpc-fresh", io, { ownsDrain: true });
    const res = await engine.launch({
      neutralDir: "/data/cli-auth/chat/user-2",
      personaPath: "/data/cli-auth/chat/user-2/persona.md",
      personaText: "You are Jarvis."
    });
    expect(res).toEqual({ offset: 0 });
  });

  it("submits the replayBatch and drains to the post-replay offset (§4.1.2)", async () => {
    const io = makeIo();
    // The transcript grows to a 'complete' turn after the replay is submitted.
    const transcript = [
      JSON.stringify({ type: "user", message: { role: "user", content: "history" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn"
        }
      })
    ].join("\n");
    io.readFile.mockResolvedValue(transcript);

    const engine = new CliChatEngineImpl("anthropic", "rpc-replay", io, {
      ownsDrain: true,
      drainMs: 2_000,
      drainPollMs: 1,
      launchMs: 0
    });
    const res = await engine.launch({
      neutralDir: "/data/cli-auth/chat/user-3",
      personaPath: "/data/cli-auth/chat/user-3/persona.md",
      personaText: "You are Jarvis.",
      replayBatch: "prior conversation here"
    });

    // The replay was submitted (a prompt file was written + pasted via tmux).
    const promptWrite = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("jarv1s-live-prompt-")
    );
    expect(promptWrite![1]).toBe("prior conversation here");
    // Drained to the end of the transcript (non-zero, the replay block consumed).
    expect(res.offset).toBe(transcript.length);
    expect(res.offset).toBeGreaterThan(0);
  });
});

// ─── #342 module-level mux-name operations (§4.5 / §4.6) ─────────────────────────
describe("cli-runner mux-name helpers", () => {
  it("killMuxSessionByName kills the canonical jarv1s-live-<key> session by EXACT name", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await killMuxSessionByName({ run }, "user-42");
    // SECURITY: the leading `=` forces tmux to match the EXACT session name, not a
    // prefix — without it `jarv1s-live-user-4` could also reap `jarv1s-live-user-42`.
    expect(run).toHaveBeenCalledWith("tmux", ["kill-session", "-t", `=${SESSION_PREFIX}user-42`]);
  });

  it("killMuxSessionByName uses the `=` EXACT-name target so a prefix key never over-reaps (§4.5 security)", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    // `bob` is a strict prefix of `bobby`. The kill for `bob` must target ONLY
    // `jarv1s-live-bob`, never the longer `jarv1s-live-bobby`.
    await killMuxSessionByName({ run }, "bob");
    const target = (run.mock.calls[0]![1] as string[])[2]!;
    expect(target).toBe(`=${SESSION_PREFIX}bob`);
    // The `=` prefix is what tmux requires for exact (non-prefix) target resolution.
    expect(target.startsWith("=")).toBe(true);
    // It must NOT be the bare name (which tmux resolves as a PREFIX match).
    expect(target).not.toBe(`${SESSION_PREFIX}bob`);
  });

  it("listLiveMuxSessions enumerates by mux and strips the prefix (§4.6)", async () => {
    const run = vi.fn().mockResolvedValue({
      code: 0,
      stdout: `${SESSION_PREFIX}alice\n${SESSION_PREFIX}bob\nsome-other-session\n`,
      stderr: ""
    });
    const keys = await listLiveMuxSessions({ run });
    expect(keys).toEqual(["alice", "bob"]);
  });

  it("listLiveMuxSessions tolerates 'no tmux server' (nonzero exit → empty)", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "no server" });
    expect(await listLiveMuxSessions({ run })).toEqual([]);
  });

  it("deriveNeutralDir joins under the base; sanitizeSessionKey rejects traversal", () => {
    expect(deriveNeutralDir("/data/cli-auth/chat", "user-1")).toBe("/data/cli-auth/chat/user-1");
    expect(() => sanitizeSessionKey("../escape")).toThrow();
    expect(() => sanitizeSessionKey("a/b")).toThrow();
    expect(() => sanitizeSessionKey("")).toThrow();
    expect(sanitizeSessionKey("ok-uuid-123")).toBe("ok-uuid-123");
  });
});

// ─── #342 probeProvider (§4.8) — no token, no replay ─────────────────────────────
describe("probeProvider (§4.8)", () => {
  it("returns not_installed when the binary is absent (no auth command run)", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const res = await probeProvider("anthropic", {
      io: { run },
      cliPresent: async () => false
    });
    expect(res.status).toBe("not_installed");
    // Pure presence check: no `claude auth status` is ever spawned.
    expect(run).not.toHaveBeenCalled();
  });

  it("returns ready when claude auth status reports loggedIn", async () => {
    const run = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ loggedIn: true }),
      stderr: ""
    });
    const res = await probeProvider("anthropic", { io: { run }, cliPresent: async () => true });
    expect(res.status).toBe("ready");
  });

  it("surfaces multiplexer_unavailable when the mux is not usable", async () => {
    const run = vi.fn();
    const res = await probeProvider("anthropic", {
      io: { run },
      cliPresent: async () => true,
      multiplexerUsable: async () => false
    });
    expect(res.status).toBe("multiplexer_unavailable");
    expect(run).not.toHaveBeenCalled();
  });
});

// ─── #342 §12 (4b) DOCUMENTING test: 0600 + redactSecrets do NOT protect a same-UID
// read of the per-session token file. The single-active-user gate — NOT the file mode —
// is the isolation boundary until #347 (§13). This test exists so nobody mistakes
// `0600` for a cross-user boundary.
import { mkdtemp, readFile as fsReadFile, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("#342 §13 same-UID token-file readability (DOCUMENTING — not a regression)", () => {
  it("a 0600 Codex token file is readable by the SAME uid that wrote it", async () => {
    const dir = await mkdtemp(pathJoin(tmpdir(), "jarv1s-342-tokenfile-"));
    try {
      // Use the REAL io so chmod 600 actually applies on disk.
      const io = createRealTmuxIo();
      const engine = new CliChatEngineImpl("openai-compatible", "same-uid", io, {
        // No mux.open → use a fake mux so we don't need a real tmux for this file check.
        mux: {
          kind: "tmux",
          open: async () => "handle",
          submit: async () => undefined,
          isAlive: async () => true,
          kill: async () => undefined,
          attachCommand: () => ""
        },
        launchMs: 0
      });
      await engine.launch({
        neutralDir: dir,
        personaPath: pathJoin(dir, "persona.md"),
        personaText: "You are Jarvis.",
        mcpToken: "jst_same_uid_secret",
        mcpServerUrl: "http://api:3000/api/mcp"
      });

      // The file is 0600 — yet the SAME uid (this test process) reads it back plainly.
      // redactSecrets is a LOG-redaction tool, not a file-access control: the token is
      // present in cleartext in the file. This is the documented Phase-1 limitation
      // that the single-active-user gate (#347) compensates for.
      const tokenFile = pathJoin(dir, ".jarvis-mcp-token.env");
      const contents = await fsReadFile(tokenFile, "utf8");
      expect(contents).toContain("jst_same_uid_secret");
    } finally {
      await fsRm(dir, { recursive: true, force: true });
    }
  });
});

// ─── #342 §6.7 acceptance: the token is ABSENT from launch line / argv / tmux env ────
// §6.2 forbids `tmux set-environment`/`set-env` for the MCP token (show-environment is a
// capture surface). §6.7 requires negative argv assertions for ALL providers (today only
// Claude had them). The send-keys launchLine BECOMES the spawned CLI's argv when tmux runs
// it, so a launchLine free of any token/Bearer/Authorization shape is exactly the
// /proc/<pid>/cmdline guarantee §6.7 asks for.
describe("CliChatEngineImpl — §6.7 no secret on launch line / argv / tmux env", () => {
  function launchLineFrom(io: ReturnType<typeof makeIo>): string {
    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    expect(sendKeysCall).toBeDefined();
    return (sendKeysCall![1] as string[])[3]!;
  }

  function assertNoTmuxEnvCarriesSecret(io: ReturnType<typeof makeIo>): void {
    // (a) §6.2/§6.7: NO `tmux set-environment`/`set-env` carrying a jst_/Bearer value is
    // ever issued at launch — the token reaches the CLI ONLY via the per-session 0600 file.
    const envCalls = (io.run as ReturnType<typeof vi.fn>).mock.calls.filter((c: unknown[]) => {
      if (c[0] !== "tmux") return false;
      const verb = (c[1] as string[])[0] ?? "";
      return verb === "set-environment" || verb === "set-env" || verb === "setenv";
    });
    expect(envCalls).toEqual([]);
    // Belt-and-suspenders: even if a set-environment were issued, no tmux arg anywhere may
    // carry a token/Bearer/Authorization shape.
    for (const c of (io.run as ReturnType<typeof vi.fn>).mock.calls) {
      if (c[0] !== "tmux") continue;
      const args = (c[1] as string[]).join(" ");
      expect(args).not.toMatch(/jst_/);
      expect(args).not.toMatch(/Bearer/);
      expect(args).not.toMatch(/Authorization/);
    }
  }

  it("Claude: launch line / argv carry no jst_/Bearer/Authorization and no tmux set-environment", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "claude-secret", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_claude_secret",
      mcpServerUrl: "http://api:3000/api/mcp"
    });
    const launchLine = launchLineFrom(io);
    expect(launchLine).not.toContain("jst_claude_secret");
    expect(launchLine).not.toContain("Bearer");
    expect(launchLine).not.toContain("Authorization");
    assertNoTmuxEnvCarriesSecret(io);
  });

  it("Codex: launch line / argv carry no jst_/Bearer/Authorization and no tmux set-environment (§6.7 new)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("openai-compatible", "codex-secret", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_codex_secret",
      mcpServerUrl: "http://api:3000/api/mcp"
    });
    const launchLine = launchLineFrom(io);
    // Only the env-var NAME may appear, never the token value or a Bearer/Authorization header.
    expect(launchLine).toContain("JARVIS_MCP_TOKEN");
    expect(launchLine).not.toContain("jst_codex_secret");
    expect(launchLine).not.toContain("Bearer");
    expect(launchLine).not.toContain("Authorization");
    assertNoTmuxEnvCarriesSecret(io);
  });

  it("Gemini: launch line / argv carry no jst_/Bearer/Authorization and no tmux set-environment (§6.7 new)", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("google", "gemini-secret", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_gemini_secret",
      mcpServerUrl: "http://api:3000/api/mcp"
    });
    const launchLine = launchLineFrom(io);
    // Gemini's token lives ONLY in .gemini/settings.json; the launch line is just `agy --sandbox`.
    expect(launchLine).not.toContain("jst_gemini_secret");
    expect(launchLine).not.toContain("Bearer");
    expect(launchLine).not.toContain("Authorization");
    assertNoTmuxEnvCarriesSecret(io);
  });
});

// ─── #342 Gemini chmod symmetry (security fix §6.5) ──────────────────────────────
describe("CliChatEngineImpl — Gemini settings chmod failure cleanup", () => {
  it("rm -f's the settings file and fails the launch if `chmod 600` fails (no readable token left)", async () => {
    const io = makeIo();
    // Make ONLY the settings chmod fail; everything else succeeds.
    (io.run as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "chmod" && (args[1] ?? "").endsWith(".gemini/settings.json")) {
        return { code: 1, stdout: "", stderr: "chmod: operation not permitted" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const engine = new CliChatEngineImpl("google", "gemini-chmod-fail", io);

    let caught: unknown;
    try {
      await engine.launch({
        neutralDir: "/tmp/neutral-gem",
        personaPath: "/tmp/persona.txt",
        mcpToken: "jst_gem_locked",
        mcpServerUrl: "http://api:3000/api/mcp"
      });
    } catch (err) {
      caught = err;
    }

    // The pre-mux-create write failure surfaces as the 503-mapped unavailable error.
    expect(caught).toBeInstanceOf(CliChatUnavailableError);
    // The settings file was rm -f'd (symmetry with Claude/Codex) so no readable Bearer survives.
    expect(io.run).toHaveBeenCalledWith("rm", ["-f", "/tmp/neutral-gem/.gemini/settings.json"]);
    // And the whole per-session neutral dir is torn down on the failed launch (§6.5).
    expect(io.run).toHaveBeenCalledWith("rm", ["-rf", "/tmp/neutral-gem"]);
    // The mux session was NEVER opened (pre-mux-create failure) — no orphan to reap.
    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    expect(sendKeysCall).toBeUndefined();
  });
});

// ─── #342 UNPROVEN-2: POST-mux-create failure kills the mux session BEFORE rm -rf'ing the
// neutral dir (§6.5 ordering). If the dir were removed first, the live jarv1s-live-<key>
// session would linger in listLiveSessions-by-mux and wedge the §4.1.0a single-user gate
// for everyone until reconciliation/restart. ──────────────────────────────────────────
describe("CliChatEngineImpl — §6.5 POST-mux-create failure ordering (UNPROVEN-2)", () => {
  it("kills jarv1s-live-<key> BEFORE rm -rf'ing the neutral dir when the drain fails post-launch", async () => {
    const events: string[] = [];
    const io = makeIo();
    // Record rm -rf of the neutral dir in submission order.
    (io.run as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "rm" && (args[0] ?? "") === "-rf") {
        events.push(`rm:${args[1]}`);
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    // A mux that OPENS successfully (so jarv1s-live-<key> exists), but whose submit throws
    // — driving replayAndDrain's `await this.submit(replayBatch)` to fail, which is a
    // POST-mux-create failure routed through killAndRemoveNeutralDirQuietly.
    const killSpy = vi.fn().mockImplementation(async () => {
      events.push("mux.kill");
    });
    const mux: Multiplexer = {
      kind: "tmux",
      open: vi.fn().mockResolvedValue("jarv1s-live-rpc-post-fail"),
      submit: vi.fn().mockRejectedValue(new Error("paste-buffer failed")),
      isAlive: vi.fn().mockResolvedValue(true),
      kill: killSpy,
      attachCommand: () => ""
    };

    const engine = new CliChatEngineImpl("anthropic", "rpc-post-fail", io, {
      mux,
      ownsDrain: true,
      launchMs: 0,
      drainMs: 50,
      drainPollMs: 1
    });

    let caught: unknown;
    try {
      await engine.launch({
        neutralDir: "/data/cli-auth/chat/rpc-post-fail",
        personaPath: "/data/cli-auth/chat/rpc-post-fail/persona.md",
        personaText: "You are Jarvis.",
        replayBatch: "prior conversation here",
        mcpToken: "jst_x",
        mcpServerUrl: "http://api:3000/api/mcp"
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliChatUnavailableError);
    // The mux session was opened, the drain failed, and the session was killed.
    expect(killSpy).toHaveBeenCalledTimes(1);
    // CRITICAL ORDERING (§6.5): the kill happens BEFORE the neutral dir is rm -rf'd, so
    // the orphaned jarv1s-live-* session can never wedge the §4.1.0a gate.
    const killIdx = events.indexOf("mux.kill");
    const rmIdx = events.indexOf("rm:/data/cli-auth/chat/rpc-post-fail");
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeLessThan(rmIdx);
  });

  it("a failed launch removes the neutral dir (§6.5)", async () => {
    const io = makeIo();
    const removed: string[] = [];
    (io.run as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "rm" && (args[0] ?? "") === "-rf") removed.push(args[1] ?? "");
      return { code: 0, stdout: "", stderr: "" };
    });
    // PRE-mux-create failure: mux.open throws, so the neutral dir is removed and no mux
    // session is ever opened.
    const mux: Multiplexer = {
      kind: "tmux",
      open: vi.fn().mockRejectedValue(new Error("tmux new-session failed")),
      submit: vi.fn(),
      isAlive: vi.fn().mockResolvedValue(false),
      kill: vi.fn(),
      attachCommand: () => ""
    };
    const engine = new CliChatEngineImpl("anthropic", "rpc-pre-fail", io, { mux, ownsDrain: true });

    await expect(
      engine.launch({
        neutralDir: "/data/cli-auth/chat/rpc-pre-fail",
        personaPath: "/data/cli-auth/chat/rpc-pre-fail/persona.md",
        personaText: "You are Jarvis."
      })
    ).rejects.toBeInstanceOf(CliChatUnavailableError);

    expect(removed).toContain("/data/cli-auth/chat/rpc-pre-fail");
  });
});
