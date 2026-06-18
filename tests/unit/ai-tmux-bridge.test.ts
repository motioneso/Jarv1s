/**
 * Unit tests for transcript-reader and TmuxBridgeAdapter.
 * No Postgres — all I/O boundaries are mocked.
 */
import { describe, expect, it, vi } from "vitest";

import { parseTranscript } from "../../packages/ai/src/adapters/transcript-reader.js";
import { createRealTmuxIo, transcriptGlobDir } from "../../packages/ai/src/adapters/tmux-bridge.js";

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

describe("createRealTmuxIo — env/cwd passthrough", () => {
  it("run() accepts an optional opts arg without throwing (env/cwd are optional)", async () => {
    const io = createRealTmuxIo();
    // `true` is a real binary that ignores args; opts must be accepted by the type + at runtime.
    const res = await io.run("true", [], { env: { JARVIS_TEST: "1" }, cwd: "/tmp" });
    expect(res.code).toBe(0);
  });
});

describe("transcriptGlobDir — homeBase override", () => {
  it("uses the provided homeBase instead of the OS homedir", () => {
    const dir = transcriptGlobDir("anthropic", "/tmp/x", "/custom/home");
    expect(dir.startsWith("/custom/home/.claude/projects/")).toBe(true);
  });

  it("defaults to the OS homedir when homeBase is omitted (unchanged behavior)", () => {
    const dir = transcriptGlobDir("anthropic", "~/Jarv1s/apps/worker");
    expect(dir).toContain("/.claude/projects/-home-ben-Jarv1s-apps-worker");
  });
});

describe("transcriptGlobDir — Codex date directory", () => {
  it("uses the host local date for Codex session directories", () => {
    vi.useFakeTimers();
    try {
      // 2026-06-18T05:30Z is still 2026-06-17 in the dev host's PDT timezone,
      // and Codex writes under the local-date directory.
      vi.setSystemTime(new Date("2026-06-18T05:30:00.000Z"));
      const dir = transcriptGlobDir("openai-compatible", "/tmp/x", "/custom/home");
      expect(dir).toBe("/custom/home/.codex/sessions/2026/06/17");
    } finally {
      vi.useRealTimers();
    }
  });
});
