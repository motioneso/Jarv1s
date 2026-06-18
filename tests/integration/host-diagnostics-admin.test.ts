import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { HostDiagnosticsDto } from "@jarv1s/shared";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

describe("GET /api/admin/host/diagnostics (HTTP route)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    // First sign-up bootstraps the instance owner (admin); the second is a plain member.
    const owner = await signUp(server, "owner@host-diag.test", "Owner");
    adminCookie = owner.cookie;
    const member = await signUp(server, "member@host-diag.test", "Member");
    memberCookie = member.cookie;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("admin GET returns safe structured diagnostics with a passing database check", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/host/diagnostics",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<HostDiagnosticsDto>();

    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.environment).toBe("string");
    expect(body.multiplexer).toBe("auto");
    expect(typeof body.available.tmux).toBe("boolean");
    expect(typeof body.moduleCount).toBe("number");

    const database = body.checks.find((c) => c.id === "database");
    expect(database?.status).toBe("pass");
    expect(body.checks.map((c) => c.id).sort()).toEqual(["database", "multiplexer", "pgboss"]);
  });

  it("never leaks secrets, connection URLs, or known secret env keys in the body", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/host/diagnostics",
      headers: { cookie: adminCookie }
    });
    const raw = res.body.toLowerCase();
    for (const needle of [
      "postgres://",
      "postgresql://",
      "database_url",
      "jarvis_connector_secret_key",
      "jarvis_ai_secret_key",
      "better_auth_secret",
      "password"
    ]) {
      expect(raw).not.toContain(needle);
    }
  });

  it("denies a non-admin GET with 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/host/diagnostics",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an unauthenticated GET with 401", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/host/diagnostics" });
    expect(res.statusCode).toBe(401);
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
