/**
 * Multiplexer seam — the portable abstraction over the terminal multiplexer that
 * hosts a live CLI chat session. Two backends implement it: TmuxMultiplexer
 * (default) and HerdrMultiplexer. The chat engine depends on this interface, not
 * on tmux/herdr verbs, so a deployed instance can drive whichever multiplexer the
 * host provides (ADR 0008).
 *
 * KEY ASYMMETRY: tmux session names are caller-chosen and stable; herdr pane ids
 * are server-assigned and opaque. So `open()` RETURNS the handle the engine must
 * STORE and pass back to submit/isAlive/kill. Callers must never reconstruct an
 * address from the `name` hint.
 */

/** Opaque, backend-assigned session handle. Callers store it; never parse it. */
export type MuxHandle = string;

export interface MuxOpenOpts {
  /** A human-readable name hint. tmux uses it as the handle; herdr ignores it. */
  readonly name: string;
  /** Terminal width in columns. (tmux honors it; herdr auto-sizes and ignores it.) */
  readonly cols: number;
  /** Terminal height in rows. (tmux honors it; herdr auto-sizes and ignores it.) */
  readonly rows: number;
  /** The single shell line to run in the session (e.g. `cd <dir> && claude ...`). */
  readonly launchLine: string;
}

export interface Multiplexer {
  readonly kind: "tmux" | "herdr";
  /** Launch a detached session running `launchLine`; return the handle to store. */
  open(opts: MuxOpenOpts): Promise<MuxHandle>;
  /** Clear the current composer without submitting it. */
  clearComposer(handle: MuxHandle): Promise<void>;
  /** Capture the currently visible pane for positive readiness/ECHO observations. */
  capturePane(handle: MuxHandle): Promise<string>;
  /** Paste `text` without pressing Enter. */
  paste(handle: MuxHandle, text: string): Promise<void>;
  /** Press Enter exactly once when the caller has observed a correlated ECHO. */
  pressEnter(handle: MuxHandle): Promise<void>;
  /** Temporary compatibility composition; verified-submit callers use the primitives above. */
  submit(handle: MuxHandle, text: string): Promise<void>;
  /** Send Escape without terminating the session. */
  interrupt(handle: MuxHandle): Promise<void>;
  /** Is the session still running? */
  isAlive(handle: MuxHandle): Promise<boolean>;
  /** Terminate the session. Idempotent — killing an absent session is not an error. */
  kill(handle: MuxHandle): Promise<void>;
  /** Human-runnable shell command to attach for steering. Display-only; never executed by us. */
  attachCommand(handle: MuxHandle): string;
}
