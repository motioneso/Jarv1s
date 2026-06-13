import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";
import Fastify from "fastify";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import {
  NotificationsRepository,
  notificationsModuleManifest,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const notificationIds = {
  aPrivate: "60000000-0000-4000-8000-000000000001",
  bPrivate: "60000000-0000-4000-8000-000000000002",
  aWorkspaceSeed: "60000000-0000-4000-8000-000000000003"
} as const;

describe("Notifications module M5", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: NotificationsRepository;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedNotificationData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new NotificationsRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("applies Notifications migrations with forced RLS and no worker table grant", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version = '0008'
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_select: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('notifications', 'notification_reads')
          ORDER BY c.relname
        `
      );

      expect(migrations.rows).toEqual([{ version: "0008", name: "0008_notifications_module.sql" }]);
      expect(tables.rows).toEqual([
        {
          relname: "notification_reads",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        },
        {
          relname: "notifications",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads the built-in Notifications module manifest without queues", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const registration = registrations.find(
      (item) => item.manifest.id === notificationsModuleManifest.id
    );
    const manifest = manifests.find((item) => item.id === notificationsModuleManifest.id);

    expect(manifests.map((item) => item.id)).toEqual([
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
      "structured-state",
      "wellness"
    ]);
    expect(registrations.map((item) => item.manifest.id)).toEqual([
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
      "structured-state",
      "wellness"
    ]);
    expect(manifest?.database?.ownedTables).toEqual([
      "app.notifications",
      "app.notification_reads"
    ]);
    expect(manifest?.navigation?.[0]).toMatchObject({
      id: "notifications",
      path: "/notifications",
      permissionId: "notifications.view"
    });
    expect(manifest?.settings ?? []).toEqual([]);
    expect(registration?.queueDefinitions).toEqual([]);
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/notifications/sql")
    );
  });

  it("denies notification reads when no data context is set", async () => {
    await expect(appDb.selectFrom("app.notifications").select("id").execute()).resolves.toEqual([]);
  });

  it("creates private notifications for the active actor by default", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "Private default notification",
        body: "Only User A can read this",
        metadata: {
          source: "integration-test"
        }
      })
    );
    const fetchedByOwner = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );
    const fetchedByOtherUser = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );

    expect(created.actor_user_id).toBe(ids.userA);
    expect(created.recipient_user_id).toBe(ids.userA);
    expect(created.read_at).toBeNull();
    expect(fetchedByOwner?.id).toBe(created.id);
    expect(fetchedByOtherUser).toBeUndefined();
  });

  it("does not let another user or admin role read private notifications", async () => {
    const userRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.bPrivate)
    );
    const adminContext = await auth.resolveAccessContext(
      ids.sessionAdmin,
      "request:admin-notifications"
    );
    const adminRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, notificationIds.bPrivate)
    );

    expect(userRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("recipient-only access: notification is visible to its recipient, and invisible to non-recipients", async () => {
    // aWorkspaceSeed has recipient_user_id=userA. Under the recipient-only RLS policy,
    // only the recipient can see it.
    const visibleToRecipient = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aWorkspaceSeed)
    );
    const nonRecipient = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aWorkspaceSeed)
    );

    expect(visibleToRecipient?.id).toBe(notificationIds.aWorkspaceSeed);
    // Non-recipient cannot see it
    expect(nonRecipient).toBeUndefined();
  });

  it("tracks read state per actor for visible notifications", async () => {
    // aWorkspaceSeed has recipient_user_id=userA; it is visible to userA with or
    // without workspace context under the new recipient-only policy.
    const beforeRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aWorkspaceSeed)
    );
    const markedRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notificationIds.aWorkspaceSeed)
    );
    const afterRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aWorkspaceSeed)
    );
    const hiddenMarkRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notificationIds.bPrivate)
    );

    expect(beforeRead?.read_at).toBeNull();
    expect(markedRead?.read_at).toBeInstanceOf(Date);
    expect(afterRead?.read_at).toBeInstanceOf(Date);
    expect(hiddenMarkRead).toBeUndefined();
  });

  it("serves Notifications API list, mark read, and mark all read from session context", async () => {
    const listWithoutWorkspaceResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const listWithWorkspaceResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": "00000000-0000-4000-8000-000000000099"
      }
    });
    const deniedMarkReadResponse = await server.inject({
      method: "PATCH",
      url: `/api/notifications/${notificationIds.bPrivate}/read`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const markReadResponse = await server.inject({
      method: "PATCH",
      url: `/api/notifications/${notificationIds.aPrivate}/read`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const markAllResponse = await server.inject({
      method: "PATCH",
      url: "/api/notifications/read-all",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const afterMarkAllResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    // Under recipient-only policy, aWorkspaceSeed (recipient=userA) is visible to userA
    // regardless of workspace context — visibility column is now inert.
    expect(listWithoutWorkspaceResponse.statusCode).toBe(200);
    expect(
      listWithoutWorkspaceResponse
        .json<{ notifications: Array<{ id: string }> }>()
        .notifications.some((notification) => notification.id === notificationIds.aWorkspaceSeed)
    ).toBe(true);
    expect(listWithWorkspaceResponse.statusCode).toBe(200);
    expect(
      listWithWorkspaceResponse
        .json<{ notifications: Array<{ id: string }> }>()
        .notifications.some((notification) => notification.id === notificationIds.aWorkspaceSeed)
    ).toBe(true);
    expect(deniedMarkReadResponse.statusCode).toBe(404);
    expect(markReadResponse.statusCode).toBe(200);
    expect(
      markReadResponse.json<{ notification: { id: string; readAt: string | null } }>().notification
    ).toMatchObject({
      id: notificationIds.aPrivate,
      readAt: expect.any(String)
    });
    expect(markAllResponse.statusCode).toBe(200);
    expect(markAllResponse.json<{ unreadCount: number }>().unreadCount).toBe(0);
    expect(afterMarkAllResponse.json<{ unreadCount: number }>().unreadCount).toBe(0);
  });

  it("fails loudly when the Notifications repository is called without withDataContext", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  it("returns 401 for no auth header and for a wrong-scheme authorization header", async () => {
    const noAuthResponse = await server.inject({
      method: "GET",
      url: "/api/notifications"
    });

    // Wrong scheme ("Basic") → readBearerToken throws "Invalid bearer token" → handleRouteError → 401
    const wrongSchemeResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: "Basic dXNlcjpwYXNz" }
    });

    expect(noAuthResponse.statusCode).toBe(401);
    expect(wrongSchemeResponse.statusCode).toBe(401);
    expect(noAuthResponse.json<{ error: string }>().error).toBe("Session is missing or expired");
  });

  it("returns 500 (not 401) when an unexpected error escapes a notification route", async () => {
    const probe = Fastify({ logger: false });
    registerNotificationsRoutes(probe, {
      resolveAccessContext: async () => ({
        actorUserId: ids.userA,
        requestId: "request:err-probe"
      }),
      dataContext,
      repository: {
        listVisible: async () => {
          throw new Error("boom-stack-details");
        }
      } as unknown as NotificationsRepository
    });
    await probe.ready();

    try {
      const res = await probe.inject({ method: "GET", url: "/api/notifications" });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("boom-stack-details");
    } finally {
      await probe.close();
    }
  });
});

async function seedNotificationData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.notifications (
          id,
          actor_user_id,
          recipient_user_id,
          title,
          body,
          metadata
        )
        VALUES
          ($1, $2, $3, 'User A private notification', 'Private for User A', $4::jsonb),
          ($5, $3, $2, 'User B private notification', 'Private for User B', $6::jsonb),
          ($7, $2, $3, 'Workspace seed notification', 'Workspace seed for User A', $8::jsonb)
      `,
      [
        notificationIds.aPrivate,
        ids.userB,
        ids.userA,
        JSON.stringify({ source: "seed", resourceType: "task" }),
        notificationIds.bPrivate,
        JSON.stringify({ source: "seed", resourceType: "note" }),
        notificationIds.aWorkspaceSeed,
        JSON.stringify({ source: "seed", workspaceScoped: true })
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-notifications"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-notifications"
  };
}
