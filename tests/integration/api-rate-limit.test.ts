import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

describe("Rate limiting", () => {
  let server: ReturnType<typeof createApiServer>;
  let boss: PgBoss;
  let originalAuthMax: string | undefined;
  let originalOauthMax: string | undefined;

  beforeAll(async () => {
    originalAuthMax = process.env.JARVIS_RL_AUTH_MAX;
    originalOauthMax = process.env.JARVIS_RL_OAUTH_MAX;
    // Low thresholds so tests don't need 10+ requests
    process.env.JARVIS_RL_AUTH_MAX = "2";
    process.env.JARVIS_RL_OAUTH_MAX = "2";

    await resetFoundationDatabase();
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({
      appDb: createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 }),
      boss,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    await boss?.stop({ graceful: false });
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
    const headers = { "content-type": "application/json" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload,
      remoteAddress: "10.0.0.1"
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload,
      remoteAddress: "10.0.0.1"
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers,
      payload,
      remoteAddress: "10.0.0.1"
    });
    expect(res3.statusCode).toBe(429);
  });

  it("POST /api/auth/sign-up/email is also throttled", async () => {
    const payload = JSON.stringify({ name: "RLTest", email: "rl-up@example.test", password: "x" });
    const headers = { "content-type": "application/json" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload,
      remoteAddress: "10.0.0.2"
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload,
      remoteAddress: "10.0.0.2"
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload,
      remoteAddress: "10.0.0.2"
    });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /api/auth/get-session is NOT throttled (allowList skip)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({
        method: "GET",
        url: "/api/auth/get-session",
        remoteAddress: "10.0.0.3"
      });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it("bursting POST /api/connectors/google/complete past threshold returns 429", async () => {
    const payload = JSON.stringify({ redirectUrl: "https://example.test/cb?code=x" });
    const headers = { "content-type": "application/json" };

    const res1 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload,
      remoteAddress: "10.0.0.4"
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload,
      remoteAddress: "10.0.0.4"
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({
      method: "POST",
      url: "/api/connectors/google/complete",
      headers,
      payload,
      remoteAddress: "10.0.0.4"
    });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /health is not throttled", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });

  // C1 regression: spoofing a different X-Forwarded-For on every request must NOT
  // prevent throttling. Before the fix the keyGenerator keyed on XFF, so each request
  // appeared to come from a fresh IP and the bucket never filled — 429 was never sent.
  // After the fix the key is the real peer IP (remoteAddress) and the bucket fills on
  // the third request regardless of what XFF the attacker sends.
  it("XFF-spoof per-request does NOT bypass throttle — keyed on real peer IP (C1 regression)", async () => {
    const payload = JSON.stringify({ email: "xff-bypass@example.test", password: "wrong" });
    const headers = { "content-type": "application/json" };
    // Same real peer IP on every request, but a different spoofed XFF header each time.
    const spoofedXffs = ["1.1.1.1", "2.2.2.2", "3.3.3.3"];

    const res1 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { ...headers, "x-forwarded-for": spoofedXffs[0] },
      payload,
      remoteAddress: "10.0.0.99"
    });
    const res2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { ...headers, "x-forwarded-for": spoofedXffs[1] },
      payload,
      remoteAddress: "10.0.0.99"
    });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    // Third request from the same real IP must be throttled even though the attacker
    // supplies yet another spoofed XFF header.
    const res3 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { ...headers, "x-forwarded-for": spoofedXffs[2] },
      payload,
      remoteAddress: "10.0.0.99"
    });
    expect(res3.statusCode).toBe(429);
  });
});
