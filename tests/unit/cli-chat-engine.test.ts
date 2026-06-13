import { describe, expect, it, vi } from "vitest";
import { CliChatEngineImpl } from "../../packages/chat/src/live/cli-chat-engine.js";
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
  it("uses --allowedTools mcp__jarvis__* when mcpToken is provided", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("anthropic", "test-session", io);
    await engine.launch({
      neutralDir: "/tmp/neutral",
      personaPath: "/tmp/persona.txt",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    expect(sendKeysCall).toBeDefined();
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain("--allowedTools");
    expect(launchLine).toContain("mcp__jarvis__*");
    expect(launchLine).not.toContain('--tools ""');
    expect(launchLine).toContain("mcp-config");
    expect(launchLine).toContain("--permission-mode default");
    expect(launchLine).toContain("--strict-mcp-config");
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
  });
});

describe("CliChatEngineImpl — Codex launch", () => {
  it("launches codex with MCP config -c flags and token in env", async () => {
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
    expect(launchLine).toContain("JARVIS_MCP_TOKEN=jst_codex");
    expect(launchLine).toContain("mcp_servers.jarvis.url");
    expect(launchLine).toContain("shell_tool=false");
    expect(launchLine).toContain("apply_patch_tool=false");
    expect(launchLine).toContain("sandbox read-only");
    expect(launchLine).toContain("-a never");
  });
});

describe("CliChatEngineImpl — Gemini launch", () => {
  it("writes .gemini/settings.json and launches gemini with MCP server name", async () => {
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
    expect(launchLine).toContain("gemini");
    expect(launchLine).toContain("--allowed-mcp-server-names jarvis");
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

  it("Gemini resolves the newest .jsonl under ~/.gemini/tmp", async () => {
    const io = makeIo();
    const engine = new CliChatEngineImpl("google", "gemini-session", io, {
      homeBase: "/host-home"
    });
    await engine.launch({
      neutralDir: "/tmp/neutral",
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
    expect(readPath).toContain("/host-home/.gemini/tmp/");
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
