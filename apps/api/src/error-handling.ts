/**
 * Central observability for the API (#413):
 *
 * 1. `registerClientErrorsRoute` — `POST /api/errors`: a network-exposed sink the
 *    browser fires into from the global error/rejection hooks and the React
 *    ErrorBoundary. No auth (errors can happen before auth state is known), no
 *    storage — it only logs. The body is validated with a structural allowlist
 *    (see `parseClientErrorPayload`); malformed payloads return 400 and are NOT
 *    logged, so the endpoint cannot be turned into an attacker-controlled log
 *    channel.
 *
 * 2. `setJarvisErrorHandler` — the central Fastify error handler. Every unhandled
 *    route error is logged as a structured line and returned to the client with a
 *    safe body. On 5xx the body is the fixed string "Internal Server Error" (no
 *    stack, no internal message, no error-derived detail). On 4xx the error
 *    message is preserved (it is an application-authored, safe-to-show string).
 *
 * SECRETS-NEVER-ESCAPE INVARIANT (structural, not a denylist): both handlers
 * construct their log objects and response bodies from an explicit allowlist of
 * fields. They never spread the raw `error`, never log `request.body`,
 * `request.headers`, or `request.cookies`, and never forward a stack trace to
 * the client. Unknown error fields are simply never included.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Maximum characters of a client stack trace retained in a log line. Caps log
 * volume per error without losing the top frames (where the bug is).
 */
export const MAX_CLIENT_STACK_CHARS = 2000;

/** Maximum characters of a client `message` retained in a log line. */
const MAX_CLIENT_MESSAGE_CHARS = 500;

/** Maximum characters accepted for the client `type` discriminator. */
const MAX_CLIENT_TYPE_CHARS = 100;

/**
 * Normalized, validated client-error payload. Allowlist only — anything not on
 * this shape is dropped by the parser.
 */
export interface ClientErrorPayload {
  /** Discriminator, e.g. "react_error", "uncaught_error", "unhandled_promise_rejection". */
  readonly type: string;
  /** Short human message. */
  readonly message: string;
  /** Optional stack trace; truncated before logging. */
  readonly stack?: string;
}

export interface PersistableErrorEvent {
  readonly feature: string;
  readonly operation: string;
  readonly errorCategory: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly internalSummary: string;
  readonly requestId: string | null;
}

export interface ClientErrorsRouteOptions {
  readonly recordClientError?: (
    event: PersistableErrorEvent,
    request: FastifyRequest
  ) => Promise<void>;
}

export interface JarvisErrorHandlerOptions {
  readonly recordRequestError?: (
    event: PersistableErrorEvent,
    request: FastifyRequest
  ) => Promise<void>;
}

/**
 * Structural validator for the `/api/errors` request body. Returns the payload
 * if the body matches the allowlist shape within bounds, otherwise `null`. Never
 * throws — hostile/odd inputs degrade to `null` (→ 400), never to a crash.
 *
 * Allowlist enforcement: only `type`, `message`, and `stack` survive. Any other
 * field the client sends is dropped here, before logging.
 */
export function parseClientErrorPayload(body: unknown): ClientErrorPayload | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const raw = body as Record<string, unknown>;

  const type = raw.type;
  const message = raw.message;

  if (typeof type !== "string" || type.length === 0 || type.length > MAX_CLIENT_TYPE_CHARS) {
    return null;
  }
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > MAX_CLIENT_MESSAGE_CHARS
  ) {
    return null;
  }

  // Stack is optional. Read it defensively: a hostile/proxy body could throw on
  // property access (poisoned getter). The sink must never crash on a single
  // bad payload — degrade to "no stack" rather than throw.
  let stack: unknown;
  try {
    stack = raw.stack;
  } catch {
    return { type, message, stack: undefined };
  }
  if (stack !== undefined && typeof stack !== "string") {
    return null;
  }

  return { type, message, stack: typeof stack === "string" ? stack : undefined };
}

/**
 * Register the `POST /api/errors` sink. Must be called inside the server's
 * plugin/after() context so the route lands in the final route tree.
 */
export function registerClientErrorsRoute(
  server: FastifyInstance,
  options: ClientErrorsRouteOptions = {}
): void {
  server.post("/api/errors", async (request, reply) => {
    const payload = parseClientErrorPayload(request.body);

    if (payload === null) {
      // Malformed — 400. Do NOT log: this path is attacker-controlled (no auth,
      // network-exposed) and logging raw rejected bodies would be log-spam and a
      // potential exfil channel. The 400 goes through the central error handler,
      // which logs only the fact that a 400 occurred, not the rejected payload.
      return reply.code(400).send({ error: "Bad Request" });
    }

    // Structural allowlist: only type/message/stack, all bounded. No
    // request.headers / request.body / request.cookies / request.ip here.
    request.log.error(
      {
        clientError: {
          type: payload.type,
          message: payload.message.slice(0, MAX_CLIENT_MESSAGE_CHARS),
          stack: payload.stack?.slice(0, MAX_CLIENT_STACK_CHARS)
        }
      },
      "client error"
    );

    await options
      .recordClientError?.(
        {
          feature: "client",
          operation: "POST /api/errors",
          errorCategory: "client_error",
          retryable: false,
          userMessage: payload.message.slice(0, MAX_CLIENT_MESSAGE_CHARS),
          internalSummary: `Client reported ${payload.type}`,
          requestId: request.id
        },
        request
      )
      .catch((recordError) => {
        request.log.error(
          { err: String(recordError), reqId: request.id },
          "failed to persist client error"
        );
      });

    return reply.code(204).send();
  });
}

/**
 * Install the central Fastify error handler. Call once after routes are
 * registered. The handler is the single place every unhandled request error
 * flows through; it logs a structured line and returns a safe client response.
 */
export function setJarvisErrorHandler(
  server: FastifyInstance,
  options: JarvisErrorHandlerOptions = {}
): void {
  server.setErrorHandler(async (error: unknown, request, reply) => {
    // Narrow defensively. Fastify 5 types the handler error as `unknown`; a real
    // error here is virtually always an Error (often with statusCode/code), but
    // we never assume — extract each field with a guard so a non-Error throw
    // still produces a safe, structured log + response.
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    const statusCode =
      error !== null &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;

    // Structural allowlist: only message, code, statusCode. Never spread `error`
    // (stack may contain paths/secrets); never log request body/headers/cookies.
    request.log.error(
      {
        err: { message, code, statusCode },
        reqId: request.id
      },
      "request error"
    );

    // Safe response: 5xx returns a fixed string (no stack/internal detail); 4xx
    // returns the application-authored message (safe to show by construction).
    const clientMessage = statusCode < 500 ? message : "Internal Server Error";
    const operation = `${request.method} ${
      request.routeOptions.url ?? request.url.split("?")[0] ?? request.url
    }`;
    await options
      .recordRequestError?.(
        {
          feature: "api",
          operation,
          errorCategory: statusCode >= 500 ? "http_5xx" : "http_4xx",
          retryable: statusCode >= 500,
          userMessage: clientMessage,
          internalSummary: `Request failed with status ${statusCode}`,
          requestId: request.id
        },
        request
      )
      .catch((recordError) => {
        request.log.error(
          { err: String(recordError), reqId: request.id },
          "failed to persist request error"
        );
      });

    return reply.status(statusCode).send({ error: clientMessage });
  });
}
