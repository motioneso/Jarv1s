import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@jarv1s/db";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

describe("Rate limiting", () => {
  let server: ReturnType<typeof createApiServer>;
  let originalAuthMax: string | undefined;
  let originalOauthMax: string | undefined;

  beforeAll(async () => {
    originalAuthMax = process.env.JARVIS_RL_AUTH_MAX;
    originalOauthMax = process.env.JARVIS_RL_OAUTH_MAX;
    // Low thresholds so tests don't need 10+ requests
    process.env.JARVIS_RL_AUTH_MAX = "2";
    process.env.JARVIS_RL_OAUTH_MAX = "2";

    await resetFoundationDatabase();
    server = createApiServer({
      appDb: createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 }),
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    if (originalAuthMax === undefined) {
      delete process.env.JARVIS_RL_AUTH_MAX;
    } else {
      process.env.JARVIS_RL_AUTH_MAX = originalAuthMax;
    }
    if (originalOauthMax === undefined) {
      delete process.env.JARVIS_RL_OAUTH_MAX;
    } else {
      process.env.JARVIS_RL_OAUTH_MAX = originalOauthMax;
    }
  });

  it("bursting POST /api/auth/sign-in/email past threshold returns 429", async () => {
    const payload = JSON.stringify({ email: "rl-test@example.test", password: "wrong" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload
    });
    expect(res3.statusCode).toBe(429);
  });

  it("POST /api/auth/sign-up/email is also throttled", async () => {
    const payload = JSON.stringify({ name: "RLTest", email: "rl-up@example.test", password: "x" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload
    });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /api/auth/get-session is NOT throttled (allowList skip)", async () => {
    const headers = { "x-forwarded-for": "10.0.0.3" };
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers
      });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it("bursting POST /api/connectors/google/complete past threshold returns 429", async () => {
    const payload = JSON.stringify({ redirectUrl: "https://example.test/cb?code=x" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.0.0.4" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload
    });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /health is not throttled", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });
});
