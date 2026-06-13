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

export interface TmuxMultiplexerOpts {
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
}

export class TmuxMultiplexer implements Multiplexer {
  readonly kind = "tmux" as const;
  private readonly submitMs: number;

  constructor(
    private readonly io: TmuxIo,
    opts: TmuxMultiplexerOpts = {}
  ) {
    this.submitMs = opts.submitMs ?? 600;
  }

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
        `TmuxMultiplexer.open: tmux new-session failed (code ${created.code}): ${created.stderr ?? ""}`
      );
    }
    const sent = await this.io.run("tmux", [
      "send-keys",
      "-t",
      opts.name,
      opts.launchLine,
      "Enter"
    ]);
    if (sent.code !== 0) {
      throw new Error(
        `TmuxMultiplexer.open: tmux send-keys failed (code ${sent.code}): ${sent.stderr ?? ""}`
      );
    }
    return opts.name;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    const promptFile = join(tmpdir(), `jarv1s-live-prompt-${handle}.txt`);
    const bufferName = handle;
    await this.io.writeFile(promptFile, text);
    await this.runChecked(["load-buffer", "-b", bufferName, promptFile]);
    await this.runChecked(["paste-buffer", "-b", bufferName, "-t", handle]);
    await this.io.sleep(this.submitMs);
    await this.runChecked(["send-keys", "-t", handle, "Enter"]);
  }

  private async runChecked(args: readonly string[]): Promise<void> {
    const { code, stderr } = await this.io.run("tmux", args);
    if (code !== 0) {
      throw new Error(
        `TmuxMultiplexer: \`tmux ${args[0]}\` failed (code ${code}): ${stderr ?? ""}`
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

  attachCommand(handle: MuxHandle): string {
    return `tmux attach -t ${handle}`;
  }
}
