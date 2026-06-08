/**
 * TmuxBridgeAdapter — drives a local CLI (claude / codex / gemini) inside a
 * per-thread tmux session and reads the CLI's JSONL session transcript for
 * activity events and the final reply.
 *
 * I/O boundaries (subprocess, fs, timing) are injected via TmuxIo so that
 * unit tests can run without Postgres, a real tmux binary, or any live CLI.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ChatProviderAdapter, GenerateChatInput } from "../chat-adapter.js";
import { parseTranscript, type ProviderKind } from "./transcript-reader.js";

// ─── Public interface ────────────────────────────────────────────────────────

export interface TmuxIo {
  /** Run an external command; resolve to { code, stdout }. */
  run(cmd: string, args: readonly string[]): Promise<{ code: number; stdout: string }>;
  /** Read a file path to a string (may throw if not yet created). */
  readFile(path: string): Promise<string>;
  /** Non-blocking sleep. */
  sleep(ms: number): Promise<void>;
}

// ─── Per-provider constants ───────────────────────────────────────────────────

const CLI_FOR: Record<ProviderKind, string> = {
  anthropic: "claude",
  "openai-compatible": "codex",
  google: "gemini"
};

/**
 * Resolve the path of the JSONL transcript that the CLI writes during an
 * interactive session.  These paths were discovered from real installs:
 *
 * - anthropic / Claude Code:
 *     Writes a JSONL file per session under
 *     ~/.claude/projects/<url-encoded-cwd>/<uuid>.jsonl
 *     We cannot know the session UUID before the session starts, so we look
 *     for the most-recently-modified *.jsonl under the project directory.
 *
 * - openai-compatible / Codex:
 *     Writes session rolls under
 *     ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<uuid>.jsonl
 *     Again, use the newest file under today's directory.
 *
 * - google / Gemini CLI:
 *     Writes session chats under
 *     ~/.gemini/tmp/<project-hash>/chats/session-<ISO>-<uuid>.jsonl
 *     Use the newest file under the chats directory for the given project dir.
 */
function transcriptGlobDir(provider: ProviderKind, cwd: string): string {
  switch (provider) {
    case "anthropic": {
      // URL-encode the cwd the same way Claude Code does
      const encoded = cwd.replace(/\//g, "-").replace(/^-/, "");
      return join(homedir(), ".claude", "projects", encoded);
    }
    case "openai-compatible": {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      return join(homedir(), ".codex", "sessions", String(y), m, d);
    }
    case "google": {
      // Gemini uses a hash of the project dir; approximate by using a glob
      // under ~/.gemini/tmp — in practice we find the newest chats file
      return join(homedir(), ".gemini", "tmp");
    }
  }
}

// ─── Adapter implementation ───────────────────────────────────────────────────

/** Session name prefix used for all Jarv1s tmux sessions. */
const SESSION_PREFIX = "jarv1s-";

export class TmuxBridgeAdapter implements ChatProviderAdapter {
  private readonly timeoutMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: { timeoutMs?: number; pollMs?: number } = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.pollMs = opts.pollMs ?? 1_000;
  }

  async generateChat(input: GenerateChatInput): Promise<{ text: string }> {
    const sessionName = `${SESSION_PREFIX}${this.threadKey}`;
    const cli = CLI_FOR[this.provider];
    const cwd = process.cwd();

    // 1. Ensure a tmux session exists (idempotent: new-session -d -s ignores EEXIST)
    await this.io.run("tmux", [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-x",
      "220",
      "-y",
      "50",
      cli
    ]);

    // 2. Snapshot the current transcript directory state so we can detect new files
    const transcriptDir = transcriptGlobDir(this.provider, cwd);

    // 3. Write the prompt to a temp file (avoids shell escaping issues with long prompts)
    const promptText = buildPromptText(input);
    const tmpFile = join(tmpdir(), `jarv1s-prompt-${this.threadKey}-${Date.now()}.txt`);
    await this.io.run("bash", ["-c", `cat > ${tmpFile}`, promptText]);

    // 4. Load and paste the prompt buffer, then send Enter
    await this.io.run("tmux", ["load-buffer", "-b", `jarv1s-${this.threadKey}`, tmpFile]);
    await this.io.run("tmux", [
      "paste-buffer",
      "-b",
      `jarv1s-${this.threadKey}`,
      "-t",
      sessionName
    ]);
    await this.io.run("tmux", ["send-keys", "-t", sessionName, "", "Enter"]);

    // 5. Find the transcript file (newest .jsonl under the dir)
    const transcriptPath = await this.findNewestTranscript(transcriptDir);

    // 6. Poll the transcript until complete or timeout
    const deadline = Date.now() + this.timeoutMs;
    let afterOffset = 0;

    while (Date.now() < deadline) {
      let jsonl: string;
      try {
        jsonl = await this.io.readFile(transcriptPath);
      } catch {
        // File not yet created — keep polling
        await this.io.sleep(this.pollMs);
        continue;
      }

      const result = parseTranscript(this.provider, jsonl, afterOffset);

      // Emit any new activity events
      for (const event of result.events) {
        input.onActivity?.(event);
      }

      // Advance the offset so next poll skips already-processed bytes
      afterOffset = jsonl.length;

      if (result.complete && result.reply !== null) {
        // Clean up temp file (best-effort, non-blocking)
        this.io.run("rm", ["-f", tmpFile]).catch(() => undefined);
        return { text: result.reply };
      }

      await this.io.sleep(this.pollMs);
    }

    throw new Error(
      `TmuxBridgeAdapter timeout after ${this.timeoutMs}ms waiting for ${cli} reply ` +
        `(thread=${this.threadKey})`
    );
  }

  /** Find the most recently modified *.jsonl under dir (one level). */
  private async findNewestTranscript(dir: string): Promise<string> {
    // Use find + sort by modification time; fall back to a synthetic path if empty
    const { stdout } = await this.io.run("bash", [
      "-c",
      `find ${dir} -maxdepth 3 -name '*.jsonl' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}'`
    ]);
    const path = stdout.trim();
    if (path) return path;
    // Return a plausible path even if not yet created; readFile will throw and
    // the poll loop will retry.
    return join(dir, "session.jsonl");
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the text to send to the CLI as the user's turn.
 * We send the conversation history as a compact JSON block so the CLI can
 * parse it, or as a plain text message if there's only a single user message.
 */
function buildPromptText(input: GenerateChatInput): string {
  const { messages } = input;
  if (messages.length === 1 && messages[0]?.role === "user") {
    return messages[0].content;
  }
  // Multi-turn: send as a structured block the CLI can pick up
  return (
    "<conversation>\n" +
    messages.map((m) => `<${m.role}>${m.content}</${m.role}>`).join("\n") +
    "\n</conversation>"
  );
}
