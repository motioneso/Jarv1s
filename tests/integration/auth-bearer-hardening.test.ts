import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pg from "pg";

import { createJarvisAuthRuntime, type AuthLogger } from "@jarv1s/auth";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// Regression coverage for the OTNR-P2 #113 hardening of the legacy session-bearer auth
// path (any caller presenting a Better Auth session UUID as `Authorization: Bearer <id>`).
// The path is intentionally kept (it is the headless/CLI-bridge auth) but must now:
//   1. reject expired sessions server-side (expires_at enforced in migration 0046),
//   2. emit a structured observability event on every use — never logging the raw token,
//   3. be throttled per-principal by the global rate-limit class.
describe("Legacy session-bearer auth hardening (#113)", () => {
  describe("observability", () => {
    let appDb: Kysely<JarvisDatabase>;
    let events: Array<{ obj: Record<string, unknown>; msg: string }>;
    let runtime: ReturnType<typeof createJarvisAuthRuntime>;

    beforeAll(async () => {
      await resetFoundationDatabase();
      appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
      events = [];
      const logger: AuthLogger = {
        info: (obj, msg) => events.push({ obj, msg })
      };
      runtime = createJarvisAuthRuntime({
        appDb,
        runner: new DataContextRunner(appDb),
        logger
      });
    });

    afterAll(async () => {
      await runtime.close();
      await appDb.destroy();
    });

    it("emits a structured event on bearer auth without leaking the raw token", async () => {
      const ctx = await runtime.resolveAccessContext({
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(ctx.actorUserId).toBe(ids.userA);

      const event = events.find((e) => e.obj.event === "auth.bearer_session");
      expect(event).toBeDefined();
      expect(event!.obj.actorUserId).toBe(ids.userA);
      // Fingerprint is a 12-char SHA-256 prefix, never the raw session UUID.
      expect(event!.obj.tokenFingerprint).toMatch(/^[0-9a-f]{12}$/);
      // Hard invariant: session tokens must never reach logs.
      expect(JSON.stringify(event)).not.toContain(ids.sessionA);
    });

    it("emits no bearer event when no Authorization header is present", async () => {
      const before = events.filter((e) => e.obj.event === "auth.bearer_session").length;
      await expect(runtime.resolveAccessContext({ headers: {} })).rejects.toThrow();
      const after = events.filter((e) => e.obj.event === "auth.bearer_session").length;
      expect(after).toBe(before);
    });
  });

  describe("expires_at enforcement", () => {
    const expiredSessionId = "40000000-0000-4000-8000-0000000000ee";
    let server: ReturnType<typeof createApiServer>;
    let boss: PgBoss;

    beforeAll(async () => {
      await resetFoundationDatabase();
      // Insert a session whose expires_at is already in the past for user A.
      const client = new Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO app.auth_sessions (id, user_id, expires_at)
           VALUES ($1, $2, now() - interval '1 hour')`,
          [expiredSessionId, ids.userA]
        );
      } finally {
        await client.end();
      }

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
    });

    it("accepts a live session id as a bearer token", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/modules",
        headers: { authorization: `Bearer ${ids.sessionA}` }
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects an expired session id presented as a bearer token", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/modules",
        headers: { authorization: `Bearer ${expiredSessionId}` }
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("rate-limit class", () => {
    let server: ReturnType<typeof createApiServer>;
    let boss: PgBoss;
    let originalGlobalMax: string | undefined;

    beforeAll(async () => {
      originalGlobalMax = process.env.JARVIS_RL_GLOBAL_MAX;
      // Low threshold so the test needs only a few requests.
      process.env.JARVIS_RL_GLOBAL_MAX = "2";

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
      if (originalGlobalMax === undefined) {
        delete process.env.JARVIS_RL_GLOBAL_MAX;
      } else {
        process.env.JARVIS_RL_GLOBAL_MAX = originalGlobalMax;
      }
    });

    it("throttles a bearer-authed module route past the per-principal threshold", async () => {
      const inject = (sessionId: string) =>
        server.inject({
          method: "GET",
          url: "/api/modules",
          headers: { authorization: `Bearer ${sessionId}` }
        });

      const res1 = await inject(ids.sessionA);
      const res2 = await inject(ids.sessionA);
      const res3 = await inject(ids.sessionA);
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(res3.statusCode).toBe(429);

      // A different bearer token is a separate bucket — not affected by user A's burst.
      const other = await inject(ids.sessionB);
      expect(other.statusCode).toBe(200);
    });

    it("never throttles health probes", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await server.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
      }
    });

    it("does not mint a fresh bucket per non-UUID bearer token (Finding 2)", async () => {
      // Three DIFFERENT junk (non-UUID) tokens from one peer. Because junk tokens are not
      // UUID-shaped, they fall into the shared `ip:` bucket rather than one bucket each — so
      // an attacker cannot evade the per-principal class by varying a bogus token per request.
      const hit = (token: string) =>
        server.inject({
          method: "GET",
          url: "/api/modules",
          headers: { authorization: `Bearer ${token}` }
        });

      await hit("not-a-uuid-1");
      await hit("not-a-uuid-2");
      const third = await hit("not-a-uuid-3");
      expect(third.statusCode).toBe(429);
    });
  });

  // Finding 1 (BLOCKER): switching the global key to a per-principal key must NOT re-key the
  // inherited /api/auth/* credential throttle. Credential POSTs are pre-auth, so the throttle
  // must stay pinned to the peer IP — otherwise varying `Authorization: Bearer <junk>` mints a
  // fresh bucket per request and re-opens sign-in brute-force (OTNR-P4 #122 / C1).
  describe("credential brute-force throttle (#113 Finding 1)", () => {
    let server: ReturnType<typeof createApiServer>;
    let boss: PgBoss;
    let originalAuthMax: string | undefined;

    beforeAll(async () => {
      originalAuthMax = process.env.JARVIS_RL_AUTH_MAX;
      process.env.JARVIS_RL_AUTH_MAX = "2";

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
    });

    it("keys credential POSTs on peer IP — varying bogus auth headers cannot bypass it", async () => {
      const signIn = (n: number) =>
        server.inject({
          method: "POST",
          url: "/api/auth/sign-in/email",
          headers: {
            "content-type": "application/json",
            // A different *UUID-shaped* bogus bearer per request. This is deliberate: under the
            // global per-principal key these mint a distinct `bearer:` bucket each, so if the
            // auth route ever lost its explicit IP keyGenerator and inherited the global one,
            // each request would land in a fresh bucket and never 429 — and this test would
            // fail. Non-UUID junk would be routed to the shared `ip:` bucket by the global key's
            // UUID gate, masking that regression; UUID-shaped tokens make the test discriminating.
            authorization: `Bearer 40000000-0000-4000-8000-00000000000${n}`
          },
          payload: { email: "attacker@example.com", password: `guess-${n}` }
        });

      const r1 = await signIn(1);
      const r2 = await signIn(2);
      const r3 = await signIn(3);

      // The first two consume the IP bucket (max=2); the third is throttled regardless of the
      // varying Authorization header — proving the key is the peer IP, not the token.
      expect(r3.statusCode).toBe(429);
      expect([r1.statusCode, r2.statusCode]).not.toContain(429);
    });
  });

  // OTNR-P6 #128: a malformed Authorization header must produce a clean rejection (→ 401),
  // never a raw Postgres uuid-cast error (Fix 1) and never a thrown control-flow error for a
  // mere header-format failure (Fix 2). Both collapse to the same "Session is missing or
  // expired" rejection that the API layer maps to 401.
  describe("malformed / non-bearer Authorization (OTNR-P6 #128)", () => {
    let appDb: Kysely<JarvisDatabase>;
    let runtime: ReturnType<typeof createJarvisAuthRuntime>;

    beforeAll(async () => {
      await resetFoundationDatabase();
      appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
      runtime = createJarvisAuthRuntime({
        appDb,
        runner: new DataContextRunner(appDb)
      });
    });

    afterAll(async () => {
      await runtime.close();
      await appDb.destroy();
    });

    // Fix 1: a well-formed `Bearer <token>` whose token is not UUID-shaped reaches the
    // `::uuid` cast in AuthSessionResolver and (pre-fix) throws a raw Postgres 22P02 error.
    it("rejects a well-formed but non-UUID bearer token with a clean error (no raw DB cast error)", async () => {
      await expect(
        runtime.resolveAccessContext({ headers: { authorization: "Bearer not-a-uuid" } })
      ).rejects.toThrow("Session is missing or expired");
    });

    // Fix 2: readBearerToken is total — any header that is not a well-formed `Bearer <token>`
    // yields `undefined` (falls through to cookie auth → a single clean 401), never a thrown
    // control-flow error. Pre-fix these threw "Invalid bearer token" instead.
    it("treats a non-bearer scheme as no token (falls through to cookie auth → clean 401)", async () => {
      await expect(
        runtime.resolveAccessContext({ headers: { authorization: "Basic dXNlcjpwYXNz" } })
      ).rejects.toThrow("Session is missing or expired");
    });

    it("treats an empty bearer token as no token (falls through to cookie auth → clean 401)", async () => {
      await expect(
        runtime.resolveAccessContext({ headers: { authorization: "Bearer " } })
      ).rejects.toThrow("Session is missing or expired");
    });
  });
});
