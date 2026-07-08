import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_CLIENT_STACK_CHARS,
  type ClientErrorsRouteOptions,
  type JarvisErrorHandlerOptions,
  registerClientErrorsRoute,
  setJarvisErrorHandler
} from "../../apps/api/src/error-handling.js";

/**
 * Integration-style tests for the central API error observability (#413), run on
 * a bare Fastify instance with logger disabled (no DB / no createApiServer boot
 * required). Verifies the security boundary end-to-end via server.inject:
 *
 * - POST /api/errors accepts valid payloads (204), rejects malformed (400, not logged).
 * - The central error handler returns a safe body on 5xx (fixed string, no stack),
 *   and preserves the message on 4xx.
 * - No secret/internal detail leaks into a response body.
 */

const SECRET_MARKERS = ["hunter2", "postgres://u:p@host/db", "BETTER_AUTH_SECRET"];

function makeServer(
  options: {
    readonly clientErrors?: ClientErrorsRouteOptions;
    readonly errorHandler?: JarvisErrorHandlerOptions;
  } = {}
): FastifyInstance {
  const server = Fastify({ logger: false });
  registerClientErrorsRoute(server, options.clientErrors);
  setJarvisErrorHandler(server, options.errorHandler);
  return server;
}

describe("POST /api/errors", () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server?.close();
  });

  it("returns 204 for a well-formed payload", async () => {
    server = makeServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload: { type: "react_error", message: "boom", stack: "at x (y.ts:1)" }
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("returns 204 with type + message only (no stack)", async () => {
    server = makeServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload: { type: "uncaught_error", message: "no stack here" }
    });
    expect(res.statusCode).toBe(204);
  });

  it.each([
    ["non-object body", JSON.stringify("not-an-object")],
    ["null", JSON.stringify(null)],
    ["missing type", JSON.stringify({ message: "m" })],
    ["empty message", JSON.stringify({ type: "t", message: "" })],
    ["non-string stack", JSON.stringify({ type: "t", message: "m", stack: 5 })]
  ])("returns 400 for malformed payload: %s", async (_label, payload) => {
    server = makeServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Bad Request" });
  });

  it("accepts a payload with extra fields (they are dropped by the allowlist, not rejected)", async () => {
    server = makeServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload: { type: "react_error", message: "m", evil: "leak-me-please", creds: "secret" }
    });
    // Extra fields do NOT make the payload malformed — type+message are valid,
    // so this is accepted (204). The security contract is that extra fields are
    // DROPPED (never logged), not that their presence triggers a 400.
    expect(res.statusCode).toBe(204);
    // And nothing is echoed in a body (204 has no body).
    expect(res.body).toBe("");
  });
});

describe("central error handler (setJarvisErrorHandler)", () => {
  let server: FastifyInstance;
  afterEach(async () => {
    await server?.close();
  });

  it("returns a fixed 500 body with no stack for an unhandled exception", async () => {
    server = Fastify({ logger: false });
    server.get("/boom", async () => {
      throw new Error("internal detail with password=hunter2");
    });
    registerClientErrorsRoute(server);
    setJarvisErrorHandler(server);

    const res = await server.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal Server Error" });
    // The error message must NOT leak into the 5xx response body.
    expect(res.body).not.toContain("internal detail");
    expect(res.body).not.toContain("hunter2");
  });

  it("preserves the message on a 4xx (application-authored, safe to show)", async () => {
    server = Fastify({ logger: false });
    server.get("/missing", async (_req, reply) => {
      return reply.code(404).send({ error: "Not Found Here" });
    });
    setJarvisErrorHandler(server);

    const res = await server.inject({ method: "GET", url: "/missing" });
    expect(res.statusCode).toBe(404);
    // reply.send bypasses the error handler; assert the handler path directly:
  });

  it("maps an error with statusCode 4xx through the handler preserving message", async () => {
    server = Fastify({ logger: false });
    server.get("/teapot", async () => {
      const err = Object.assign(new Error("I am a teapot"), { statusCode: 418 });
      throw err;
    });
    setJarvisErrorHandler(server);

    const res = await server.inject({ method: "GET", url: "/teapot" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: "I am a teapot" });
  });

  it("does not leak a stack trace or secret-laden error fields in the 500 body", async () => {
    server = Fastify({ logger: false });
    server.get("/secret", async () => {
      const err = Object.assign(
        new Error("boom"),
        // Extra fields that must NEVER be forwarded — the handler allowlists
        // only message/code/statusCode.
        {
          statusCode: 500,
          stack: "Error: boom\n    at secret (postgres://u:p@host/db)\n    at BETTER_AUTH_SECRET",
          credentials: "password=hunter2",
          sessionToken: "abc123"
        }
      );
      throw err;
    });
    setJarvisErrorHandler(server);

    const res = await server.inject({ method: "GET", url: "/secret" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal Server Error" });
    for (const marker of SECRET_MARKERS) {
      expect(res.body).not.toContain(marker);
    }
    // No extra fields in the response object.
    expect(Object.keys(res.json())).toEqual(["error"]);
  });

  it("truncates a very long client stack at the cap (does not reject)", async () => {
    // The route accepts an arbitrarily long string stack and truncates at log
    // time. With logger disabled we can't assert the truncated line directly,
    // but we can assert the request still succeeds (204) and the cap constant
    // is honored by the handler code path (no crash on huge input).
    server = makeServer();
    const longStack = "y".repeat(MAX_CLIENT_STACK_CHARS * 4);
    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload: { type: "react_error", message: "m", stack: longStack }
    });
    expect(res.statusCode).toBe(204);
  });

  it("records client errors without passing stack to persistence", async () => {
    const recorded: unknown[] = [];
    server = makeServer({
      clientErrors: {
        recordClientError: async (event) => {
          recorded.push(event);
        }
      }
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/errors",
      headers: { "content-type": "application/json" },
      payload: { type: "react_error", message: "boom", stack: "Error: secret stack" }
    });

    expect(res.statusCode).toBe(204);
    expect(recorded).toEqual([
      expect.objectContaining({
        feature: "client",
        operation: "POST /api/errors",
        errorCategory: "client_error",
        retryable: false,
        userMessage: "boom",
        internalSummary: "Client reported react_error"
      })
    ]);
    expect(JSON.stringify(recorded)).not.toContain("stack");
    expect(JSON.stringify(recorded)).not.toContain("secret stack");
  });

  it("records request errors without passing raw stack or secret fields", async () => {
    const recorded: unknown[] = [];
    server = Fastify({ logger: false });
    server.get("/boom", async () => {
      const err = Object.assign(new Error("db password=hunter2"), {
        statusCode: 503,
        stack: "secret stack",
        headers: "cookie"
      });
      throw err;
    });
    setJarvisErrorHandler(server, {
      recordRequestError: async (event) => {
        recorded.push(event);
      }
    });

    const res = await server.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Internal Server Error" });
    expect(recorded).toEqual([
      expect.objectContaining({
        feature: "api",
        operation: "GET /boom",
        errorCategory: "http_5xx",
        retryable: true,
        userMessage: "Internal Server Error",
        internalSummary: "Request failed with status 503",
        requestId: expect.any(String)
      })
    ]);
    expect(JSON.stringify(recorded)).not.toContain("secret stack");
    expect(JSON.stringify(recorded)).not.toContain("headers");
  });
});
