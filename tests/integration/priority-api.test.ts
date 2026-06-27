import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import { HttpError } from "@jarv1s/module-sdk";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { registerSettingsRoutes } from "../../packages/settings/src/routes.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

function userHeaders(sessionId: string): Record<string, string> {
  return { authorization: `Bearer ${sessionId}` };
}

describe("priority model API", () => {
  let appDb: Kysely<JarvisDatabase> | undefined;
  let server: FastifyInstance | undefined;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    const dataContext = new DataContextRunner(appDb);
    server = Fastify({ logger: false });
    registerSettingsRoutes(server, {
      rootDb: appDb,
      dataContext,
      resolveAccessContext: async (request) => {
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token === ids.sessionA) return { actorUserId: ids.userA, requestId: "req:priority-a" };
        if (token === ids.sessionB) return { actorUserId: ids.userB, requestId: "req:priority-b" };
        throw new HttpError(401, "Unauthorized");
      },
      listModuleManifests: () => getBuiltInModuleManifests(),
      preferencesRepository: new PreferencesRepository()
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("GET /api/me/priority-model returns defaults when empty", async () => {
    const response = await server!.inject({
      method: "GET",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionB)
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.version).toBe(1);
    expect(body.mode).toBe("balanced");
    expect(body.anchors).toEqual([]);
    expect(body.mutedSources).toEqual([]);
  });

  it("PATCH /api/me/priority-model validates and stores", async () => {
    const input: PriorityModelPreferenceV1 = {
      version: 1,
      mode: "deadline_first",
      anchors: [
        {
          id: "a1",
          kind: "project",
          label: "Apollo",
          aliases: ["moon"],
          weight: 2,
          enabled: true,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      mutedSources: ["email"],
      updatedAt: "2026-06-27T00:00:00Z"
    };
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: input
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.mode).toBe("deadline_first");
    expect(body.anchors).toHaveLength(1);
    expect(body.mutedSources).toEqual(["email"]);
    expect(body.updatedAt).not.toBe(input.updatedAt);
  });

  it("PATCH /api/me/priority-model rejects invalid mode", async () => {
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: {
        version: 1,
        mode: "invalid",
        anchors: [],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH /api/me/priority-model rejects too many anchors", async () => {
    const anchors = Array.from({ length: 51 }, (_, i) => ({
      id: `a${i}`,
      kind: "project" as const,
      label: `Project ${i}`,
      aliases: [],
      weight: 1 as const,
      enabled: true,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z"
    }));
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: {
        version: 1,
        mode: "balanced",
        anchors,
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH /api/me/priority-model rejects invalid weight", async () => {
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [
          {
            id: "a1",
            kind: "project",
            label: "Test",
            aliases: [],
            weight: 5,
            enabled: true,
            createdAt: "2026-06-01T00:00:00Z",
            updatedAt: "2026-06-01T00:00:00Z"
          }
        ],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH /api/me/priority-model rejects unknown source", async () => {
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: ["unknown"],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH /api/me/priority-model rejects unknown top-level keys", async () => {
    const response = await server!.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      headers: userHeaders(ids.sessionA),
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z",
        unknown: "value"
      }
    });
    expect(response.statusCode).toBe(400);
  });
});
