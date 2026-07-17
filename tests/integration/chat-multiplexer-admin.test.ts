import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { ChatMultiplexerSettingsDto } from "@jarv1s/shared";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  connectionStrings,
  ids,
  resetEmptyFoundationDatabase,
  resetFoundationDatabase
} from "./test-database.js";

describe("chat.multiplexer instance setting (settings repository)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const repo = new SettingsRepository();

  // Probe-seeded actors: adminUser is is_instance_admin=true; userA is a plain member.
  const adminCtx = { actorUserId: ids.adminUser, requestId: "test:chat-mux-admin" };
  const memberCtx = { actorUserId: ids.userA, requestId: "test:chat-mux-member" };

  beforeAll(() => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  beforeEach(async () => {
    await resetFoundationDatabase();
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("defaults to auto and round-trips an admin write", async () => {
    await dataContext.withDataContext(adminCtx, async (db) => {
      expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("auto");
      await repo.setChatMultiplexerSetting(db, {
        multiplexer: "herdr",
        actorUserId: adminCtx.actorUserId,
        requestId: adminCtx.requestId
      });
      expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("herdr");
    });
  });

  it("rejects a non-admin write (RLS WITH CHECK)", async () => {
    await expect(
      dataContext.withDataContext(memberCtx, async (db) =>
        repo.setChatMultiplexerSetting(db, {
          multiplexer: "tmux",
          actorUserId: memberCtx.actorUserId,
          requestId: memberCtx.requestId
        })
      )
    ).rejects.toThrow();
  });
});

describe("GET/PUT /api/admin/chat-multiplexer (HTTP route)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();

    // First sign-up bootstraps the instance owner (admin); the second is a plain member.
    const owner = await signUp(server, "owner@chat-mux.test", "Owner");
    adminCookie = owner.cookie;
    const member = await signUp(server, "member@chat-mux.test", "Member");
    memberCookie = member.cookie;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("admin GET returns the default 'auto' choice plus a full live-status snapshot", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: adminCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ChatMultiplexerSettingsDto>();
    expect(body.multiplexer).toBe("auto");
    expect(typeof body.available.tmux).toBe("boolean");
    expect(typeof body.available.herdr).toBe("boolean");
    expect(typeof body.herdrInstalled).toBe("boolean");
    expect(body.active === null || ["tmux", "herdr"].includes(body.active)).toBe(true);
    expect(
      body.activeSource === null || ["env", "configured", "auto"].includes(body.activeSource)
    ).toBe(true);
    expect(body.envOverride === null || ["tmux", "herdr"].includes(body.envOverride)).toBe(true);
  });

  it("admin PUT persists the choice and echoes the live-status snapshot", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { multiplexer: "tmux" }
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json<ChatMultiplexerSettingsDto>();
    expect(putBody.multiplexer).toBe("tmux");
    expect(typeof putBody.herdrInstalled).toBe("boolean");

    const get = await server.inject({
      method: "GET",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: adminCookie }
    });
    expect(get.json<ChatMultiplexerSettingsDto>().multiplexer).toBe("tmux");
  });

  it("reflects JARVIS_MULTIPLEXER env override as envOverride + active + activeSource", async () => {
    const original = process.env.JARVIS_MULTIPLEXER;
    process.env.JARVIS_MULTIPLEXER = "tmux";
    try {
      const res = await server.inject({
        method: "GET",
        url: "/api/admin/chat-multiplexer",
        headers: { cookie: adminCookie }
      });
      const body = res.json<ChatMultiplexerSettingsDto>();
      expect(body.envOverride).toBe("tmux");
      expect(body.active).toBe("tmux");
      expect(body.activeSource).toBe("env");
    } finally {
      if (original === undefined) delete process.env.JARVIS_MULTIPLEXER;
      else process.env.JARVIS_MULTIPLEXER = original;
    }
  });

  it("rejects an invalid multiplexer value with 400 (schema-enforced enum)", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { multiplexer: "screen" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies a non-admin GET with 403", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a non-admin PUT with 403", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      payload: { multiplexer: "herdr" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an unauthenticated GET with 401", async () => {
    const res = await server.inject({ method: "GET", url: "/api/admin/chat-multiplexer" });
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
