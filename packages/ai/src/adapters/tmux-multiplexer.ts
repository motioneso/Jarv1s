/**
 * TmuxMultiplexer — the default Multiplexer backend. Reproduces the exact tmux
 * verb sequence the chat engine used inline before the seam was introduced, so it
 * is a behavior-preserving extraction. tmux session names are stable, so the
 * handle IS the session name (the `name` hint passed to open()).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";
import { redactSecrets } from "./redact.js";

export class TmuxMultiplexer implements Multiplexer {
  readonly kind = "tmux" as const;

  constructor(private readonly io: TmuxIo) {}

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const created = await this.io.run("tmux", [
      "new-session",
      "-d",
      "-s",
      opts.name,
      "-x",
      String(opts.cols),
      "-y",
      String(opts.rows)
    ]);
    if (created.code !== 0) {
      throw new Error(
        `TmuxMultiplexer.open: tmux new-session failed (code ${created.code}): ${redactSecrets(created.stderr)}`
      );
    }
    // From here the detached session exists; any failure must tear it down so a
    // half-launched session is never orphaned (the caller only stores the handle
    // on success, so it could never kill it otherwise).
    const sent = await this.io.run("tmux", [
      "send-keys",
      "-t",
      opts.name,
      opts.launchLine,
      "Enter"
    ]);
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
    const { code, stdout, stderr } = await this.io.run("tmux", [
      "capture-pane",
      "-p",
      "-t",
      handle
    ]);
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
      await this.io.run("tmux", ["delete-buffer", "-b", bufferName]);
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
    const { code, stderr } = await this.io.run("tmux", args);
    if (code !== 0) {
      throw new Error(
        `TmuxMultiplexer: \`tmux ${args[0]}\` failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("tmux", ["has-session", "-t", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    await this.io.run("tmux", ["kill-session", "-t", handle]);
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
    return `tmux attach -t ${handle}`;
  }
}
