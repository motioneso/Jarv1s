import { describe, expect, it, vi } from "vitest";
import { TmuxCliChatEngine } from "../../packages/chat/src/live/cli-chat-engine.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

describe("TmuxCliChatEngine — Claude MCP lockdown", () => {
  it("uses --allowedTools mcp__jarvis__* when mcpToken is provided", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("anthropic", "test-session", io);
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
  });

  it("falls back to --tools '' when no mcpToken is provided", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("anthropic", "test-session", io);
    await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });

    const sendKeysCall = (io.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
    );
    const launchLine = (sendKeysCall![1] as string[])[3];
    expect(launchLine).toContain('--tools ""');
    expect(launchLine).not.toContain("--allowedTools");
  });
});

describe("TmuxCliChatEngine — Codex launch", () => {
  it("launches codex with MCP config -c flags and token in env", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("openai-compatible", "codex-session", io);
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
  });
});

describe("TmuxCliChatEngine — Gemini launch", () => {
  it("writes .gemini/settings.json and launches gemini with MCP server name", async () => {
    const io = makeIo();
    const engine = new TmuxCliChatEngine("google", "gemini-session", io);
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
    expect(launchLine).toContain("MCP_TOKEN=jst_gemini");
  });
});
