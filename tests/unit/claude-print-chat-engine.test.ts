import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Multiplexer, MuxHandle, TmuxIo } from "@jarv1s/ai";

import { ClaudePrintChatEngine } from "../../packages/chat/src/live/claude-print-chat-engine.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => ({
  ...(await vi.importActual("node:child_process")),
  spawn: spawnMock
}));

function fakeChild() {
  const child = {
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
    on: vi.fn(),
    unref: vi.fn()
  };
  child.on.mockReturnValue(child);
  return child;
}

function fakeIo(files: Record<string, string> = {}): TmuxIo & { writes: Record<string, string> } {
  return {
    writes: files,
    async run() {
      return { code: 0, stdout: "" };
    },
    async readFile(path) {
      const value = this.writes[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async writeFile(path, content) {
      this.writes[path] = content;
    },
    async sleep() {}
  };
}

let currentChild: ReturnType<typeof fakeChild>;

beforeEach(() => {
  currentChild = fakeChild();
  spawnMock.mockReset();
  spawnMock.mockReturnValue(currentChild);
});

function launchLineAt(index = 0): string {
  return String(spawnMock.mock.calls[index]?.[1]?.[1] ?? "");
}

function fakeMux(): Multiplexer & { opened: string[]; killed: MuxHandle[] } {
  return {
    kind: "tmux",
    opened: [],
    killed: [],
    async open(opts) {
      this.opened.push(opts.launchLine);
      return `handle-${this.opened.length}`;
    },
    async submit() {
      throw new Error("ClaudePrintChatEngine should open per-turn commands, not paste into a REPL");
    },
    async clearComposer() {},
    async clearComposerHard() {},
    async capturePane() {
      return "";
    },
    async paste() {},
    async pressEnter() {},
    async isAlive() {
      return true;
    },
    async kill(handle) {
      this.killed.push(handle);
    },
    async interrupt() {},
    attachCommand() {
      return "tmux attach";
    }
  };
}

describe("ClaudePrintChatEngine", () => {
  it("runs the first submitted turn with claude print and a fixed session id", async () => {
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000001"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona"
    });
    await engine.submit("hello");

    expect(launchLineAt()).toContain("claude -p");
    expect(launchLineAt()).toContain("--session-id 00000000-0000-4000-8000-000000000001");
    expect(launchLineAt()).toContain("--permission-mode dontAsk");
    expect(launchLineAt()).toContain("--strict-mcp-config");
    expect(launchLineAt()).not.toContain("--permission-mode default");
    expect(launchLineAt()).not.toContain("--no-session-persistence");
    expect(mux.opened).toEqual([]);
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      ["-lc", expect.stringContaining("claude -p")],
      expect.objectContaining({
        cwd: "/tmp/jarvis-neutral",
        detached: true,
        stdio: "ignore"
      })
    );
    expect(await engine.isAlive()).toBe(true);
    await engine.interrupt();
    expect(currentChild.kill).toHaveBeenCalledWith("SIGINT");
    await engine.kill();
    expect(currentChild.kill).toHaveBeenCalledWith();
    expect(await engine.isAlive()).toBe(false);
  });

  it("uses --resume on later submitted turns", async () => {
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000001"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona"
    });
    await engine.submit("first");
    await engine.submit("second");

    expect(launchLineAt(1)).toContain("--resume 00000000-0000-4000-8000-000000000001");
  });

  it("reads Claude transcript JSONL through the existing parser", async () => {
    const transcriptPath =
      "/home/test/.claude/projects/-tmp-jarvis-neutral/00000000-0000-4000-8000-000000000001.jsonl";
    const transcript = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "claude print ok" }]
      }
    });
    const io = fakeIo({ [transcriptPath]: `${transcript}\n` });
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000001"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona"
    });

    const result = await engine.readNew(0);

    expect(result.records).toEqual([{ kind: "reply", text: "claude print ok" }]);
    expect(result.complete).toBe(true);
    expect(result.offset).toBe(`${transcript}\n`.length);
  });
});

describe("ClaudePrintChatEngine — vault read-only allowlist (#634)", () => {
  const ROOTS_VAR = "JARVIS_NOTES_ROOTS";
  const originalRoots = process.env[ROOTS_VAR];

  afterEach(() => {
    if (originalRoots === undefined) delete process.env[ROOTS_VAR];
    else process.env[ROOTS_VAR] = originalRoots;
  });

  it("ALLOW: pre-approves Read/Glob/Grep scoped to the configured vault mount", async () => {
    process.env[ROOTS_VAR] = "/data/external-notes";
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000002"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });
    await engine.submit("hello");

    expect(launchLineAt()).toContain("Read(/data/external-notes/**)");
    expect(launchLineAt()).toContain("Glob(/data/external-notes/**)");
    expect(launchLineAt()).toContain("Grep(/data/external-notes/**)");
    expect(launchLineAt()).toContain("mcp__jarvis__*");
    expect(launchLineAt()).toContain(
      "--settings '/tmp/jarvis-neutral/.jarvis-claude-settings.json'"
    );
    expect(launchLineAt()).not.toContain("jst_abc");
    expect(io.writes["/tmp/jarvis-neutral/.jarvis-claude-permission-token"]).toBeUndefined();
  });

  it("DENY: no vault patterns are granted when no vault is mounted (no roots configured)", async () => {
    delete process.env[ROOTS_VAR];
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000003"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });
    await engine.submit("hello");

    expect(launchLineAt()).not.toContain("Read(");
    expect(launchLineAt()).not.toContain("Glob(");
    expect(launchLineAt()).not.toContain("Grep(");
    expect(launchLineAt()).toContain("mcp__jarvis__*");
  });

  it("DENY: never grants write or execute tools, even with a vault configured", async () => {
    process.env[ROOTS_VAR] = "/data/external-notes";
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000004"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });
    await engine.submit("hello");

    expect(launchLineAt()).not.toMatch(/\bWrite\b/);
    expect(launchLineAt()).not.toMatch(/\bEdit\b/);
    expect(launchLineAt()).not.toMatch(/\bBash\b/);
  });

  it("DENY: a malicious root cannot smuggle a separate Bash(* tool grant (security fix)", async () => {
    process.env[ROOTS_VAR] = "/vault) Bash(*";
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000005"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona",
      mcpToken: "jst_abc",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    });
    await engine.submit("hello");

    expect(launchLineAt()).not.toMatch(/\bBash\b/);
    expect(launchLineAt()).not.toContain("Read(/vault)");
    expect(launchLineAt()).toContain("mcp__jarvis__*");
  });
});
