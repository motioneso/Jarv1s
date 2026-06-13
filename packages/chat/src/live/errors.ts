/**
 * Thrown when a live CLI session cannot be hosted: no terminal multiplexer
 * (tmux/herdr) is available/configured, OR the chosen multiplexer failed to launch
 * the session. Both map to HTTP 503. `cause` carries the underlying error for
 * server-side logging; the message is operator-safe (no secrets/stderr leakage).
 */
export class CliChatUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliChatUnavailableError";
  }
}
