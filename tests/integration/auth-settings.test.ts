import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ListAdminAuditEventsResponse, ListModulesResponse, MeResponse } from "@jarv1s/shared";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

describe("M3 auth, users, workspaces, settings", () => {
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
  let createdWorkspaceId: string;
  let ownerTaskId: string;

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
    expect(me.workspaces).toHaveLength(1);
    expect(me.memberships[0]).toMatchObject({
      userId: ownerUserId,
      role: "owner"
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
      "briefings"
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

  it("lets admins create workspaces, memberships, and settings", async () => {
    const createWorkspaceResponse = await server.inject({
      method: "POST",
      url: "/api/admin/workspaces",
      headers: {
        cookie: ownerCookie
      },
      payload: {
        name: "Alpha Workspace"
      }
    });

    createdWorkspaceId = createWorkspaceResponse.json<{
      workspace: { id: string };
    }>().workspace.id;

    const membershipResponse = await server.inject({
      method: "POST",
      url: `/api/admin/workspaces/${createdWorkspaceId}/memberships`,
      headers: {
        cookie: ownerCookie
      },
      payload: {
        userId: memberUserId,
        role: "member"
      }
    });
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
    const memberMeResponse = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: memberCookie,
        "x-jarvis-workspace-id": createdWorkspaceId
      }
    });
    const memberMe = memberMeResponse.json<MeResponse>();

    expect(createWorkspaceResponse.statusCode).toBe(201);
    expect(membershipResponse.statusCode).toBe(200);
    expect(membershipResponse.json()).toMatchObject({
      membership: {
        userId: memberUserId,
        workspaceId: createdWorkspaceId,
        role: "member"
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
    expect(memberMe.activeWorkspaceId).toBeNull();
    expect(memberMe.workspaces.map((workspace) => workspace.id)).toContain(createdWorkspaceId);
  });

  it("creates resource grants without giving admins private-data bypass", async () => {
    const createTaskResponse = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: ownerCookie
      },
      payload: {
        title: "Owner-only task"
      }
    });

    ownerTaskId = createTaskResponse.json<{ task: { id: string } }>().task.id;

    const beforeGrantResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${ownerTaskId}`,
      headers: {
        cookie: memberCookie
      }
    });
    const grantResponse = await server.inject({
      method: "POST",
      url: "/api/admin/resource-grants",
      headers: {
        cookie: ownerCookie
      },
      payload: {
        resourceType: "task",
        resourceId: ownerTaskId,
        granteeUserId: memberUserId,
        grantLevel: "view"
      }
    });
    const afterGrantResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${ownerTaskId}`,
      headers: {
        cookie: memberCookie
      }
    });

    expect(createTaskResponse.statusCode).toBe(201);
    expect(beforeGrantResponse.statusCode).toBe(404);
    expect(grantResponse.statusCode).toBe(200);
    expect(grantResponse.json()).toMatchObject({
      grant: {
        resourceType: "task",
        resourceId: ownerTaskId,
        granteeUserId: memberUserId,
        grantLevel: "view",
        grantedByUserId: ownerUserId
      }
    });
    // Slice 1b: tasks now use the owner-or-share model and no longer consult
    // app.resource_grants. The admin resource-grants API still records the grant
    // (200 above), but it is INERT for tasks — the grantee gains no task access.
    // This assertion and the admin resource-grants-for-tasks path are retired in Slice 1f.
    expect(afterGrantResponse.statusCode).toBe(404);
  });

  it("lists management edges, records audit events, and revokes access", async () => {
    const membershipsResponse = await server.inject({
      method: "GET",
      url: `/api/admin/workspaces/${createdWorkspaceId}/memberships`,
      headers: {
        cookie: ownerCookie
      }
    });
    const grantsResponse = await server.inject({
      method: "GET",
      url: "/api/admin/resource-grants",
      headers: {
        cookie: ownerCookie
      }
    });
    const initialAuditResponse = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: {
        cookie: ownerCookie
      }
    });
    const deleteGrantResponse = await server.inject({
      method: "DELETE",
      url: `/api/admin/resource-grants/task/${ownerTaskId}/${memberUserId}`,
      headers: {
        cookie: ownerCookie
      }
    });
    const afterGrantDeleteResponse = await server.inject({
      method: "GET",
      url: `/api/tasks/${ownerTaskId}`,
      headers: {
        cookie: memberCookie
      }
    });
    const deleteMembershipResponse = await server.inject({
      method: "DELETE",
      url: `/api/admin/workspaces/${createdWorkspaceId}/memberships/${memberUserId}`,
      headers: {
        cookie: ownerCookie
      }
    });
    const deniedWorkspaceContextResponse = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: memberCookie,
        "x-jarvis-workspace-id": createdWorkspaceId
      }
    });
    const finalAuditResponse = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: {
        cookie: ownerCookie
      }
    });
    const initialAuditActions = initialAuditResponse
      .json<ListAdminAuditEventsResponse>()
      .auditEvents.map((event) => event.action);
    const finalAuditActions = finalAuditResponse
      .json<ListAdminAuditEventsResponse>()
      .auditEvents.map((event) => event.action);

    expect(membershipsResponse.statusCode).toBe(200);
    expect(membershipsResponse.json()).toMatchObject({
      memberships: expect.arrayContaining([
        expect.objectContaining({
          userId: memberUserId,
          workspaceId: createdWorkspaceId,
          role: "member"
        })
      ])
    });
    expect(grantsResponse.statusCode).toBe(200);
    expect(grantsResponse.json()).toMatchObject({
      grants: expect.arrayContaining([
        expect.objectContaining({
          resourceType: "task",
          resourceId: ownerTaskId,
          granteeUserId: memberUserId,
          grantLevel: "view"
        })
      ])
    });
    expect(initialAuditActions).toEqual(
      expect.arrayContaining([
        "bootstrap.instance_owner",
        "workspace.create",
        "workspace_membership.upsert",
        "instance_setting.upsert",
        "resource_grant.upsert"
      ])
    );
    expect(deleteGrantResponse.statusCode).toBe(200);
    expect(deleteGrantResponse.json()).toMatchObject({
      grant: {
        resourceType: "task",
        resourceId: ownerTaskId,
        granteeUserId: memberUserId,
        grantLevel: "view"
      }
    });
    expect(afterGrantDeleteResponse.statusCode).toBe(404);
    expect(deleteMembershipResponse.statusCode).toBe(200);
    expect(deleteMembershipResponse.json()).toMatchObject({
      membership: {
        userId: memberUserId,
        workspaceId: createdWorkspaceId,
        role: "member"
      }
    });
    expect(deniedWorkspaceContextResponse.statusCode).toBe(200);
    expect(deniedWorkspaceContextResponse.json<MeResponse>().activeWorkspaceId).toBeNull();
    expect(finalAuditActions).toEqual(
      expect.arrayContaining(["resource_grant.delete", "workspace_membership.delete"])
    );
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
