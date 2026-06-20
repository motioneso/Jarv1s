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
 *
 * #342 (in-container CLI chat) changes the launch contract: `launch` now writes the
 * persona file under the SERVER-derived neutral dir, moves Claude's MCP token OFF the
 * launch line into a `0600` `.jarvis-claude-mcp.json` (§6.2), submits + drains the
 * `replayBatch` server-side (bounded — §4.1/§5), and returns the post-drain transcript
 * `offset` so the api can seed `transcriptOffset` (§4.1.2). `kill` and a failed launch
 * remove the ENTIRE per-session neutral dir (§6.5). Module-level helpers expose the
 * mux-name-keyed operations the cli-runner server needs without a per-session engine
 * object: `killMuxSessionByName` (§4.5), `listLiveMuxSessions` (§4.6), `removeNeutralDir`
 * (§6.5), and `probeProvider` (§4.8).
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  parseTranscript,
  redactSecrets,
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
export const SESSION_PREFIX = "jarv1s-live-";

/**
 * Session name prefix for Jarv1s LOGIN sessions (login-contract §L.6.1). DISTINCT from
 * {@link SESSION_PREFIX} so login sessions are invisible to the chat `listLiveMuxSessions`
 * enumeration / §5 reconciliation (a login is not a chat session — it has no MCP token to
 * reconcile), and the chat helpers never touch a login session. The login canonical name is
 * `jarv1s-login-<provider>` (the provider is a fixed enum literal — no traversal risk).
 */
export const LOGIN_SESSION_PREFIX = "jarv1s-login-";

/** The persona filename written under the per-session neutral dir (`0600`). */
const PERSONA_FILENAME = "persona.md";

/** Claude's MCP-config file (the FULL --mcp-config JSON incl. the bearer); `0600` (§6.2/§6.5). */
const CLAUDE_MCP_FILENAME = ".jarvis-claude-mcp.json";

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
  /**
   * #342: when set, the engine OWNS the server-side replay-drain. After launch it
   * submits `opts.replayBatch` (if present) and drains the transcript to a clean
   * boundary, returning the post-drain `offset` (§4.1.2). When false/omitted the
   * engine returns `{ offset: 0 }` and the api manager keeps draining itself (the
   * in-process host path, §4.1.2). The cli-runner server constructs the engine with
   * `ownsDrain: true`.
   */
  readonly ownsDrain?: boolean;
  /**
   * #342: max wall-clock ms the server-side replay-drain may run before returning the
   * last safe offset (NEVER blocks a later kill). Bounded per §4.1/§5. Default 25s,
   * mirroring the onboarding provider-check budget.
   */
  readonly drainMs?: number;
  /** #342: poll interval (ms) used while draining the replay. Default 250ms. */
  readonly drainPollMs?: number;
}

/** Result of a bounded server-side replay-drain (§4.1.2). */
interface DrainOutcome {
  /** The transcript length consumed at the last safe boundary (jsonl.length / UTF-16). */
  readonly offset: number;
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

  /**
   * The resolved JSONL transcript path. For `anthropic` this is pinned at launch
   * (`--session-id` makes the filename deterministic and known before the CLI
   * boots). For `openai-compatible`/`google` the CLI chooses its own filename
   * (`rollout-…`/`session-…`), so this stays null until `readNew()` resolves the
   * newest `.jsonl` under the glob dir lazily (the file does not exist until the
   * CLI writes its first turn).
   */
  private storedTranscriptPath: string | null = null;

  /**
   * Set at launch: the directory the active provider writes its transcript into.
   * Used to lazily resolve the newest transcript file for providers that do NOT
   * accept a session-id (Codex/Gemini).
   */
  private transcriptDir: string | null = null;

  /** The cwd used to launch the CLI; Codex records it in session_meta.cwd. */
  private neutralDir: string | null = null;

  /** Per-session Codex MCP token env file, removed on kill / failed launch. */
  private codexTokenEnvPath: string | null = null;

  /** Optional host-HOME base for transcript resolution (containerized bridge). */
  private readonly homeBase?: string;

  /** #342: whether this engine owns the server-side replay-drain (cli-runner path). */
  private readonly ownsDrain: boolean;
  private readonly drainMs: number;
  private readonly drainPollMs: number;

  constructor(
    public readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: CliChatEngineOpts = {}
  ) {
    this.launchMs = opts.launchMs ?? 3_000;
    this.mux = opts.mux ?? new TmuxMultiplexer(io, { submitMs: opts.submitMs ?? 600 });
    this.homeBase = opts.homeBase;
    this.ownsDrain = opts.ownsDrain ?? false;
    this.drainMs = opts.drainMs ?? 25_000;
    this.drainPollMs = opts.drainPollMs ?? 250;
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  async launch(opts: EngineLaunchOpts): Promise<{ offset: number }> {
    // Generate the session id up front. For Claude this also pins the transcript
    // filename (`--session-id`), so no fragile newest-file globbing is needed there.
    // Codex/Gemini don't accept a session-id, so their transcript path is resolved
    // lazily in readNew() (newest .jsonl under the glob dir).
    const sessionId = randomUUID();
    this.neutralDir = opts.neutralDir;

    // ── PRE-mux-create setup (persona + per-provider secret files) ──────────────
    // Any failure here is a PRE-mux-create failure: no mux session exists yet, so
    // removing the per-session neutral dir suffices (§6.5). The whole block is
    // guarded so a write failure tears down the dir before surfacing the error.
    let personaPath: string;
    try {
      // When the cli-runner owns the launch it ships persona CONTENT (`personaText`),
      // not a path: write it under the server-derived neutral dir, `0600` (§4.1.1a).
      // The in-process host path keeps using the manager-rendered `personaPath`.
      personaPath = await this.resolvePersonaPath(opts);

      this.codexTokenEnvPath =
        this.provider === "openai-compatible" ? await this.writeCodexTokenEnv(opts) : null;

      if (this.provider === "google" && opts.mcpToken && opts.mcpServerUrl) {
        await this.writeGeminiSettings(opts);
      }
    } catch (err) {
      // PRE-mux-create failure: remove the whole per-session neutral dir (§6.5).
      await this.removeNeutralDirQuietly();
      throw new CliChatUnavailableError("could not start the live chat session", {
        cause: redactCause(err)
      });
    }

    this.transcriptDir = transcriptGlobDir(this.provider, opts.neutralDir, this.homeBase);
    // Only Claude is launched with `--session-id`, so only Claude's transcript filename
    // is known up front. Codex/Gemini name their own file (`rollout-…`/`session-…`), so
    // their path is resolved lazily in readNew() — pinning `${sessionId}.jsonl` for them
    // would point at a file that never exists, so replies could never be read back.
    this.storedTranscriptPath =
      this.provider === "anthropic" ? join(this.transcriptDir, `${sessionId}.jsonl`) : null;

    const launchLine = await this.buildLaunchCommand(opts, sessionId, personaPath);
    try {
      this.handle = await this.mux.open({
        name: `${SESSION_PREFIX}${this.threadKey}`,
        cols: 220,
        rows: 50,
        launchLine
      });
    } catch (err) {
      // PRE-mux-create failure (the mux.open itself failed and tore down any
      // half-created session): remove the entire per-session neutral dir (§6.5).
      // This drops every per-provider secret file (Claude/Codex/Gemini) + persona.
      await this.removeNeutralDirQuietly();
      // A backend exit-code failure (missing binary via JARVIS_MULTIPLEXER override,
      // herdr socket failure, unresolvable root pane, tmux new-session failure) throws
      // a plain Error from mux.open(). Convert it to the 503-mapped error with a
      // sanitized message; the raw cause is logged server-side by the route handler
      // (Codex R2 #2). Never surface raw stderr to the client.
      //
      // Defense-in-depth: a custom multiplexer can still echo token-shaped stderr.
      // Redact at this boundary so no token shape can reach a log via the
      // structurally-serialized `cause`.
      throw new CliChatUnavailableError("could not start the live chat session", {
        cause: redactCause(err)
      });
    }

    // ── POST-mux-create: boot wait + (server-owned) replay-drain ────────────────
    // From here `jarv1s-live-<threadKey>` EXISTS. Any failure is a POST-mux-create
    // failure: per §6.5 we MUST kill the mux session by canonical name BEFORE
    // removing the dir, else the orphan lingers in listLiveSessions-by-mux and
    // blocks the §4.1.0a single-active-user gate for everyone.
    try {
      // Let the CLI TUI finish booting before the first prompt is pasted.
      await this.io.sleep(this.launchMs);

      if (!this.ownsDrain) {
        // In-process host path: the manager owns the replay-drain (§4.1.2). Return
        // offset 0 so it keeps overwriting `transcriptOffset` from its own drain.
        return { offset: 0 };
      }

      // cli-runner path: submit the replay batch (if any) and drain to a clean
      // boundary, returning the post-drain offset (§4.1.2).
      const drained = await this.replayAndDrain(opts.replayBatch);
      return { offset: drained.offset };
    } catch (err) {
      await this.killAndRemoveNeutralDirQuietly();
      throw new CliChatUnavailableError("could not start the live chat session", {
        cause: redactCause(err)
      });
    }
  }

  async submit(text: string): Promise<void> {
    const sanitized = sanitizeInput(text);
    await this.mux.submit(this.requireHandle(), sanitized);
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.transcriptDir === null) {
      throw new Error("CliChatEngineImpl.readNew called before launch()");
    }

    const path = await this.resolveTranscriptPath();
    if (path === null) {
      // Transcript file not created yet (Codex/Gemini name it on first write) —
      // tolerate, return empty/not-complete and keep the caller's offset.
      return { records: [], offset: afterOffset, complete: false };
    }

    let jsonl: string;
    try {
      jsonl = await this.io.readFile(path);
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
    try {
      if (this.handle !== null) {
        await this.mux.kill(this.handle);
      } else {
        // No engine-stored handle (e.g. a relaunch raced a restart): still kill by
        // the canonical mux name so a live `jarv1s-live-<key>` session can't survive
        // a kill (§4.5). Idempotent — killing an absent session is not an error.
        await killMuxSessionByName(this.io, this.threadKey);
      }
    } finally {
      this.handle = null;
      // §6.5: remove the ENTIRE per-session neutral dir on kill (covers Claude's
      // .jarvis-claude-mcp.json, Codex's .jarvis-mcp-token.env, Gemini's
      // .gemini/settings.json, AND the persona file) — not just one file.
      this.codexTokenEnvPath = null;
      await this.removeNeutralDirQuietly();
    }
  }

  // ─── introspection (used by tests / callers needing the pinned path) ─────────

  /**
   * The transcript path. For `anthropic` it is the session-id-pinned path computed
   * at launch. For `openai-compatible`/`google` the filename is chosen by the CLI,
   * so this returns the most-recently-resolved path (or throws if not yet resolved —
   * call after at least one readNew(), or use readNew() directly).
   */
  transcriptPath(): string {
    if (this.transcriptDir === null) {
      throw new Error("CliChatEngineImpl.transcriptPath called before launch()");
    }
    if (this.storedTranscriptPath === null) {
      throw new Error(
        "CliChatEngineImpl.transcriptPath: transcript not yet resolved for this provider (no .jsonl file written yet)"
      );
    }
    return this.storedTranscriptPath;
  }

  /**
   * Resolve the path of the transcript file to read.
   *
   * - `anthropic`: pinned at launch (deterministic via `--session-id`).
   * - `openai-compatible`/`google`: the CLI names its own file (`rollout-…`/
   *   `session-…`), so resolve the NEWEST `.jsonl` under the glob dir. We cache it
   *   once found so a later log-rotation can't switch us to a different file
   *   mid-session. Returns null if no transcript file exists yet.
   */
  private async resolveTranscriptPath(): Promise<string | null> {
    if (this.storedTranscriptPath !== null) return this.storedTranscriptPath;
    if (this.transcriptDir === null) return null;

    // `ls -t` sorts by mtime, newest first; tolerate a not-yet-created dir (nonzero exit).
    const listed = await this.io.run("ls", ["-t", this.transcriptDir]);
    if (listed.code !== 0) return null;
    const candidates = listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => name.endsWith(".jsonl"));

    let newest: string | undefined;
    if (this.provider === "openai-compatible" && this.neutralDir !== null) {
      newest = await this.findCodexTranscriptForCwd(candidates);
    } else {
      newest = candidates[0];
    }
    if (!newest) return null;

    this.storedTranscriptPath = join(this.transcriptDir, newest);
    return this.storedTranscriptPath;
  }

  private async findCodexTranscriptForCwd(
    candidates: readonly string[]
  ): Promise<string | undefined> {
    for (const candidate of candidates.slice(0, 20)) {
      const path = join(this.transcriptDir ?? "", candidate);
      let jsonl: string;
      try {
        jsonl = await this.io.readFile(path);
      } catch {
        continue;
      }
      if (codexTranscriptMatchesCwd(jsonl, this.neutralDir ?? "")) {
        return candidate;
      }
    }
    return undefined;
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
  private async buildLaunchCommand(
    opts: EngineLaunchOpts,
    sessionId: string,
    personaPath: string
  ): Promise<string> {
    switch (this.provider) {
      case "anthropic":
        return this.buildClaudeCommand(opts, sessionId, personaPath);
      case "openai-compatible":
        return this.buildCodexCommand(opts);
      case "google":
        return this.buildGeminiCommand(opts);
    }
  }

  /**
   * Build the Claude launch line. The MCP bearer token is NEVER on the line: the
   * full `--mcp-config` JSON (incl. the `Authorization: Bearer jst_…` header) is
   * written to a `0600` `<neutralDir>/.jarvis-claude-mcp.json` and the line passes
   * the PATH, not the JSON (§6.2). `claude --mcp-config` accepts a file path.
   */
  private async buildClaudeCommand(
    opts: EngineLaunchOpts,
    sessionId: string,
    personaPath: string
  ): Promise<string> {
    const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, "claude", "--permission-mode default"];

    if (opts.mcpToken && opts.mcpServerUrl) {
      const mcpConfigPath = await this.writeClaudeMcpConfig(opts);
      parts.push(`--mcp-config ${shellQuote(mcpConfigPath)}`);
      parts.push('--allowedTools "mcp__jarvis__*"');
    } else {
      parts.push('--tools ""');
    }

    parts.push(
      `--append-system-prompt-file ${shellQuote(personaPath)}`,
      `--session-id ${sessionId}`,
      "--strict-mcp-config"
    );

    return parts.join(" ");
  }

  private buildCodexCommand(opts: EngineLaunchOpts): string {
    const tokenEnvVar = "JARVIS_MCP_TOKEN";
    const sourceEnv = this.codexTokenEnvPath ? `. ${shellQuote(this.codexTokenEnvPath)} &&` : "";
    const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, sourceEnv, "codex"];

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
    const parts = [`cd ${shellQuote(opts.neutralDir)} &&`, "agy", "--sandbox"];
    return parts.join(" ");
  }

  /**
   * Resolve the persona file the CLI is pointed at. When `personaText` is supplied
   * (the cli-runner RPC path), write it under the server-derived neutral dir `0600`
   * and return that path (§4.1.1a). Otherwise (in-process host path) use the
   * manager-rendered `personaPath` unchanged.
   */
  private async resolvePersonaPath(opts: EngineLaunchOpts): Promise<string> {
    if (opts.personaText === undefined) return opts.personaPath;
    await this.io.run("mkdir", ["-p", opts.neutralDir]);
    const path = join(opts.neutralDir, PERSONA_FILENAME);
    await this.io.writeFile(path, opts.personaText);
    // Persona text is not a secret, but keep the dir uniform `0600` files (§6.2).
    await this.io.run("chmod", ["600", path]);
    return path;
  }

  /**
   * Write Claude's full `--mcp-config` JSON (incl. the bearer header) to a `0600`
   * file so the token never appears on the launch line / argv / capture-pane (§6.2).
   * Returns the file path the launch line references.
   */
  private async writeClaudeMcpConfig(opts: EngineLaunchOpts): Promise<string> {
    const path = join(opts.neutralDir, CLAUDE_MCP_FILENAME);
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
    await this.io.writeFile(path, mcpConfig);
    const chmod = await this.io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await this.io.run("rm", ["-f", path]);
      throw new Error(`Could not lock down Claude MCP config file: ${chmod.stderr ?? ""}`.trim());
    }
    return path;
  }

  private async writeGeminiSettings(opts: EngineLaunchOpts): Promise<void> {
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
    const path = join(settingsDir, "settings.json");
    await this.io.writeFile(path, JSON.stringify(settings, null, 2));
    // The settings file carries the Authorization header — lock it down `0600` (§6.5).
    // Symmetric with writeClaudeMcpConfig / writeCodexTokenEnv: if the chmod fails we
    // MUST NOT leave a world/group-readable token file behind. rm -f it and throw so the
    // failure routes through launch()'s removeNeutralDirQuietly cleanup (§6.5) — a failed
    // lockdown never leaves a readable Bearer token on disk.
    const chmod = await this.io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await this.io.run("rm", ["-f", path]);
      throw new Error(`Could not lock down Gemini settings file: ${chmod.stderr ?? ""}`.trim());
    }
  }

  private async writeCodexTokenEnv(opts: EngineLaunchOpts): Promise<string | null> {
    if (!opts.mcpToken) return null;
    const path = join(opts.neutralDir, ".jarvis-mcp-token.env");
    await this.io.writeFile(
      path,
      `JARVIS_MCP_TOKEN=${shellQuote(opts.mcpToken)}\nexport JARVIS_MCP_TOKEN\n`
    );
    const chmod = await this.io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await this.io.run("rm", ["-f", path]);
      throw new Error(`Could not lock down Codex MCP token file: ${chmod.stderr ?? ""}`.trim());
    }
    return path;
  }

  /**
   * Bounded server-side replay-drain (§4.1.2). Submits `replayBatch` (if present)
   * then polls the transcript until the provider signals end-of-turn OR the drain
   * budget elapses, returning the last safe offset. NEVER throws on a drain timeout
   * (a slow model must not fail the launch); a `submit` failure DOES surface (the
   * caller treats it as a POST-mux-create failure and reaps the session).
   */
  private async replayAndDrain(replayBatch: string | undefined): Promise<DrainOutcome> {
    if (!replayBatch) {
      // Fresh conversation: nothing to replay; the first real readNew starts at 0.
      return { offset: 0 };
    }

    await this.submit(replayBatch);

    const deadline = Date.now() + this.drainMs;
    let offset = 0;
    while (Date.now() < deadline) {
      let result: { records: TranscriptRecord[]; offset: number; complete: boolean };
      try {
        result = await this.readNew(offset);
      } catch {
        // Transcript not yet created / transient read miss — keep polling.
        await this.io.sleep(this.drainPollMs);
        continue;
      }
      offset = result.offset;
      if (result.complete) return { offset };
      await this.io.sleep(this.drainPollMs);
    }
    // Budget exhausted: return the last safe offset rather than block (§4.1/§5).
    return { offset };
  }

  /** §6.5: remove the ENTIRE per-session neutral dir; best-effort, never throws. */
  private async removeNeutralDirQuietly(): Promise<void> {
    const dir = this.neutralDir;
    if (!dir) return;
    try {
      await this.io.run("rm", ["-rf", dir]);
    } catch {
      // best-effort cleanup — never mask the original failure.
    }
  }

  /**
   * POST-mux-create failure path (§6.5): kill the canonical mux session BEFORE
   * removing the dir, else the orphan blocks the §4.1.0a single-active-user gate.
   */
  private async killAndRemoveNeutralDirQuietly(): Promise<void> {
    try {
      if (this.handle !== null) {
        await this.mux.kill(this.handle);
      } else {
        await killMuxSessionByName(this.io, this.threadKey);
      }
    } catch {
      // best-effort — fall through to dir removal.
    } finally {
      this.handle = null;
      await this.removeNeutralDirQuietly();
    }
  }
}

// ─── module-level mux-name operations (no per-session engine object) ─────────────

/**
 * Kill a live `jarv1s-live-<sessionKey>` mux session BY CANONICAL NAME (§4.5), even
 * when the cli-runner server holds no `CliChatEngineImpl` for it (post-restart). Uses
 * tmux directly (the bundled mux, §7.1). `sessionKey` is sanitized first (§4.1.1a).
 * Idempotent — killing an absent session is not an error.
 *
 * SECURITY (exact-name guard): `tmux kill-session -t <name>` resolves `<name>` as a
 * tmux TARGET, which is a PREFIX match by default — `-t jarv1s-live-bob` would also
 * kill `jarv1s-live-bobby` if it sorted as the unique prefix hit, killing more than the
 * intended session when one sessionKey is a prefix of another. The leading `=` forces
 * tmux to match the EXACTLY-named session and nothing else, so only the intended session
 * dies. (UUID sessionKeys never collide today; this guards non-UUID keys — e.g. a future
 * #347 scheme — so the kill primitive can never over-reach.)
 */
export async function killMuxSessionByName(
  io: Pick<TmuxIo, "run">,
  sessionKey: string
): Promise<void> {
  const name = `${SESSION_PREFIX}${sanitizeSessionKey(sessionKey)}`;
  await io.run("tmux", ["kill-session", "-t", `=${name}`]);
}

/**
 * Enumerate the sessionKeys of every LIVE `jarv1s-live-*` mux session via tmux
 * `list-sessions` (§4.6) — NOT the server's engine Map (which is empty after a
 * restart while real sessions survive). Strips the `jarv1s-live-` prefix to recover
 * each sessionKey. Tolerates "no server running" (nonzero exit → empty list).
 */
export async function listLiveMuxSessions(io: Pick<TmuxIo, "run">): Promise<string[]> {
  const listed = await io.run("tmux", ["list-sessions", "-F", "#{session_name}"]);
  if (listed.code !== 0) return [];
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(SESSION_PREFIX))
    .map((name) => name.slice(SESSION_PREFIX.length))
    .filter((key) => key.length > 0);
}

/**
 * login-contract §L.6.1: kill a live `jarv1s-login-<provider>` mux session BY CANONICAL
 * NAME, even when the login service holds no in-memory reservation for it (post-restart /
 * late-success orphan). Uses the SAME leading-`=` exact-name guard as
 * {@link killMuxSessionByName} (so a kill can never prefix-over-reach) but the LOGIN prefix
 * — do NOT reuse `killMuxSessionByName`, which is hardwired to `SESSION_PREFIX` and would
 * target `=jarv1s-live-<provider>`. `provider` is a fixed enum literal (no traversal risk).
 * Idempotent — killing an absent session is not an error.
 */
export async function killLoginMuxSession(
  io: Pick<TmuxIo, "run">,
  provider: string
): Promise<void> {
  const name = `${LOGIN_SESSION_PREFIX}${provider}`;
  await io.run("tmux", ["kill-session", "-t", `=${name}`]);
}

/**
 * login-contract §L.6.1: enumerate the providers of every LIVE `jarv1s-login-*` mux session
 * via tmux `list-sessions` — the disk liveness signal the unified admission gate (§L.6.1)
 * and the startup sweep (§L.3.4) consume (the in-memory login reservation is not the sole
 * source of truth, per the base D13/D14 lesson). Strips the LOGIN prefix to recover each
 * provider. Tolerates "no server running" (nonzero exit → empty list).
 */
export async function listLoginMuxSessions(io: Pick<TmuxIo, "run">): Promise<string[]> {
  const listed = await io.run("tmux", ["list-sessions", "-F", "#{session_name}"]);
  if (listed.code !== 0) return [];
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(LOGIN_SESSION_PREFIX))
    .map((name) => name.slice(LOGIN_SESSION_PREFIX.length))
    .filter((p) => p.length > 0);
}

/**
 * §6.5: remove a per-session neutral dir by sessionKey (used by the cli-runner kill
 * path for an orphan with no engine object). `rm -rf` is best-effort.
 */
export async function removeNeutralDir(
  io: Pick<TmuxIo, "run">,
  neutralBase: string,
  sessionKey: string
): Promise<void> {
  const dir = join(neutralBase, sanitizeSessionKey(sessionKey));
  await io.run("rm", ["-rf", dir]);
}

/**
 * Derive the per-session neutral dir from the sessionKey + base (§4.1.1a): join
 * after sanitizing the key (a user UUID — reject `/`, `..`, NUL before joining).
 */
export function deriveNeutralDir(neutralBase: string, sessionKey: string): string {
  return join(neutralBase, sanitizeSessionKey(sessionKey));
}

/**
 * Sanitize a sessionKey before using it in a path or a mux session name (§4.1.1a). A
 * sessionKey is an actorUserId (a UUID); reject anything carrying a path separator,
 * parent-dir traversal, or a NUL byte rather than silently joining a traversal.
 */
export function sanitizeSessionKey(sessionKey: string): string {
  if (
    sessionKey.length === 0 ||
    sessionKey.includes("/") ||
    sessionKey.includes("\\") ||
    sessionKey.includes("\0") ||
    sessionKey === "." ||
    sessionKey === ".." ||
    sessionKey.includes("..")
  ) {
    throw new Error("invalid sessionKey");
  }
  return sessionKey;
}

// ─── probeProvider (§4.8) — onboarding presence/auth check, no token, no replay ──

/** The status set mirrored on the wire (`RpcProbeProviderResult.status`). */
export type ProbeProviderStatus =
  | "ready"
  | "needs_login"
  | "not_installed"
  | "multiplexer_unavailable"
  | "error";

export interface ProbeProviderResult {
  readonly status: ProbeProviderStatus;
  readonly message?: string;
}

const PROBE_TIMEOUT_MS = 25_000;

/**
 * §4.8: a pure presence/auth check for a provider, run INSIDE cli-runner. Mirrors
 * the onboarding probe's auth logic (`claude auth status`, `codex login status`,
 * `agy --print`) but mints/injects NO MCP token and runs NO replay. It is a
 * non-session verb — it must never touch a per-session neutral dir or transcript.
 *
 * Presence is a PATH probe (the binary is on the tools volume); auth runs the
 * provider's status command. `multiplexer_unavailable` is surfaced when the bundled
 * tmux is not usable (a cli-runner-wide condition, §9.1). Any `message` is redacted.
 */
export async function probeProvider(
  provider: ProviderKind,
  deps: {
    readonly io: Pick<TmuxIo, "run">;
    /** Presence-only: is the provider binary on PATH inside cli-runner? */
    readonly cliPresent: (provider: ProviderKind) => Promise<boolean>;
    /** Is the bundled multiplexer usable? Defaults to "yes" (probe is auth-only). */
    readonly multiplexerUsable?: () => Promise<boolean>;
  }
): Promise<ProbeProviderResult> {
  if (deps.multiplexerUsable && !(await deps.multiplexerUsable())) {
    return { status: "multiplexer_unavailable" };
  }
  try {
    if (!(await deps.cliPresent(provider))) {
      return { status: "not_installed" };
    }
    switch (provider) {
      case "anthropic":
        return await probeClaudeAuth(deps.io);
      case "openai-compatible":
        return await probeCodexAuth(deps.io);
      case "google":
        return await probeGeminiAuth(deps.io);
    }
  } catch {
    return { status: "error" };
  }
}

async function probeClaudeAuth(io: Pick<TmuxIo, "run">): Promise<ProbeProviderResult> {
  const result = await probeWithTimeout(io.run("claude", ["auth", "status"]));
  if (result.code !== 0) {
    return isAuthOutput(`${result.stdout}\n${result.stderr ?? ""}`)
      ? { status: "needs_login" }
      : { status: "error" };
  }
  try {
    const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown };
    return parsed.loggedIn === true ? { status: "ready" } : { status: "needs_login" };
  } catch {
    return { status: "error" };
  }
}

async function probeCodexAuth(io: Pick<TmuxIo, "run">): Promise<ProbeProviderResult> {
  const result = await probeWithTimeout(io.run("codex", ["login", "status"]));
  const output = `${result.stdout}\n${result.stderr ?? ""}`;
  if (result.code === 0 && /\blogged in\b/i.test(output)) {
    return { status: "ready" };
  }
  return { status: "needs_login" };
}

async function probeGeminiAuth(io: Pick<TmuxIo, "run">): Promise<ProbeProviderResult> {
  const result = await probeWithTimeout(io.run("agy", ["--print", "Reply with exactly OK."]));
  if (result.code === 0 && result.stdout.trim().toUpperCase() === "OK") {
    return { status: "ready" };
  }
  return { status: "needs_login" };
}

function isAuthOutput(text: string): boolean {
  return /\b(auth|authentication|authorization|login|sign in)\b/i.test(text);
}

async function probeWithTimeout<T extends { code: number; stdout: string; stderr?: string }>(
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("provider probe timed out")), PROBE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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

function codexTranscriptMatchesCwd(jsonl: string, expectedCwd: string): boolean {
  for (const line of jsonl.split("\n").slice(0, 50)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record["type"] !== "session_meta") continue;
    const payload = record["payload"];
    if (!isRecord(payload)) continue;
    return payload["cwd"] === expectedCwd;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Minimal POSIX single-quote shell quoting for paths embedded in a send-keys line. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a sanitized cause for CliChatUnavailableError. The per-session MCP bearer token is
 * written to a 0600 file OFF the launch line (§6.2), but a backend error message could still
 * echo a token/secret from elsewhere, so as defense-in-depth return a fresh Error whose message
 * is run through `redactSecrets` and whose stack is dropped. Non-Error causes are stringified +
 * redacted.
 */
function redactCause(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const sanitized = new Error(redactSecrets(message));
  sanitized.name = err instanceof Error ? err.name : "Error";
  // Drop the original stack: it can carry the token-bearing launch line.
  sanitized.stack = undefined;
  return sanitized;
}
