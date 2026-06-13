/**
 * CliChatEngineImpl — a persistent per-session CLI engine that drives a coding
 * CLI (`claude`, `codex`, or `gemini`) inside a long-lived multiplexer session
 * and exposes it via the CliChatEngine interface.
 *
 * The engine is multiplexer-neutral: session lifecycle (open/submit/isAlive/kill)
 * is delegated to an injected `Multiplexer` (tmux by default, herdr alternative),
 * and the engine stores the OPAQUE handle that `open()` returns. The engine keeps
 * owning file/transcript I/O via the shared `TmuxIo` seam from @jarv1s/ai, so it
 * is unit-testable without a real tmux/herdr binary, a real CLI install, or
 * Postgres. With no `mux` opt it defaults to a TmuxMultiplexer over the same io,
 * reproducing the exact legacy tmux verb sequence.
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
import { join } from "node:path";

import {
  parseTranscript,
  transcriptGlobDir,
  TmuxMultiplexer,
  type Multiplexer,
  type MuxHandle,
  type ProviderKind,
  type TmuxIo
} from "@jarv1s/ai";

import { CliChatUnavailableError } from "./errors.js";
import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";

/** Session name prefix used for all Jarv1s live sessions (the multiplexer `name` hint). */
const SESSION_PREFIX = "jarv1s-live-";

export interface CliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter (passed to the default tmux backend). */
  readonly submitMs?: number;
  /** Multiplexer backend; defaults to a TmuxMultiplexer over the same io (preserves legacy behavior). */
  readonly mux?: Multiplexer;
  /**
   * Base dir whose `.claude`/`.codex`/`.gemini` hold the CLI transcripts.
   * Set to the bind-mounted host HOME base when running containerized
   * (deployable-stack §6); omitted → the OS home of the running process.
   */
  readonly homeBase?: string;
}

/**
 * A persistent CLI session driven through a Multiplexer. One instance per live
 * session. Supports anthropic (Claude Code), openai-compatible (Codex), and
 * google (Gemini).
 */
export class CliChatEngineImpl implements CliChatEngine {
  private readonly launchMs: number;
  private readonly mux: Multiplexer;
  /** The opaque session handle returned by mux.open() at launch. */
  private handle: MuxHandle | null = null;

  /** Set at launch: the exact JSONL transcript path (session-id pinned). */
  private storedTranscriptPath: string | null = null;

  /** Optional host-HOME base for transcript resolution (containerized bridge). */
  private readonly homeBase?: string;

  constructor(
    public readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: CliChatEngineOpts = {}
  ) {
    this.launchMs = opts.launchMs ?? 3_000;
    this.mux = opts.mux ?? new TmuxMultiplexer(io, { submitMs: opts.submitMs ?? 600 });
    this.homeBase = opts.homeBase;
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
      transcriptGlobDir(this.provider, opts.neutralDir, this.homeBase),
      `${sessionId}.jsonl`
    );

    const launchLine = this.buildLaunchCommand(opts, sessionId);
    try {
      this.handle = await this.mux.open({
        name: `${SESSION_PREFIX}${this.threadKey}`,
        cols: 220,
        rows: 50,
        launchLine
      });
    } catch (err) {
      // A backend exit-code failure (missing binary via JARVIS_MULTIPLEXER override,
      // herdr socket failure, unresolvable root pane, tmux new-session failure) throws
      // a plain Error from mux.open(). Convert it to the 503-mapped error with a
      // sanitized message; the raw cause is logged server-side by the route handler
      // (Codex R2 #2). Never surface raw stderr to the client.
      throw new CliChatUnavailableError("could not start the live chat session", { cause: err });
    }

    // Let the CLI TUI finish booting before the first prompt is pasted.
    await this.io.sleep(this.launchMs);
  }

  async submit(text: string): Promise<void> {
    const sanitized = sanitizeInput(text);
    await this.mux.submit(this.requireHandle(), sanitized);
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.storedTranscriptPath === null) {
      throw new Error("CliChatEngineImpl.readNew called before launch()");
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
    if (this.handle === null) return false;
    return this.mux.isAlive(this.handle);
  }

  async kill(): Promise<void> {
    if (this.handle === null) return;
    await this.mux.kill(this.handle);
  }

  // ─── introspection (used by tests / callers needing the pinned path) ─────────

  /** The exact transcript path computed at launch, or throws if not launched. */
  transcriptPath(): string {
    if (this.storedTranscriptPath === null) {
      throw new Error("CliChatEngineImpl.transcriptPath called before launch()");
    }
    return this.storedTranscriptPath;
  }

  private requireHandle(): MuxHandle {
    if (this.handle === null) {
      throw new Error("CliChatEngineImpl.submit called before launch()");
    }
    return this.handle;
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
    // equivalent, so the token appears in the launch line and ps output. Under the household
    // model this is a shared-uid soft boundary (see the chat module README "Known security
    // limitation"); the token is short-lived, process-scoped, and RLS-scoped server-side.
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
