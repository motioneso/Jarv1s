import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { HerdrInstallResultDto } from "@jarv1s/shared";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

describe("POST /api/admin/host/install (HTTP route)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let appWithFailingInstaller: ReturnType<typeof createApiServer>;
  let appWithTimingOutInstaller: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected. All three servers
    // share the same appDb, so one boss instance is threaded into each and stopped once below.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({
      appDb,
      boss,
      logger: false,
      installHerdr: async () => ({ ok: true, timedOut: false })
    });
    await server.ready();

    appWithFailingInstaller = createApiServer({
      appDb,
      boss,
      logger: false,
      installHerdr: async () => ({ ok: false, timedOut: false })
    });
    await appWithFailingInstaller.ready();

    appWithTimingOutInstaller = createApiServer({
      appDb,
      boss,
      logger: false,
      installHerdr: async () => ({ ok: false, timedOut: true })
    });
    await appWithTimingOutInstaller.ready();

    const owner = await signUp(server, "owner@host-install.test", "Owner");
    adminCookie = owner.cookie;
    const member = await signUp(server, "member@host-install.test", "Member");
    memberCookie = member.cookie;
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appWithFailingInstaller?.close(),
      appWithTimingOutInstaller?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  it("denies a non-admin POST with 403", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/host/install",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an unauthenticated POST with 401", async () => {
    const res = await server.inject({ method: "POST", url: "/api/admin/host/install" });
    expect(res.statusCode).toBe(401);
  });

  it("admin POST installs, writes exactly one audit event for concurrent calls, and returns a safe body", async () => {
    const [resA, resB] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/api/admin/host/install",
        headers: { cookie: adminCookie }
      }),
      server.inject({
        method: "POST",
        url: "/api/admin/host/install",
        headers: { cookie: adminCookie }
      })
    ]);

    for (const res of [resA, resB]) {
      expect(res.statusCode).toBe(200);
      const body = res.json<HerdrInstallResultDto>();
      expect(body.state).toBe("installed");
      expect(typeof body.herdrInstalled).toBe("boolean");
    }

    const auditRes = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: adminCookie }
    });
    expect(auditRes.statusCode).toBe(200);
    const installEvents = auditRes
      .json<{ auditEvents: Array<{ action: string }> }>()
      .auditEvents.filter((e) => e.action === "host.herdr_install");
    expect(installEvents).toHaveLength(2);
  });

  it("writes a failure audit event and returns a structured (non-raw) error when the installer fails", async () => {
    const res = await appWithFailingInstaller.inject({
      method: "POST",
      url: "/api/admin/host/install",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<HerdrInstallResultDto>();
    expect(body.state).toBe("failed");
    expect(JSON.stringify(body)).not.toMatch(/stdout|stderr|Error:/i);
  });

  it("returns state=timeout when the installer times out", async () => {
    const res = await appWithTimingOutInstaller.inject({
      method: "POST",
      url: "/api/admin/host/install",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<HerdrInstallResultDto>();
    expect(body.state).toBe("timeout");
    expect(JSON.stringify(body)).not.toMatch(/stdout|stderr|Error:/i);
  });
});

async function signUp(
  server: ReturnType<typeof createApiServer>,
  email: string,
  name: string
): Promise<{ cookie: string; userId: string }> {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up for ${email} failed (${res.statusCode}): ${res.body}`);
  }
  return {
    cookie: cookieHeader(res.headers),
    userId: res.json<{ user: { id: string } }>().user.id
  };
}

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
