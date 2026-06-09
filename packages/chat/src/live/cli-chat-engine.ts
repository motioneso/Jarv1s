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

export interface TmuxCliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
}

/**
 * A persistent CLI session driven through tmux. One instance per live session.
 * Supports anthropic (Claude Code), openai-compatible (Codex), and google (Gemini).
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
    // Generate the session id up front so the transcript path is known before
    // launch — no fragile "find the newest transcript" globbing.
    const sessionId = randomUUID();

    if (this.provider === "google" && opts.mcpToken && opts.mcpServerUrl) {
      const settingsDir = join(opts.neutralDir, ".gemini");
      await this.io.run("mkdir", ["-p", settingsDir]);
      const settings = {
        mcpServers: {
          jarvis: {
            httpUrl: opts.mcpServerUrl,
            headers: { Authorization: `Bearer ${opts.mcpToken}` },
            timeout: 180000
          }
        },
        tools: { core: [] as string[] },
        security: { disableYoloMode: true }
      };
      await this.io.writeFile(
        join(settingsDir, "settings.json"),
        JSON.stringify(settings, null, 2)
      );
    }

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
    switch (this.provider) {
      case "anthropic":
        return this.buildClaudeCommand(opts, sessionId);
      case "openai-compatible":
        return this.buildCodexCommand(opts);
      case "google":
        return this.buildGeminiCommand(opts);
    }
  }

  private buildClaudeCommand(opts: EngineLaunchOpts, sessionId: string): string {
    const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, "claude", "--permission-mode default"];

    if (opts.mcpToken && opts.mcpServerUrl) {
      const mcpConfig = JSON.stringify({
        mcpServers: {
          jarvis: {
            type: "http",
            url: opts.mcpServerUrl,
            headers: { Authorization: `Bearer ${opts.mcpToken}` },
            timeout: 180000
          }
        }
      });
      parts.push(`--mcp-config ${shellQuote(mcpConfig)}`);
      parts.push('--allowedTools "mcp__jarvis__*"');
    } else {
      parts.push('--tools ""');
    }

    parts.push(
      `--append-system-prompt-file ${shellQuote(opts.personaPath)}`,
      `--session-id ${sessionId}`,
      "--strict-mcp-config"
    );

    return parts.join(" ");
  }

  private buildCodexCommand(opts: EngineLaunchOpts): string {
    const tokenEnvVar = "JARVIS_MCP_TOKEN";
    // Codex reads the Bearer token via bearer_token_env_var; there is no file-based injection
    // equivalent. The token appears in the tmux send-keys command and ps output — accepted tradeoff
    // for a local single-user session where the token is short-lived and process-scoped.
    const envPrefix = opts.mcpToken ? `${tokenEnvVar}=${opts.mcpToken} ` : "";
    const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, `${envPrefix}codex`];

    if (opts.mcpToken && opts.mcpServerUrl) {
      parts.push(
        `-c 'mcp_servers.jarvis.url="${opts.mcpServerUrl}"'`,
        `-c 'mcp_servers.jarvis.bearer_token_env_var="${tokenEnvVar}"'`,
        `-c 'mcp_servers.jarvis.tool_timeout_sec=180'`,
        `-c 'features.shell_tool=false'`,
        `-c 'features.apply_patch_tool=false'`
      );
    }
    parts.push("--sandbox read-only", "-a never");

    return parts.join(" ");
  }

  private buildGeminiCommand(opts: EngineLaunchOpts): string {
    // Token is already injected via .gemini/settings.json Authorization header — no env var needed.
    const parts = [
      `cd ${shellQuote(opts.neutralDir)} &&`,
      "gemini",
      "--allowed-mcp-server-names jarvis"
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
