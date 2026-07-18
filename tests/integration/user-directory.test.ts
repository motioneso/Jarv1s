// tests/integration/user-directory.test.ts
//
// FIN-04 (#1149): GET /api/users/directory — the authenticated non-admin name
// surface household sharing needs. The contract under test is the privacy
// boundary, not just the happy path: active members' { id, name } ONLY (no
// emails, no admin flags, no timestamps), pending and deactivated users
// excluded, unauthenticated requests rejected.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { type Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { ListUserDirectoryResponse } from "@jarv1s/shared";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";
import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";

describe("user directory route (#1149)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let ownerId: string;
  let memberId: string;
  let memberCookie: string;
  let deactivatedId: string;
  let pendingId: string;

  async function signUp(opts: { name: string; email: string; password: string }) {
    return server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: opts
    });
  }

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, authRuntime, boss, logger: false });
    await server.ready();

    // Owner (bootstrap, active) + an active member — the two rows the
    // directory must return.
    const ownerRes = await signUp({
      name: "Owner User",
      email: "owner@example.test",
      password: "password12345"
    });
    ownerId = ownerRes.json<{ user: { id: string } }>().user.id;

    await setInstanceSetting("registration.requires_approval", { value: false });
    const memberRes = await signUp({
      name: "Member User",
      email: "member@example.test",
      password: "password12345"
    });
    memberId = memberRes.json<{ user: { id: string } }>().user.id;
    memberCookie = cookieHeader(memberRes.headers);

    // A deactivated user (signed up active, flipped via the bootstrap
    // superuser connection — test setup only) and a pending user.
    const deactivatedRes = await signUp({
      name: "Deactivated User",
      email: "deactivated@example.test",
      password: "password12345"
    });
    deactivatedId = deactivatedRes.json<{ user: { id: string } }>().user.id;
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    await client.query(
      `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
      [deactivatedId]
    );
    await client.end();

    await setInstanceSetting("registration.requires_approval", { value: true });
    const pendingRes = await signUp({
      name: "Pending User",
      email: "pending@example.test",
      password: "password12345"
    });
    pendingId = pendingRes.json<{ user: { id: string } }>().user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      authRuntime?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  it("returns active users' id and name only to a non-admin member", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/users/directory",
      headers: { cookie: memberCookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListUserDirectoryResponse>();
    const byId = new Map(body.users.map((user) => [user.id, user]));

    expect(byId.get(ownerId)).toEqual({ id: ownerId, name: "Owner User" });
    expect(byId.get(memberId)).toEqual({ id: memberId, name: "Member User" });
    expect(byId.has(deactivatedId)).toBe(false);
    expect(byId.has(pendingId)).toBe(false);
    expect(body.users).toHaveLength(2);
  });

  it("never serializes emails or account fields into the directory body", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/users/directory",
      headers: { cookie: memberCookie }
    });

    expect(response.statusCode).toBe(200);
    // Substring assertions on the raw serialized body — this is the redaction
    // proof, independent of what the parsed DTO type claims.
    expect(response.body).not.toContain("email");
    expect(response.body).not.toContain("@example.test");
    expect(response.body).not.toContain("isInstanceAdmin");
    expect(response.body).not.toContain("status");
    expect(response.body).not.toContain("createdAt");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/users/directory"
    });

    expect(response.statusCode).toBe(401);
  });
});

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];

  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
