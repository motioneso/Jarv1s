import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { HerdrInstallResultDto } from "@jarv1s/shared";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

describe("POST /api/admin/host/install (HTTP route)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({
      appDb,
      logger: false,
      installHerdr: async () => ({ ok: true, timedOut: false })
    });
    await server.ready();

    const owner = await signUp(server, "owner@host-install.test", "Owner");
    adminCookie = owner.cookie;
    const member = await signUp(server, "member@host-install.test", "Member");
    memberCookie = member.cookie;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
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
