/**
 * HerdrMultiplexer — Multiplexer backend over the herdr terminal workspace
 * manager (`herdr pane …` socket API, v0.6.8). herdr emits JSON by default
 * (no --json flag): envelope { id, result, type }. Unlike tmux, herdr has no
 * "new detached session" verb: a pane is split from a root pane and the server
 * assigns an OPAQUE pane id. open() therefore returns that id as the handle; the
 * engine stores it and never reconstructs it (the Multiplexer asymmetry).
 * cols/rows and the `name` hint are tmux-specific and intentionally unused here —
 * herdr auto-sizes and assigns its own id.
 *
 * Root pane resolution (NO "first pane in `pane list`" default — that could split
 * from an unrelated operator/agent pane on a shared herdr server, Codex #4):
 *   opts.rootPane → env.JARVIS_HERDR_ROOT_PANE → env.HERDR_PANE_ID (the server's
 *   own pane, set by herdr when the API process runs inside a pane) → hard error.
 *
 * Every herdr command's exit code is checked; a non-zero exit throws (so a missing
 * binary via the JARVIS_MULTIPLEXER override, or a transient socket failure, fails
 * loudly instead of returning a dead handle — Codex #3/#5). kill() is the sole
 * exception: it ignores the exit code (idempotent per the Multiplexer contract).
 */
import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";

export interface HerdrMultiplexerOpts {
  /** Parent pane to split from; else JARVIS_HERDR_ROOT_PANE; else HERDR_PANE_ID. */
  readonly rootPane?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class HerdrMultiplexer implements Multiplexer {
  readonly kind = "herdr" as const;
  private readonly rootPaneOverride?: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly io: TmuxIo, opts: HerdrMultiplexerOpts = {}) {
    this.rootPaneOverride = opts.rootPane;
    this.env = opts.env ?? process.env;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const root = this.resolveRootPane();
    const split = await this.io.run("herdr", ["pane", "split", root, "--direction", "down", "--no-focus"]);
    if (split.code !== 0) {
      throw new Error(`HerdrMultiplexer.open: herdr pane split failed (code ${split.code}): ${split.stderr ?? ""}`);
    }
    const paneId = paneIdFromInfo(split.stdout);
    if (!paneId) {
      throw new Error("HerdrMultiplexer.open: could not parse pane_id from `herdr pane split` JSON");
    }
    // Launch symmetrically with tmux: type the launch line, then submit Enter.
    await this.runChecked(["pane", "send-text", paneId, opts.launchLine], "send-text");
    await this.runChecked(["pane", "send-keys", paneId, "Enter"], "send-keys");
    return paneId;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    await this.runChecked(["pane", "send-text", handle, text], "send-text");
    await this.runChecked(["pane", "send-keys", handle, "Enter"], "send-keys");
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("herdr", ["pane", "get", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    // Idempotent per the Multiplexer contract: closing an absent pane is not an error.
    await this.io.run("herdr", ["pane", "close", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    return `herdr   # then focus pane ${handle}`;
  }

  private resolveRootPane(): string {
    const root =
      this.rootPaneOverride?.trim() ||
      this.env.JARVIS_HERDR_ROOT_PANE?.trim() ||
      this.env.HERDR_PANE_ID?.trim();
    if (!root) {
      throw new Error(
        "HerdrMultiplexer: no root pane (set JARVIS_HERDR_ROOT_PANE, or run the API inside a herdr pane so HERDR_PANE_ID is set)"
      );
    }
    return root;
  }

  private async runChecked(args: readonly string[], label: string): Promise<void> {
    const { code, stderr } = await this.io.run("herdr", args);
    if (code !== 0) {
      throw new Error(`HerdrMultiplexer: herdr ${label} failed (code ${code}): ${stderr ?? ""}`);
    }
  }
}

interface HerdrEnvelope {
  result?: { pane?: { pane_id?: unknown } };
}

function parseHerdr(stdout: string): HerdrEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as HerdrEnvelope;
  } catch {
    throw new Error(`HerdrMultiplexer: expected JSON from herdr, got: ${trimmed.slice(0, 120)}`);
  }
}

/** `herdr pane split` → { result: { pane: { pane_id } }, type: "pane_info" }. */
function paneIdFromInfo(stdout: string): string | null {
  const id = parseHerdr(stdout)?.result?.pane?.pane_id;
  return typeof id === "string" && id ? id : null;
}
