import { describe, expect, it, vi } from "vitest";
import { CliChatEngineImpl } from "../../packages/chat/src/live/cli-chat-engine.js";

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
