import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type {
  GetNotificationDigestPreferenceResponse,
  PutNotificationDigestPreferenceResponse
} from "@jarv1s/shared";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("notification digest settings", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let server: ReturnType<typeof createApiServer>;
  let schedules: unknown[][];
  let unschedules: unknown[][];
  let originalSecretKey: string | undefined;

  beforeEach(async () => {
    originalSecretKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    schedules = [];
    unschedules = [];
    server = createApiServer({
      appDb,
      logger: false,
      boss: {
        schedule: async (...args: unknown[]) => {
          schedules.push(args);
        },
        unschedule: async (...args: unknown[]) => {
          unschedules.push(args);
        },
        isInstalled: async () => true
      } as never
    });
    await server.ready();
  });

  afterEach(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_CONNECTOR_SECRET_KEY;
    } else {
      process.env.JARVIS_CONNECTOR_SECRET_KEY = originalSecretKey;
    }
  });

  it("defaults disabled and unavailable without an active email connector", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/notification-digest-preference",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetNotificationDigestPreferenceResponse>()).toEqual({
      digest: {
        enabled: false,
        cadence: "daily",
        scheduleMetadata: { targetTime: "07:00", timezone: "UTC" },
        available: false,
        unavailableReason: "no_email_connector"
      }
    });
  });

  it("is available with an active Google connector", async () => {
    await seedGoogleAccount();

    const res = await server.inject({
      method: "GET",
      url: "/api/me/notification-digest-preference",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetNotificationDigestPreferenceResponse>().digest.available).toBe(true);
    expect(res.json<GetNotificationDigestPreferenceResponse>().digest.unavailableReason).toBeNull();
  });

  it("rejects enabling when no notification modules are enabled", async () => {
    await seedGoogleAccount();
    await putModule("briefings", false);
    await putModule("settings", false);

    const res = await server.inject({
      method: "PUT",
      url: "/api/me/notification-digest-preference",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "application/json"
      },
      payload: {
        digest: {
          enabled: true,
          cadence: "daily",
          scheduleMetadata: { targetTime: "08:00", timezone: "UTC" }
        }
      }
    });

    expect(res.statusCode).toBe(422);
    expect(schedules).toHaveLength(0);
  });

  it("persists enabled digest settings and reconciles the schedule", async () => {
    await seedGoogleAccount();

    const res = await server.inject({
      method: "PUT",
      url: "/api/me/notification-digest-preference",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "application/json"
      },
      payload: {
        digest: {
          enabled: true,
          cadence: "weekly",
          scheduleMetadata: { targetTime: "09:30", timezone: "America/New_York", dayOfWeek: 2 }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<PutNotificationDigestPreferenceResponse>().digest).toMatchObject({
      enabled: true,
      cadence: "weekly",
      scheduleMetadata: { targetTime: "09:30", timezone: "America/New_York", dayOfWeek: 2 },
      available: true,
      unavailableReason: null
    });
    expect(schedules).toEqual([
      [
        "notifications.digest.compose",
        "30 9 * * 2",
        {
          actorUserId: ids.userA,
          reason: "scheduled-digest",
          idempotencyKey: `digest:${ids.userA}`
        },
        { tz: "America/New_York", key: `digest:${ids.userA}` }
      ]
    ]);
  });

  async function seedGoogleAccount(): Promise<void> {
    const cipher = createConnectorSecretCipher();
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "seed:digest-google" },
      (scopedDb) =>
        new ConnectorsRepository().upsertGoogleAccount(scopedDb, {
          scopes: ["https://www.googleapis.com/auth/gmail.modify"],
          encryptedSecret: cipher.encryptJson({
            kind: "google-oauth",
            clientId: "client-id",
            clientSecret: "client-secret",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
            grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"]
          })
        })
    );
  }

  async function putModule(moduleId: string, enabled: boolean): Promise<void> {
    const res = await server.inject({
      method: "PUT",
      url: `/api/me/notification-preferences/${moduleId}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "application/json"
      },
      payload: { enabled }
    });
    expect(res.statusCode).toBe(200);
  }
});
