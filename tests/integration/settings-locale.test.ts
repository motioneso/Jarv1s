import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { GetLocaleSettingsResponse } from "@jarv1s/shared";
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

describe("settings locale preferences", () => {
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

    ownerCookie = await signUp("Owner", "owner.locale@example.test");
    memberCookie = await signUp("Member", "member.locale@example.test");
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("returns sensible defaults when the locale preference is unset", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie: ownerCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetLocaleSettingsResponse>()).toEqual({
      locale: {
        timezone: "America/Los_Angeles",
        region: "en-US",
        dateFormat: "24"
      }
    });
  });

  it("persists locale preferences and returns them on the next read", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/me/locale",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        locale: {
          timezone: "Europe/Berlin",
          region: "de-DE",
          dateFormat: "12"
        }
      }
    });

    expect(put.statusCode).toBe(200);
    expect(put.json<GetLocaleSettingsResponse>().locale).toEqual({
      timezone: "Europe/Berlin",
      region: "de-DE",
      dateFormat: "12"
    });

    const get = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie: ownerCookie }
    });

    expect(get.statusCode).toBe(200);
    expect(get.json<GetLocaleSettingsResponse>().locale).toEqual({
      timezone: "Europe/Berlin",
      region: "de-DE",
      dateFormat: "12"
    });
  });

  it("keeps locale preferences isolated per user", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie: memberCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetLocaleSettingsResponse>().locale).toEqual({
      timezone: "America/Los_Angeles",
      region: "en-US",
      dateFormat: "24"
    });
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me/locale" });

    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid date formats", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/locale",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        locale: {
          timezone: "America/New_York",
          region: "en-US",
          dateFormat: "iso"
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
