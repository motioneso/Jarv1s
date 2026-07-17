import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { GetQuietHoursSettingsResponse } from "@jarv1s/shared";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("settings quiet-hours preferences", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    await setInstanceSetting("registration.requires_approval", { value: false });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();

    ownerCookie = await signUp("Owner", "owner.qh@example.test");
    memberCookie = await signUp("Member", "member.qh@example.test");
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("returns disabled defaults when the quiet-hours preference is unset", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetQuietHoursSettingsResponse>()).toEqual({
      quietHours: {
        enabled: false,
        start: "22:00",
        end: "07:00",
        timezone: null
      }
    });
  });

  it("persists quiet-hours preferences and returns them on the next read", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "07:00",
          timezone: "America/Chicago"
        }
      }
    });

    expect(put.statusCode).toBe(200);
    expect(put.json<GetQuietHoursSettingsResponse>().quietHours).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "America/Chicago"
    });

    const get = await server.inject({
      method: "GET",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie }
    });

    expect(get.statusCode).toBe(200);
    expect(get.json<GetQuietHoursSettingsResponse>().quietHours).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "America/Chicago"
    });
  });

  it("accepts null timezone (uses locale tz fallback at deferral time)", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        quietHours: {
          enabled: true,
          start: "21:00",
          end: "08:00",
          timezone: null
        }
      }
    });

    expect(put.statusCode).toBe(200);
    expect(put.json<GetQuietHoursSettingsResponse>().quietHours.timezone).toBeNull();
  });

  it("keeps quiet-hours preferences isolated per user", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/quiet-hours",
      headers: { cookie: memberCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetQuietHoursSettingsResponse>().quietHours.enabled).toBe(false);
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me/quiet-hours" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid HH:MM start time", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        quietHours: {
          enabled: true,
          start: "25:00",
          end: "07:00",
          timezone: null
        }
      }
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid HH:MM end time", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "7pm",
          timezone: null
        }
      }
    });

    expect(res.statusCode).toBe(400);
  });

  async function signUp(name: string, email: string): Promise<string> {
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name,
        email,
        password: "correct horse battery staple"
      }
    });
    expect(signUp.statusCode).toBe(200);
    return cookieHeader(signUp.headers);
  }
});
