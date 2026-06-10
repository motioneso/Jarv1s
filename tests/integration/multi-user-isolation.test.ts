import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import pg from "pg";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

describe("multi-user isolation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;

  async function signUp(name: string, email: string) {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name, email, password: "password12345" }
    });
    return {
      id: res.json<{ user: { id: string } }>().user.id,
      cookie: cookieHeader(res.headers)
    };
  }

  async function signIn(email: string) {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json" },
      payload: { email, password: "password12345" }
    });
    return cookieHeader(res.headers);
  }

  async function disableApproval() {
    await appDb
      .updateTable("app.instance_settings")
      .set({ value: { value: false }, updated_at: new Date() })
      .where("key", "=", "registration.requires_approval")
      .execute();
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

  it("a member cannot read another member's private task", async () => {
    const admin = await signUp("Admin", "admin@example.com");
    void admin;
    await disableApproval();

    const alice = await signUp("Alice", "alice@example.com");
    const bob = await signUp("Bob", "bob@example.com");

    const created = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      payload: { title: "Alice private task" }
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json<{ task: { id: string } }>().task.id;

    const bobRead = await server.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: bob.cookie }
    });
    expect(bobRead.statusCode).toBe(404);
  });

  it("an instance admin CANNOT read a member's private task (no admin bypass of RLS)", async () => {
    const admin = await signUp("Admin", "admin@example.com");
    await disableApproval();
    const alice = await signUp("Alice", "alice@example.com");

    const created = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      payload: { title: "Alice private task" }
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json<{ task: { id: string } }>().task.id;

    const adminRead = await server.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: admin.cookie }
    });
    expect(adminRead.statusCode).toBe(404);

    // Grant self read access via resource-grants — the admin cannot bootstrap their own access.
    await server.inject({
      method: "POST",
      url: "/api/admin/resource-grants",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      payload: {
        resourceType: "task",
        resourceId: taskId,
        granteeUserId: admin.id,
        grantLevel: "view"
      }
    });

    const adminReadAfterGrant = await server.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: admin.cookie }
    });
    // A resource grant from the admin does NOT grant access to Alice's private task —
    // only Alice can share her own data.
    expect(adminReadAfterGrant.statusCode).toBe(404);
  });

  it("app_runtime cannot read another user's auth_accounts rows (FORCE RLS isolation)", async () => {
    await disableApproval();
    const alice = await signUp("Alice", "alice@example.com");

    // appDb runs as jarvis_app_runtime. Migration 0045 revoked its SELECT on auth_accounts +
    // better_auth_sessions entirely (FORCE RLS tables). A direct query must throw permission denied.
    await expect(
      appDb.selectFrom("app.auth_accounts").selectAll().where("user_id", "=", alice.id).execute()
    ).rejects.toThrow();
  });

  it("lifecycle: pending blocked → approved active → deactivated blocked + sessions revoked → reactivated active", async () => {
    const admin = await signUp("Admin", "admin@example.com");
    const member = await signUp("Member", "member@example.com"); // pending (approval on by default)

    // Pending → 403.
    expect(
      (await server.inject({ method: "GET", url: "/api/me", headers: { cookie: member.cookie } }))
        .statusCode
    ).toBe(403);

    // Approve → active.
    const approve = await server.inject({
      method: "POST",
      url: `/api/admin/users/${member.id}/approve`,
      headers: { cookie: admin.cookie }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json<{ user: { status: string } }>().user.status).toBe("active");

    // Fresh sign-in to get an active session.
    const activeCookie = await signIn("member@example.com");
    expect(
      (await server.inject({ method: "GET", url: "/api/me", headers: { cookie: activeCookie } }))
        .statusCode
    ).toBe(200);

    // Deactivate → sessions revoked + blocked.
    const deactivate = await server.inject({
      method: "POST",
      url: `/api/admin/users/${member.id}/deactivate`,
      headers: { cookie: admin.cookie }
    });
    expect(deactivate.statusCode).toBe(200);
    // Route revokes sessions; a second call should return 0.
    const remaining = await authRuntime.revokeUserSessions(member.id);
    expect(remaining).toBe(0);
    // Sessions are gone — old cookie returns 401 (unauthenticated), not 403.
    expect(
      (await server.inject({ method: "GET", url: "/api/me", headers: { cookie: activeCookie } }))
        .statusCode
    ).toBe(401);

    // Reactivate → active again.
    const reactivate = await server.inject({
      method: "POST",
      url: `/api/admin/users/${member.id}/reactivate`,
      headers: { cookie: admin.cookie }
    });
    expect(reactivate.statusCode).toBe(200);
    const freshCookie = await signIn("member@example.com");
    expect(
      (await server.inject({ method: "GET", url: "/api/me", headers: { cookie: freshCookie } }))
        .statusCode
    ).toBe(200);
  });

  it("guardrails: cannot demote or deactivate the last admin or the bootstrap owner", async () => {
    const admin = await signUp("Admin", "admin@example.com"); // bootstrap owner + only admin

    // Demote self (only admin) → 409.
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/api/admin/users/${admin.id}/demote`,
          headers: { cookie: admin.cookie }
        })
      ).statusCode
    ).toBe(409);

    // Deactivate self → 409 (bootstrap owner check fires before self-lockout check).
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/api/admin/users/${admin.id}/deactivate`,
          headers: { cookie: admin.cookie }
        })
      ).statusCode
    ).toBe(409);

    // Seed a second admin via bootstrap (superuser), then deactivate original admin via bootstrap —
    // now second admin is the last active admin. Demoting the last active admin should still 409.
    await disableApproval();
    const second = await signUp("Second", "second@example.com");

    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    await client.query(
      `UPDATE app.users SET is_instance_admin = true, updated_at = now() WHERE id = $1`,
      [second.id]
    );
    await client.query(
      `UPDATE app.users SET status = 'deactivated', updated_at = now() WHERE id = $1`,
      [admin.id]
    );
    await client.end();

    const secondCookie = await signIn("second@example.com");
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/api/admin/users/${second.id}/demote`,
          headers: { cookie: secondCookie }
        })
      ).statusCode
    ).toBe(409);
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
