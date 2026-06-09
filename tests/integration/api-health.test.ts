import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

describe("Health endpoints — healthy server", () => {
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    server = createApiServer({
      appDb: createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 }),
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
  });

  it("GET /health returns 200 {ok:true} without touching DB (liveness)", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /health/ready returns 200 when DB + pg-boss are reachable", async () => {
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; db: string; pgboss: string }>();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(body.pgboss).toBe("ok");
  });
});

describe("Health readiness — DB down", () => {
  let server: ReturnType<typeof createApiServer>;
  let badDb: Kysely<JarvisDatabase>;

  beforeAll(async () => {
    badDb = createDatabase({
      connectionString: "postgres://jarvis:jarvis@localhost:9999/nonexistent",
      maxConnections: 1,
      connectionTimeoutMillis: 500
    });
    const stubBoss = {
      start: async () => {},
      stop: async () => {},
      isInstalled: async () => true
    } as unknown as PgBoss;

    server = createApiServer({ appDb: badDb, boss: stubBoss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), badDb?.destroy()]);
  });

  it("GET /health returns 200 even when DB is down (liveness independent)", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /health/ready returns 503 with db:down when DB is unreachable", async () => {
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json<{ ok: boolean; db: string; pgboss: string }>();
    expect(body.ok).toBe(false);
    expect(body.db).toBe("down");
    expect(body.pgboss).toBe("ok");
  });
});
