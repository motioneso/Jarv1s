/**
 * TmuxCliChatEngine — a persistent per-session CLI engine that drives the
 * `claude` (Claude Code) binary inside a long-lived tmux session and exposes it
 * via the CliChatEngine interface.
 *
 * Unlike the one-shot TmuxBridgeAdapter (which launches the CLI, reads one
 * reply, and is driven turn-by-turn from the worker), this engine keeps the tmux
 * session alive across turns: launch() once, then submit()/readNew() many times.
 *
 * I/O (subprocess, fs, timing) is injected via the shared `TmuxIo` seam from
 * @jarv1s/ai so the engine is unit-testable without a real tmux binary, a real
 * `claude` install, or Postgres.
 *
 * The Claude launch flags below are SECURITY-CRITICAL and were empirically
 * verified in the Phase 1 spike (docs/superpowers/spikes/2026-06-08-cli-capability-matrix.md):
 *   --permission-mode default       — NOT bypass (overrides host's global bypass default)
 *   --tools ""                      — empty allowlist disables ALL native tools (F1: a
 *                                     denylist was bypassed via the Monitor tool)
 *   --append-system-prompt-file P   — inject persona (survives /clear; append, not replace)
 *   --session-id <uuid>             — pin the transcript filename, known before launch
 *   --strict-mcp-config             — do not load the operator's global MCP servers
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTranscript, transcriptGlobDir, type ProviderKind, type TmuxIo } from "@jarv1s/ai";

import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";

/** Session name prefix used for all Jarv1s live tmux sessions. */
const SESSION_PREFIX = "jarv1s-live-";

/** The CLI binary that backs each provider kind. */
const CLI_FOR: Record<ProviderKind, string> = {
  anthropic: "claude",
  "openai-compatible": "codex",
  google: "gemini"
};

export interface TmuxCliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
}

/**
 * A persistent CLI session driven through tmux. One instance per live session.
 *
 * Only the `anthropic` provider (Claude Code) is implemented in Phase 1 — it is
 * the only CLI verified available on the host. codex/gemini are dispatched but
 * throw a clear "not yet supported" error until they are re-spiked (matrix F5).
 */
export class TmuxCliChatEngine implements CliChatEngine {
  private readonly sessionName: string;
  private readonly launchMs: number;
  private readonly submitMs: number;
  /** Stable per-session temp prompt path, overwritten (not accumulated) per turn. */
  private readonly promptFile: string;

  /** Set at launch: the exact JSONL transcript path (session-id pinned). */
  private storedTranscriptPath: string | null = null;

  constructor(
    public readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: TmuxCliChatEngineOpts = {}
  ) {
    this.sessionName = `${SESSION_PREFIX}${threadKey}`;
    this.launchMs = opts.launchMs ?? 3_000;
    this.submitMs = opts.submitMs ?? 600;
    // One stable temp file per session: each submit() overwrites it (written then
    // immediately pasted before the next turn), so at most one prompt file exists
    // per session at a time instead of accumulating one per turn.
    this.promptFile = join(tmpdir(), `jarv1s-live-prompt-${this.sessionName}.txt`);
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  async launch(opts: EngineLaunchOpts): Promise<void> {
    if (this.provider !== "anthropic") {
      throw new Error(
        `TmuxCliChatEngine: provider "${this.provider}" is not yet supported in Phase 1 — ` +
          `only "anthropic" (Claude Code) is verified/available. ` +
          `codex/gemini must be re-spiked first (see cli-capability-matrix F5).`
      );
    }

    // Generate the session id up front so the transcript path is known before
    // launch — no fragile "find the newest transcript" globbing.
    const sessionId = randomUUID();
    this.storedTranscriptPath = join(
      transcriptGlobDir(this.provider, opts.neutralDir),
      `${sessionId}.jsonl`
    );

    // Start a detached tmux session (no command yet — we send the launch line
    // below so we can `cd` into the neutral dir first within the shell).
    await this.io.run("tmux", [
      "new-session",
      "-d",
      "-s",
      this.sessionName,
      "-x",
      "220",
      "-y",
      "50"
    ]);

    const launchLine = this.buildLaunchCommand(opts, sessionId);
    await this.io.run("tmux", ["send-keys", "-t", this.sessionName, launchLine, "Enter"]);

    // Let the CLI TUI finish booting before the first prompt is pasted.
    await this.io.sleep(this.launchMs);
  }

  async submit(text: string): Promise<void> {
    const sanitized = sanitizeInput(text);

    // Write to a single stable per-session temp file to avoid shell-escaping
    // hazards with long/multiline prompts. Reusing one path (overwritten each
    // turn) keeps at most one prompt file per session instead of leaking one per
    // turn; the file is written then immediately pasted before the next turn.
    // Then load + paste the buffer and send Enter as a SEPARATE step (bracketed
    // paste needs a settle before Enter, or the Enter is absorbed).
    await this.io.writeFile(this.promptFile, sanitized);

    const bufferName = `jarv1s-live-${this.threadKey}`;
    await this.io.run("tmux", ["load-buffer", "-b", bufferName, this.promptFile]);
    await this.io.run("tmux", ["paste-buffer", "-b", bufferName, "-t", this.sessionName]);
    await this.io.sleep(this.submitMs);
    await this.io.run("tmux", ["send-keys", "-t", this.sessionName, "Enter"]);
  }

  async clear(): Promise<void> {
    // /clear resets conversation history while keeping the process + launch
    // persona (verified to survive /clear in the spike). Send the literal text,
    // then Enter as a separate send-keys.
    await this.io.run("tmux", ["send-keys", "-t", this.sessionName, "/clear"]);
    await this.io.sleep(this.submitMs);
    await this.io.run("tmux", ["send-keys", "-t", this.sessionName, "Enter"]);
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.storedTranscriptPath === null) {
      throw new Error("TmuxCliChatEngine.readNew called before launch()");
    }

    let jsonl: string;
    try {
      jsonl = await this.io.readFile(this.storedTranscriptPath);
    } catch {
      // Transcript not created yet — tolerate, return empty/not-complete and
      // keep the caller's offset so nothing is skipped.
      return { records: [], offset: afterOffset, complete: false };
    }

    const parsed = parseTranscript(this.provider, jsonl, afterOffset);

    const records: TranscriptRecord[] = parsed.events.map((e) => ({
      kind: e.kind as ChatRecordKind,
      text: e.text
    }));
    if (parsed.complete && parsed.reply !== null) {
      records.push({ kind: "reply", text: parsed.reply });
    }

    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    const { code } = await this.io.run("tmux", ["has-session", "-t", this.sessionName]);
    return code === 0;
  }

  async kill(): Promise<void> {
    await this.io.run("tmux", ["kill-session", "-t", this.sessionName]);
  }

  // ─── introspection (used by tests / callers needing the pinned path) ─────────

  /** The exact transcript path computed at launch, or throws if not launched. */
  transcriptPath(): string {
    if (this.storedTranscriptPath === null) {
      throw new Error("TmuxCliChatEngine.transcriptPath called before launch()");
    }
    return this.storedTranscriptPath;
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────

  /**
   * Build the single shell line that `cd`s into the neutral dir and launches the
   * CLI with the security-critical flags. Sent as one `send-keys` line (the
   * matrix's recommended shape).
   */
  private buildLaunchCommand(opts: EngineLaunchOpts, sessionId: string): string {
    const cli = CLI_FOR[this.provider];
    const parts = [
      `cd ${shellQuote(opts.neutralDir)} &&`,
      cli,
      "--permission-mode default",
      '--tools ""',
      `--append-system-prompt-file ${shellQuote(opts.personaPath)}`,
      `--session-id ${sessionId}`,
      "--strict-mcp-config"
    ];
    return parts.join(" ");
  }
}

// ─── module-level helpers ──────────────────────────────────────────────────────

/**
 * Sanitize a submitted prompt so it can never trigger the interactive CLI's
 * `!`-bash-prefix escape hatch (matrix F4). A leading `!` (after any leading
 * whitespace) would let the line run as host bash; strip it.
 */
function sanitizeInput(text: string): string {
  return text.replace(/^(\s*)!+/, "$1");
}

/** Minimal POSIX single-quote shell quoting for paths embedded in a send-keys line. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
