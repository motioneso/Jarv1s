import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { NotificationsRepository } from "@jarv1s/notifications";
import type { ListNotificationPreferencesResponse } from "@jarv1s/shared";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("notification preferences", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("lists active notification-capable modules with default enabled preferences", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/notification-preferences",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ListNotificationPreferencesResponse>().preferences).toEqual(
      expect.arrayContaining([
        { moduleId: "briefings", moduleName: "Briefings", enabled: true },
        { moduleId: "settings", moduleName: "Settings", enabled: true }
      ])
    );
    expect(
      res
        .json<ListNotificationPreferencesResponse>()
        .preferences.some((preference) => preference.moduleId === "notifications")
    ).toBe(false);
  });

  it("persists module notification disable and can clear unread notifications for that module", async () => {
    const repository = new NotificationsRepository();
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "request:notification-preferences" },
      (scopedDb) =>
        repository.create(scopedDb, {
          moduleId: "briefings",
          title: "Briefing ready",
          metadata: { source: "notification-preference-test" }
        })
    );

    const put = await server.inject({
      method: "PUT",
      url: "/api/me/notification-preferences/briefings",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "application/json"
      },
      payload: { enabled: false, clearUnread: true }
    });
    const get = await server.inject({
      method: "GET",
      url: "/api/me/notification-preferences",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const notifications = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().preference).toEqual({
      moduleId: "briefings",
      moduleName: "Briefings",
      enabled: false
    });
    expect(put.json().unreadCount).toBe(0);
    expect(
      get
        .json<ListNotificationPreferencesResponse>()
        .preferences.find((preference) => preference.moduleId === "briefings")?.enabled
    ).toBe(false);
    expect(notifications.json<{ unreadCount: number }>().unreadCount).toBe(0);
  });

  it("rejects preferences for modules that do not declare notification support", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/notification-preferences/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "application/json"
      },
      payload: { enabled: false }
    });

    expect(res.statusCode).toBe(422);
  });
});
