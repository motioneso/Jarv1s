/**
 * TmuxMultiplexer — the default Multiplexer backend. Reproduces the exact tmux
 * verb sequence the chat engine used inline before the seam was introduced, so it
 * is a behavior-preserving extraction. tmux session names are stable, so the
 * handle IS the session name (the `name` hint passed to open()).
 */
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";
import { redactSecrets } from "./redact.js";

export interface TmuxMultiplexerOpts {
  /**
   * The isolated sidecar's HOME base (`JARVIS_CLI_HOME_BASE`), used to derive a
   * private tmux socket so this instance never lands on the host's shared DEFAULT
   * tmux socket (#1142). A tmux server that is already running on the default
   * socket only forwards a small internal `update-environment` allowlist to new
   * sessions — never `HOME`/`JARVIS_CLI_HOME_BASE` — so a new session on a
   * long-lived shared server silently inherits that SERVER's original env instead
   * of this process's isolated override. Giving every distinct `homeBase` its own
   * socket guarantees the FIRST connection creates a brand-new server that
   * captures the launching process's actual env, and keeps concurrent sidecars
   * (different homeBase) from ever sharing a server. Undefined ⇒ a single stable
   * non-default socket (still never the shared default), preserving legacy
   * behavior for the one-tenant-per-process case that never set homeBase.
   */
  readonly homeBase?: string;
}

/**
 * Exported for tests. Deterministic and stable across restarts for the same
 * `homeBase` (sessions must survive a cli-runner restart and reattach to the
 * SAME tmux server) — never derived from anything process-lifetime-scoped like a
 * PID. Hashed (not embedded verbatim) so the socket path stays short and safe
 * regardless of how long/unusual `homeBase` is (AF_UNIX paths are ~108 bytes).
 */
export function resolveTmuxSocketPath(homeBase: string | undefined): string {
  const key = homeBase && homeBase.length > 0 ? homeBase : "jarv1s-tmux-default";
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(tmpdir(), `jarv1s-${digest}.tmux.sock`);
}

export class TmuxMultiplexer implements Multiplexer {
  readonly kind = "tmux" as const;

  /** Global `-S <path>` args, prepended to every tmux invocation (must precede the verb). */
  private readonly socketArgs: readonly string[];

  constructor(
    private readonly io: TmuxIo,
    opts: TmuxMultiplexerOpts = {}
  ) {
    this.socketArgs = ["-S", resolveTmuxSocketPath(opts.homeBase)];
  }

  /** Prepend the private-socket flag to a tmux verb's args (global flags precede the verb). */
  private withSocket(args: readonly string[]): string[] {
    return [...this.socketArgs, ...args];
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const created = await this.io.run(
      "tmux",
      this.withSocket([
        "new-session",
        "-d",
        "-s",
        opts.name,
        "-x",
        String(opts.cols),
        "-y",
        String(opts.rows)
      ])
    );
    if (created.code !== 0) {
      throw new Error(
        `TmuxMultiplexer.open: tmux new-session failed (code ${created.code}): ${redactSecrets(created.stderr)}`
      );
    }
    // From here the detached session exists; any failure must tear it down so a
    // half-launched session is never orphaned (the caller only stores the handle
    // on success, so it could never kill it otherwise).
    const sent = await this.io.run(
      "tmux",
      this.withSocket(["send-keys", "-t", opts.name, opts.launchLine, "Enter"])
    );
    if (sent.code !== 0) {
      await this.killQuietly(opts.name);
      throw new Error(
        `TmuxMultiplexer.open: tmux send-keys failed (code ${sent.code}): ${redactSecrets(sent.stderr)}`
      );
    }
    return opts.name;
  }

  async clearComposer(handle: MuxHandle): Promise<void> {
    await this.runChecked(["send-keys", "-t", handle, "C-u"]);
  }

  async capturePane(handle: MuxHandle): Promise<string> {
    const { code, stdout, stderr } = await this.io.run(
      "tmux",
      this.withSocket(["capture-pane", "-p", "-e", "-t", handle])
    );
    if (code !== 0) {
      throw new Error(
        `TmuxMultiplexer: \`tmux capture-pane\` failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
    return stdout;
  }

  async paste(handle: MuxHandle, text: string): Promise<void> {
    const promptFile = join(tmpdir(), `jarv1s-live-prompt-${handle}.txt`);
    const bufferName = handle;
    await this.io.writeFile(promptFile, text);
    try {
      await this.runChecked(["load-buffer", "-b", bufferName, promptFile]);
      await this.runChecked(["paste-buffer", "-b", bufferName, "-t", handle]);
    } finally {
      await this.io.run("tmux", this.withSocket(["delete-buffer", "-b", bufferName]));
      await this.io.run("rm", ["-f", promptFile]);
    }
  }

  async pressEnter(handle: MuxHandle): Promise<void> {
    await this.runChecked(["send-keys", "-t", handle, "Enter"]);
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    await this.paste(handle, text);
    await this.pressEnter(handle);
  }

  async interrupt(handle: MuxHandle): Promise<void> {
    await this.runChecked(["send-keys", "-t", handle, "Escape"]);
  }

  private async runChecked(args: readonly string[]): Promise<void> {
    const { code, stderr } = await this.io.run("tmux", this.withSocket(args));
    if (code !== 0) {
      throw new Error(
        `TmuxMultiplexer: \`tmux ${args[0]}\` failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("tmux", this.withSocket(["has-session", "-t", handle]));
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    await this.io.run("tmux", this.withSocket(["kill-session", "-t", handle]));
  }

  /** Best-effort cleanup during a failed open(); never masks the original error. */
  private async killQuietly(handle: MuxHandle): Promise<void> {
    try {
      await this.kill(handle);
    } catch {
      // ignore — the launch error is the one worth surfacing.
    }
  }

  attachCommand(handle: MuxHandle): string {
    return `tmux ${this.socketArgs.join(" ")} attach -t ${handle}`;
  }
}
