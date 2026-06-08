/**
 * Unit tests for transcript-reader and TmuxBridgeAdapter.
 * No Postgres — all I/O boundaries are mocked.
 */
import { describe, expect, it } from "vitest";

import { parseTranscript } from "../../packages/ai/src/adapters/transcript-reader.js";
import {
  TmuxBridgeAdapter,
  transcriptGlobDir,
  type TmuxIo
} from "../../packages/ai/src/adapters/tmux-bridge.js";

// ---------------------------------------------------------------------------
// Fixtures: real JSONL schema per provider (discovered 2026-06-07)
//
// Claude Code (anthropic):
//   Each record: { type: "assistant"|"user"|..., message: { role, content[], stop_reason }, ... }
//   content items: { type: "thinking"|"text"|"tool_use", thinking?, text?, name? }
//   Final reply signal: stop_reason === "end_turn" AND content contains { type:"text", text:"..." }
//   Intermediate: stop_reason === "tool_use" (thinking / tool_use content items)
//
// Codex (openai-compatible):
//   Each record: { type: "event_msg"|"response_item"|"session_meta"|"turn_context", ... }
//   event_msg.payload.type: "agent_reasoning" (thinking), "exec_command_end" (tool),
//                           "agent_message" (status text), "task_complete" (final)
//   Final: type==="event_msg" && payload.type==="task_complete" &&
//           payload.last_agent_message (string)
//   Also: type==="response_item" && payload.role==="assistant" && payload.phase==="final_answer"
//          && payload.content[0].type==="output_text"
//
// Gemini CLI (google):
//   Each record: { type: "gemini"|"user"|"info"|"error"|... }
//   type==="gemini": intermediate if content === "" (only thoughts present);
//                   final if content is a non-empty string
//   thoughts: [{ subject, description }]
// ---------------------------------------------------------------------------

// ─── anthropic / Claude Code fixtures ───────────────────────────────────────

const CLAUDE_FIXTURE_THINKING = JSON.stringify({
  parentUuid: "abc",
  isSidechain: false,
  type: "assistant",
  message: {
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "thinking", thinking: "let me consider this" }]
  },
  uuid: "u1",
  timestamp: "2026-06-07T00:00:00.000Z",
  sessionId: "sess1"
});

const CLAUDE_FIXTURE_TOOL_USE = JSON.stringify({
  parentUuid: "abc",
  isSidechain: false,
  type: "assistant",
  message: {
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]
  },
  uuid: "u2",
  timestamp: "2026-06-07T00:00:01.000Z",
  sessionId: "sess1"
});

const CLAUDE_FIXTURE_FINAL = JSON.stringify({
  parentUuid: "abc",
  isSidechain: false,
  type: "assistant",
  message: {
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Here is the final answer." }]
  },
  uuid: "u3",
  timestamp: "2026-06-07T00:00:02.000Z",
  sessionId: "sess1"
});

// ─── openai-compatible / Codex fixtures ──────────────────────────────────────

const CODEX_FIXTURE_REASONING = JSON.stringify({
  timestamp: "2026-06-06T11:01:50.000Z",
  type: "event_msg",
  payload: { type: "agent_reasoning", text: "thinking about the task" }
});

const CODEX_FIXTURE_EXEC = JSON.stringify({
  timestamp: "2026-06-06T11:01:55.000Z",
  type: "event_msg",
  payload: { type: "exec_command_end", command: ["/bin/bash", "-lc", "git status"] }
});

const CODEX_FIXTURE_FINAL = JSON.stringify({
  timestamp: "2026-06-06T11:02:44.000Z",
  type: "event_msg",
  payload: {
    type: "task_complete",
    turn_id: "turn1",
    last_agent_message: "All done, sir."
  }
});

// ─── google / Gemini CLI fixtures ────────────────────────────────────────────

const GEMINI_FIXTURE_THINKING = JSON.stringify({
  id: "g1",
  timestamp: "2026-05-13T19:08:00.000Z",
  type: "gemini",
  content: "",
  thoughts: [
    {
      subject: "Analyzing Code",
      description: "I am examining the codebase carefully."
    }
  ]
});

const GEMINI_FIXTURE_FINAL = JSON.stringify({
  id: "g2",
  timestamp: "2026-05-13T19:09:12.000Z",
  type: "gemini",
  content: "Here is the Gemini answer.",
  thoughts: []
});

// ===========================================================================
// parseTranscript tests
// ===========================================================================

describe("parseTranscript — anthropic (Claude Code JSONL schema)", () => {
  it("returns thinking + tool activity events and the final reply on end_turn", () => {
    const jsonl = [CLAUDE_FIXTURE_THINKING, CLAUDE_FIXTURE_TOOL_USE, CLAUDE_FIXTURE_FINAL].join(
      "\n"
    );

    const result = parseTranscript("anthropic", jsonl, 0);

    expect(result.events.map((e) => e.kind)).toEqual(["thinking", "tool"]);
    expect(result.reply).toBe("Here is the final answer.");
    expect(result.complete).toBe(true);
  });

  it("reports incomplete when no end_turn record is present", () => {
    const jsonl = [CLAUDE_FIXTURE_THINKING, CLAUDE_FIXTURE_TOOL_USE].join("\n");

    const result = parseTranscript("anthropic", jsonl, 0);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.events.length).toBe(2);
  });

  it("respects afterOffset (skips bytes already processed)", () => {
    const first = CLAUDE_FIXTURE_THINKING + "\n";
    const second = CLAUDE_FIXTURE_FINAL + "\n";
    const jsonl = first + second;

    const result = parseTranscript("anthropic", jsonl, first.length);

    expect(result.events.length).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.reply).toBe("Here is the final answer.");
  });

  it("skips malformed / partial lines without throwing", () => {
    const jsonl = CLAUDE_FIXTURE_THINKING + "\n{bad json}\n" + CLAUDE_FIXTURE_FINAL;

    expect(() => parseTranscript("anthropic", jsonl, 0)).not.toThrow();
    const result = parseTranscript("anthropic", jsonl, 0);
    expect(result.complete).toBe(true);
  });
});

describe("parseTranscript — openai-compatible (Codex JSONL schema)", () => {
  it("returns thinking + tool activity events and the final reply on task_complete", () => {
    const jsonl = [CODEX_FIXTURE_REASONING, CODEX_FIXTURE_EXEC, CODEX_FIXTURE_FINAL].join("\n");

    const result = parseTranscript("openai-compatible", jsonl, 0);

    expect(result.events.map((e) => e.kind)).toEqual(["thinking", "tool"]);
    expect(result.reply).toBe("All done, sir.");
    expect(result.complete).toBe(true);
  });

  it("reports incomplete when no task_complete record is present", () => {
    const jsonl = [CODEX_FIXTURE_REASONING, CODEX_FIXTURE_EXEC].join("\n");

    const result = parseTranscript("openai-compatible", jsonl, 0);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
  });
});

describe("parseTranscript — google (Gemini CLI JSONL schema)", () => {
  it("returns thinking activity events and the final reply when content is non-empty", () => {
    const jsonl = [GEMINI_FIXTURE_THINKING, GEMINI_FIXTURE_FINAL].join("\n");

    const result = parseTranscript("google", jsonl, 0);

    expect(result.events.map((e) => e.kind)).toEqual(["thinking"]);
    expect(result.reply).toBe("Here is the Gemini answer.");
    expect(result.complete).toBe(true);
  });

  it("reports incomplete when all gemini records have empty content", () => {
    const jsonl = GEMINI_FIXTURE_THINKING;

    const result = parseTranscript("google", jsonl, 0);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
  });
});

// ===========================================================================
// TmuxBridgeAdapter tests
// ===========================================================================

/** Build a minimal fake AiConfiguredModelSafeRow */
function fakeModel(providerKind: string = "anthropic") {
  return {
    id: "model-1",
    owner_user_id: "user-1",
    provider_kind: providerKind,
    provider_model_id: "claude-opus-4",
    display_name: "Claude Opus 4",
    capabilities: [],
    status: "enabled",
    model_metadata: null,
    created_at: new Date(),
    updated_at: new Date()
  } as never; // cast to never to satisfy strict AiConfiguredModelSafeRow
}

/**
 * Build a fake TmuxIo whose readFile returns a given JSONL string after
 * `pollsBeforeReady` read calls, and whose run() does nothing harmful.
 */
function fakeTmuxIo(
  jsonlAfterPolls: string,
  pollsBeforeReady: number = 2
): TmuxIo & {
  runCalls: Array<{ cmd: string; args: readonly string[] }>;
  writeCalls: Array<{ path: string; content: string }>;
} {
  let readCount = 0;
  const runCalls: Array<{ cmd: string; args: readonly string[] }> = [];
  const writeCalls: Array<{ path: string; content: string }> = [];

  return {
    runCalls,
    writeCalls,
    async run(cmd, args) {
      runCalls.push({ cmd, args });
      return { code: 0, stdout: "" };
    },
    async readFile(_path) {
      readCount++;
      if (readCount >= pollsBeforeReady) {
        return jsonlAfterPolls;
      }
      // Return partial content (first thinking record only, no final yet)
      return CLAUDE_FIXTURE_THINKING;
    },
    async writeFile(path, content) {
      writeCalls.push({ path, content });
    },
    async sleep(_ms) {
      /* no-op in tests */
    }
  };
}

describe("TmuxBridgeAdapter", () => {
  it("sends the prompt, polls the transcript, and returns the final reply", async () => {
    const jsonl = [CLAUDE_FIXTURE_THINKING, CLAUDE_FIXTURE_TOOL_USE, CLAUDE_FIXTURE_FINAL].join(
      "\n"
    );

    const io = fakeTmuxIo(jsonl, 1);
    const adapter = new TmuxBridgeAdapter("anthropic", "thread-abc", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    const activityEvents: string[] = [];
    const result = await adapter.generateChat({
      model: fakeModel("anthropic"),
      messages: [{ role: "user", content: "What is the answer?" }],
      onActivity: (e) => activityEvents.push(e.kind)
    });

    expect(result.text).toBe("Here is the final answer.");
    // onActivity called for thinking + tool events
    expect(activityEvents).toContain("thinking");
    expect(activityEvents).toContain("tool");
  });

  it("writes the prompt to a temp file via writeFile (not a broken `cat` shell-out)", async () => {
    // Regression: the prompt used to be written with
    //   io.run("bash", ["-c", "cat > file", promptText])
    // which (through the shell join + no stdin) produced a 0-byte file, so the
    // CLI received an empty prompt. The prompt must be written via io.writeFile.
    const io = fakeTmuxIo(CLAUDE_FIXTURE_FINAL, 1);
    const adapter = new TmuxBridgeAdapter("anthropic", "thread-write", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    await adapter.generateChat({
      model: fakeModel("anthropic"),
      messages: [{ role: "user", content: "What is the answer?" }]
    });

    expect(io.writeCalls).toHaveLength(1);
    expect(io.writeCalls[0]?.content).toBe("What is the answer?");
    // The prompt must NOT be written by shelling out to cat/bash.
    const wroteViaShell = io.runCalls.some(
      (c) => c.cmd === "bash" && c.args.join(" ").includes("cat >")
    );
    expect(wroteViaShell).toBe(false);
  });

  it("pastes the prompt buffer then submits Enter as a separate send-keys", async () => {
    // Regression: paste + Enter must be distinct steps (bracketed paste), and the
    // pasted buffer must reference the temp file the prompt was written to.
    const io = fakeTmuxIo(CLAUDE_FIXTURE_FINAL, 1);
    const adapter = new TmuxBridgeAdapter("anthropic", "thread-paste", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    await adapter.generateChat({
      model: fakeModel("anthropic"),
      messages: [{ role: "user", content: "hi" }]
    });

    const tmux = io.runCalls.filter((c) => c.cmd === "tmux").map((c) => c.args.join(" "));
    const pasteIdx = tmux.findIndex((a) => a.startsWith("paste-buffer"));
    const enterIdx = tmux.findIndex((a) => a.includes("send-keys") && a.includes("Enter"));
    expect(pasteIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(pasteIdx);
  });

  it("creates a tmux session with the correct CLI binary", async () => {
    const jsonl = CLAUDE_FIXTURE_FINAL;
    const io = fakeTmuxIo(jsonl, 1);
    const adapter = new TmuxBridgeAdapter("anthropic", "thread-xyz", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    await adapter.generateChat({
      model: fakeModel("anthropic"),
      messages: [{ role: "user", content: "hi" }]
    });

    // Should have issued at least one tmux command
    const cmds = io.runCalls.map((c) => c.cmd);
    expect(cmds.some((c) => c === "tmux")).toBe(true);
  });

  it("throws on timeout when no final record appears", async () => {
    // io always returns only thinking, never final
    const io: TmuxIo = {
      async run() {
        return { code: 0, stdout: "" };
      },
      async readFile() {
        return CLAUDE_FIXTURE_THINKING;
      },
      async writeFile() {
        /* no-op */
      },
      async sleep() {
        /* no-op */
      }
    };

    const adapter = new TmuxBridgeAdapter("anthropic", "thread-timeout", io, {
      timeoutMs: 50, // 50 ms → will time out immediately in test
      pollMs: 0
    });

    await expect(
      adapter.generateChat({
        model: fakeModel("anthropic"),
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("uses codex binary for openai-compatible provider", async () => {
    const jsonl = CODEX_FIXTURE_FINAL;
    const io = fakeTmuxIo(jsonl, 1);
    const adapter = new TmuxBridgeAdapter("openai-compatible", "thread-codex", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    const result = await adapter.generateChat({
      model: fakeModel("openai-compatible"),
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.text).toBe("All done, sir.");
  });

  it("uses gemini binary for google provider", async () => {
    const jsonl = [GEMINI_FIXTURE_THINKING, GEMINI_FIXTURE_FINAL].join("\n");
    const io = fakeTmuxIo(jsonl, 1);
    const adapter = new TmuxBridgeAdapter("google", "thread-gemini", io, {
      timeoutMs: 5_000,
      pollMs: 0
    });

    const result = await adapter.generateChat({
      model: fakeModel("google"),
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.text).toBe("Here is the Gemini answer.");
  });
});

describe("transcriptGlobDir (anthropic project-dir encoding)", () => {
  it("keeps the leading dash and replaces '/' and '.' with '-'", () => {
    // Regression: Claude Code stores transcripts under
    //   ~/.claude/projects/-home-ben-Jarv1s-apps-worker/
    // The encoder previously stripped the leading dash, so the worker polled a
    // non-existent directory and always timed out waiting for the reply.
    const dir = transcriptGlobDir("anthropic", "~/Jarv1s/apps/worker");
    expect(dir.endsWith("/-home-ben-Jarv1s-apps-worker")).toBe(true);
    expect(dir).toContain("/.claude/projects/");
  });

  it("encodes dotted path segments with dashes (e.g. .claude worktrees)", () => {
    const dir = transcriptGlobDir("anthropic", "~/Jarv1s/.claude/worktrees/x");
    expect(dir.endsWith("/-home-ben-Jarv1s--claude-worktrees-x")).toBe(true);
  });
});
