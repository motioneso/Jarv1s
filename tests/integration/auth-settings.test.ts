import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ListAdminAuditEventsResponse, ListModulesResponse, MeResponse } from "@jarv1s/shared";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";
import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { SettingsRepository } from "../../packages/settings/src/repository.js";

describe("M3 auth, users, settings", () => {
  const authEnvKeys = [
    "JARVIS_AUTH_GOOGLE_CLIENT_ID",
    "JARVIS_AUTH_GOOGLE_CLIENT_SECRET",
    "JARVIS_AUTH_OIDC_PROVIDER_ID",
    "JARVIS_AUTH_OIDC_DISPLAY_NAME",
    "JARVIS_AUTH_OIDC_CLIENT_ID",
    "JARVIS_AUTH_OIDC_CLIENT_SECRET",
    "JARVIS_AUTH_OIDC_DISCOVERY_URL"
  ] as const;
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let originalAuthEnv: Record<(typeof authEnvKeys)[number], string | undefined>;
  let ownerCookie: string;
  let memberCookie: string;
  let ownerUserId: string;
  let memberUserId: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    originalAuthEnv = readOriginalAuthEnv(authEnvKeys);
    process.env.JARVIS_AUTH_GOOGLE_CLIENT_ID = "google-client";
    process.env.JARVIS_AUTH_GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.JARVIS_AUTH_OIDC_PROVIDER_ID = "acme";
    process.env.JARVIS_AUTH_OIDC_DISPLAY_NAME = "Acme OIDC";
    process.env.JARVIS_AUTH_OIDC_CLIENT_ID = "acme-client";
    process.env.JARVIS_AUTH_OIDC_CLIENT_SECRET = "acme-secret";
    process.env.JARVIS_AUTH_OIDC_DISCOVERY_URL =
      "https://idp.example.test/.well-known/openid-configuration";

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    // Disable requires_approval so subsequently-registered users in M3 tests get active status.
    // (Phase 2 Slice A approval-flow tests run in their own describe with a fresh DB per test.)
    await appDb
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.requires_approval")
      .execute();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    restoreAuthEnv(originalAuthEnv);
  });

  it("bootstraps the first Better Auth user as instance owner", async () => {
    const initialStatus = await server.inject({
      method: "GET",
      url: "/api/bootstrap/status"
    });
    const signUpResponse = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        name: "Owner User",
        email: "owner@example.test",
        password: "correct horse battery staple"
      }
    });
    const bootstrappedStatus = await server.inject({
      method: "GET",
      url: "/api/bootstrap/status"
    });

    ownerCookie = cookieHeader(signUpResponse.headers);
    ownerUserId = signUpResponse.json<{ user: { id: string } }>().user.id;

    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json()).toEqual({ needsBootstrap: true, userCount: 0 });
    expect(signUpResponse.statusCode).toBe(200);
    expect(ownerCookie).toContain("better-auth");
    expect(bootstrappedStatus.json()).toEqual({ needsBootstrap: false, userCount: 1 });

    const meResponse = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: ownerCookie
      }
    });
    const me = meResponse.json<MeResponse>();

    expect(meResponse.statusCode).toBe(200);
    expect(me.user).toMatchObject({
      id: ownerUserId,
      email: "owner@example.test",
      isInstanceAdmin: true
    });
  });

  it("exposes configured auth provider status without secrets", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/admin/auth/providers",
      headers: {
        cookie: ownerCookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers: [
        {
          id: "email-password",
          displayName: "Email and password",
          providerType: "local",
          enabled: true
        },
        {
          id: "google",
          displayName: "Google",
          providerType: "oauth",
          enabled: true
        },
        {
          id: "github",
          displayName: "GitHub",
          providerType: "oauth",
          enabled: false
        },
        {
          id: "microsoft",
          displayName: "Microsoft",
          providerType: "oauth",
          enabled: false
        },
        {
          id: "acme",
          displayName: "Acme OIDC",
          providerType: "oidc",
          enabled: true
        }
      ]
    });
    expect(response.body).not.toContain("google-secret");
    expect(response.body).not.toContain("acme-secret");
  });

  it("exposes session-gated module metadata for the app shell", async () => {
    const deniedResponse = await server.inject({
      method: "GET",
      url: "/api/modules"
    });
    const allowedResponse = await server.inject({
      method: "GET",
      url: "/api/modules",
      headers: {
        cookie: ownerCookie
      }
    });
    const modules = allowedResponse.json<ListModulesResponse>().modules;

    expect(deniedResponse.statusCode).toBe(401);
    expect(allowedResponse.statusCode).toBe(200);
    expect(modules.map((module) => module.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "structured-state"
    ]);
    expect(modules.flatMap((module) => module.navigation).map((entry) => entry.path)).toEqual([
      "/settings",
      "/tasks",
      "/notifications",
      "/calendar",
      "/email",
      "/chat",
      "/briefings"
    ]);
  });

  it("keeps later users non-admin and protects admin APIs", async () => {
    const signUpResponse = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        name: "Member User",
        email: "member@example.test",
        password: "correct horse battery staple"
      }
    });

    memberCookie = cookieHeader(signUpResponse.headers);
    memberUserId = signUpResponse.json<{ user: { id: string } }>().user.id;

    const deniedResponse = await server.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: {
        cookie: memberCookie
      }
    });
    const allowedResponse = await server.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: {
        cookie: ownerCookie
      }
    });

    expect(signUpResponse.statusCode).toBe(200);
    expect(deniedResponse.statusCode).toBe(403);
    expect(allowedResponse.statusCode).toBe(200);
    expect(
      allowedResponse
        .json<{ users: Array<{ email: string; isInstanceAdmin: boolean }> }>()
        .users.map((user) => [user.email, user.isInstanceAdmin])
    ).toEqual([
      ["owner@example.test", true],
      ["member@example.test", false]
    ]);
  });

  it("lets admins patch instance settings", async () => {
    const settingResponse = await server.inject({
      method: "PATCH",
      url: "/api/admin/settings/provider-policy",
      headers: {
        cookie: ownerCookie
      },
      payload: {
        value: {
          maxDataClass: "private"
        }
      }
    });

    expect(settingResponse.statusCode).toBe(200);
    expect(settingResponse.json()).toMatchObject({
      setting: {
        key: "provider-policy",
        value: {
          maxDataClass: "private"
        },
        updatedByUserId: ownerUserId
      }
    });
  });

  it("records audit events for bootstrap and settings actions", async () => {
    const auditResponse = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: {
        cookie: ownerCookie
      }
    });
    const auditActions = auditResponse
      .json<ListAdminAuditEventsResponse>()
      .auditEvents.map((event) => event.action);

    expect(auditResponse.statusCode).toBe(200);
    expect(auditActions).toEqual(
      expect.arrayContaining(["bootstrap.instance_owner", "instance_setting.upsert"])
    );
    expect(auditActions).not.toContain("workspace.create");
    expect(auditActions).not.toContain("resource_grant.upsert");
  });
});

describe("multi-user registration + lifecycle (Phase 2 Slice A)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;

  async function signUp(opts: { name: string; email: string; password: string }) {
    return server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: opts
    });
  }

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await Promise.allSettled([server?.close(), authRuntime?.close(), appDb?.destroy()]);
  });

  it("rejects sign-up with 403 when registration.enabled is false (seeded directly)", async () => {
    await signUp({ name: "Admin", email: "admin@example.com", password: "password12345" });
    await appDb
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.enabled")
      .execute();

    const blocked = await signUp({
      name: "Late",
      email: "late@example.com",
      password: "password12345"
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ code?: string }>().code).toBe("registration_disabled");
  });

  it("marks the first sign-up as bootstrap owner with active status", async () => {
    const signUpRes = await signUp({
      name: "First",
      email: "first@example.com",
      password: "password12345"
    });
    expect(signUpRes.statusCode).toBe(200);

    const cookie = cookieHeader(signUpRes.headers);
    const meRes = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(meRes.statusCode).toBe(200);
    expect(meRes.json<MeResponse>().user).toMatchObject({
      isBootstrapOwner: true,
      status: "active"
    });
  });

  it("marks subsequent sign-up as pending when requires_approval is true", async () => {
    await signUp({ name: "Owner", email: "owner@example.com", password: "password12345" });

    const joinRes = await signUp({
      name: "Joiner",
      email: "joiner@example.com",
      password: "password12345"
    });
    expect(joinRes.statusCode).toBe(200);
    const userId = joinRes.json<{ user: { id: string } }>().user.id;

    // Query via SECURITY DEFINER function (jarvis_auth_runtime USING(true)) so this
    // stays valid after Task 5 enforcement blocks pending users from /api/me.
    const rows = await sql<{
      is_bootstrap_owner: boolean;
      status: string;
    }>`SELECT is_bootstrap_owner, status FROM app.get_user_by_id(${userId}::uuid)`.execute(appDb);

    expect(rows.rows[0]).toMatchObject({ is_bootstrap_owner: false, status: "pending" });
  });

  it("blocks pending user from authenticated endpoint with 403 account_pending_approval", async () => {
    await signUp({ name: "Owner", email: "owner@example.com", password: "password12345" });

    const joinRes = await signUp({
      name: "Joiner",
      email: "joiner@example.com",
      password: "password12345"
    });
    expect(joinRes.statusCode).toBe(200);

    const meRes = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(joinRes.headers) }
    });

    expect(meRes.statusCode).toBe(403);
    expect(meRes.json<{ code?: string }>().code).toBe("account_pending_approval");
  });

  it("blocks deactivated user from authenticated endpoint with 403 account_deactivated", async () => {
    await signUp({ name: "Owner", email: "owner@example.com", password: "password12345" });

    // Disable requires_approval so the second user is created with active status.
    await appDb
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.requires_approval")
      .execute();

    const joinRes = await signUp({
      name: "Joiner",
      email: "joiner@example.com",
      password: "password12345"
    });
    expect(joinRes.statusCode).toBe(200);
    const joinerId = joinRes.json<{ user: { id: string } }>().user.id;

    // Deactivate the joiner using the bootstrap (superuser) connection to bypass RLS.
    // This is test setup only — the bootstrap role is the postgres superuser used
    // exclusively in tests/infra scripts to seed state that normal roles cannot write.
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    await client.query(
      `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
      [joinerId]
    );
    await client.end();

    const meRes = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(joinRes.headers) }
    });

    expect(meRes.statusCode).toBe(403);
    expect(meRes.json<{ code?: string }>().code).toBe("account_deactivated");
  });

  it("revokeUserSessions deletes all of a user's sessions", async () => {
    const member = await signUp({
      name: "Member",
      email: "member@example.com",
      password: "password12345"
    });
    const memberId = member.json<{ user: { id: string } }>().user.id;

    // Sign-up creates a session; first call should delete at least 1.
    const deleted = await authRuntime.revokeUserSessions(memberId);
    expect(deleted).toBeGreaterThan(0);

    // Second call finds nothing left — idempotent/safe.
    const remaining = await authRuntime.revokeUserSessions(memberId);
    expect(remaining).toBe(0);
  });

  it("admin approves a pending user, who can then access /api/me", async () => {
    const admin = await signUp({
      name: "Admin",
      email: "admin@example.com",
      password: "password12345"
    });
    const adminCookie = cookieHeader(admin.headers);
    const member = await signUp({
      name: "Member",
      email: "member@example.com",
      password: "password12345"
    });
    const memberId = member.json<{ user: { id: string } }>().user.id;
    const memberCookie = cookieHeader(member.headers);

    const approve = await server.inject({
      method: "POST",
      url: `/api/admin/users/${memberId}/approve`,
      headers: { cookie: adminCookie }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json<{ user: { status: string } }>().user.status).toBe("active");

    const me = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: memberCookie }
    });
    expect(me.statusCode).toBe(200);
  });

  it("non-admin cannot call lifecycle routes (403)", async () => {
    const admin = await signUp({
      name: "Admin",
      email: "admin@example.com",
      password: "password12345"
    });
    const adminId = admin.json<{ user: { id: string } }>().user.id;
    const member = await signUp({
      name: "Member",
      email: "member@example.com",
      password: "password12345"
    });
    const memberId = member.json<{ user: { id: string } }>().user.id;
    const adminCookie = cookieHeader(admin.headers);
    // Approve member so they have an active session for subsequent calls.
    await server.inject({
      method: "POST",
      url: `/api/admin/users/${memberId}/approve`,
      headers: { cookie: adminCookie }
    });
    // Re-sign-in as member to get a fresh active session cookie.
    const memberSignIn = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json" },
      payload: { email: "member@example.com", password: "password12345" }
    });
    const memberCookie = cookieHeader(memberSignIn.headers);
    const res = await server.inject({
      method: "POST",
      url: `/api/admin/users/${adminId}/demote`,
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });

  it("repository blocks demoting the last active admin", async () => {
    // Owner is bootstrap_owner; member is promoted to admin via bootstrap, then
    // owner is deactivated via bootstrap — leaving member as the last active admin.
    const ownerRes = await signUp({
      name: "Owner",
      email: "owner@example.com",
      password: "password12345"
    });
    const ownerId = ownerRes.json<{ user: { id: string } }>().user.id;

    await appDb
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.requires_approval")
      .execute();
    const memberRes = await signUp({
      name: "Member",
      email: "member@example.com",
      password: "password12345"
    });
    const memberId = memberRes.json<{ user: { id: string } }>().user.id;

    // Use bootstrap (superuser) to promote member to admin and deactivate owner.
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    await client.query(
      `UPDATE app.users SET is_instance_admin = true, updated_at = now() WHERE id = $1`,
      [memberId]
    );
    await client.query(
      `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
      [ownerId]
    );
    await client.end();

    const repo = new SettingsRepository(appDb);
    await expect(
      repo.setUserAdmin({
        targetUserId: memberId,
        isInstanceAdmin: false,
        actorUserId: memberId,
        requestId: "r1"
      })
    ).rejects.toThrow(/last.*admin/i);
  });
});

describe("users_guard_admin_flag trigger (#97)", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES
           ($1, 'trigger-non-admin@test.test', 'Non Admin', false),
           ($2, 'trigger-admin@test.test',     'Admin',     true)`,
        [ids.userA, ids.adminUser]
      );
    } finally {
      await seed.end();
    }
  });

  it("rejects non-admin self-escalation of is_instance_admin", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      await expect(
        client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA])
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows an active admin to change is_instance_admin on another user", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.adminUser}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = false WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows non-admin to update safe columns on their own row", async () => {
    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET name = 'Updated Name' WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

describe("users_guard_admin_flag bootstrap exemption (#97)", () => {
  it("allows non-admin self-promotion when no admins exist (single user)", async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES ($1, 'bootstrap-only@test.test', 'Bootstrap', false)`,
        [ids.userA]
      );
    } finally {
      await seed.end();
    }

    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = true WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("allows non-admin self-promotion when multiple non-admin users exist but no admins", async () => {
    await resetEmptyFoundationDatabase();
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `INSERT INTO app.users (id, email, name, is_instance_admin)
         VALUES
           ($1, 'no-admin-a@test.test', 'No Admin A', false),
           ($2, 'no-admin-b@test.test', 'No Admin B', false)`,
        [ids.userA, ids.userB]
      );
    } finally {
      await seed.end();
    }

    const client = new pg.Client({ connectionString: connectionStrings.app });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.actor_user_id = '${ids.userA}'`);
      const result = await client.query(
        `UPDATE app.users SET is_instance_admin = true WHERE id = $1`,
        [ids.userA]
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
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

function readOriginalAuthEnv<const TKeys extends readonly string[]>(
  keys: TKeys
): Record<TKeys[number], string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<
    TKeys[number],
    string | undefined
  >;
}

function restoreAuthEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}
