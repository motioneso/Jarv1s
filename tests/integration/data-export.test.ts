import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";

import { fastify, type FastifyInstance } from "fastify";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { registerDataExportRoutes } from "../../packages/settings/src/data-export-routes.js";
import { DataContextRunner } from "@jarv1s/db";

import { HttpError } from "@jarv1s/module-sdk";

describe("Data export", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authDb: Kysely<JarvisDatabase>;
  let server: FastifyInstance;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authDb = createDatabase({ connectionString: connectionStrings.auth, maxConnections: 1 });
    server = fastify();

    registerDataExportRoutes(server, {
      rootDb: appDb,
      dataContext: new DataContextRunner(appDb),
      resolveAccessContext: async (request) => {
        const auth = request.headers.authorization;
        if (!auth || !auth.startsWith("Bearer ")) {
          throw new HttpError(401, "Unauthorized");
        }
        const token = auth.substring(7);
        if (token !== ids.sessionA) {
          throw new HttpError(401, "Unauthorized");
        }
        return { actorUserId: ids.userA, requestId: "req:test" };
      }
    });

    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    await appDb?.destroy();
    await authDb?.destroy();
  });

  it("exports data successfully for the authenticated user and omits sensitive secrets", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/settings/me/data-export",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    if (res.statusCode !== 200) {
      console.error(res.payload);
    }
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="jarv1s-archive-[a-f0-9-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json"$/
    );

    const body = res.json() as { userId: string; tables: { users: { id: string }[] } };
    expect(body.userId).toBe(ids.userA);
    expect(body.tables).toBeDefined();

    // Ensure the users table has the user
    expect(body.tables.users.find((u) => u.id === ids.userA)).toBeDefined();

    // Ensure no secrets are leaked
    expect(res.payload).not.toContain("SECRET"); // None of the secrets from auth settings etc should leak
  });

  it("requires authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/settings/me/data-export"
    });

    expect(res.statusCode).toBe(401);
  });
});
