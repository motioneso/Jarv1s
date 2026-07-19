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
  /**
   * Forcefully clear a MULTILINE composer. #1170: `clearComposer` sends C-u, which a live
   * claude 2.1.215 probe showed clears only the CURRENT line — earlier lines of a multiline
   * paste survive, so the composer can never be emptied and every subsequent turn fails its
   * pre-paste emptiness gate. The same probe showed a single Ctrl+C wipes the whole composer
   * without exiting the CLI. Callers must only invoke this when the composer is known to be
   * non-empty: on an EMPTY composer Ctrl+C arms the CLI's "press again to exit" state, and a
   * rapid second Ctrl+C would terminate the session.
   */
  clearComposerHard(handle: MuxHandle): Promise<void>;
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
