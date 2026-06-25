/**
 * Global browser error capture (#413).
 *
 * Wires `window.onerror` (uncaught exceptions) and `unhandledrejection` (uncaught
 * promise rejections) to reportClientError, which fire-and-forgets a POST to
 * /api/errors. The reporter NEVER throws: errors during error reporting are
 * swallowed to avoid an infinite reporting loop (a throw here would itself
 * trigger window.onerror → recurse).
 *
 * Registered once at app boot in main.tsx, before createRoot.
 */

/** Payload sent to /api/errors. Matches the server's ClientErrorPayload allowlist. */
export interface ClientErrorReport {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Report a client error to the API log. Fire-and-forget: returns a promise that
 * never rejects. Any failure (network down, server 500, malformed response) is
 * swallowed — the reporter must not throw, or it would re-trigger the global
 * error handler and recurse.
 *
 * Uses keepalive so the request survives page unload (a crash often unloads the
 * page before the request completes).
 */
export async function reportClientError(payload: ClientErrorReport): Promise<void> {
  try {
    await fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: payload.type,
        message: payload.message,
        stack: payload.stack
      }),
      keepalive: true
    });
  } catch {
    // Swallowed by design — see file doc. Logging this would risk recursion.
  }
}

let registered = false;

/**
 * Install the global window error/rejection listeners. Idempotent: calling more
 * than once is a no-op (React StrictMode double-invokes effects in dev; main.tsx
 * calls this once at module top level, but the guard is belt-and-suspenders).
 *
 * Each listener normalizes its event into a ClientErrorReport and fires the
 * reporter. The reporter's swallow-all contract means a listener body itself
 * never throws.
 */
export function registerGlobalErrorHandlers(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;

  window.addEventListener("error", (event) => {
    void reportClientError({
      type: "uncaught_error",
      message: event.message || "uncaught error",
      stack: event.error instanceof Error ? event.error.stack : undefined
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandled promise rejection";
    const stack = reason instanceof Error ? reason.stack : undefined;
    void reportClientError({ type: "unhandled_promise_rejection", message, stack });
  });
}

/** TEST-ONLY: reset the idempotency guard between tests. Not exported from the app. */
export function __resetGlobalErrorHandlersForTest(): void {
  registered = false;
}
