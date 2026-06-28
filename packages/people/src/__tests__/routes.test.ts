import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import type { Kysely } from "kysely";
import type { JarvisDatabase } from "@jarv1s/db";
import { resetFoundationDatabase, ids } from "../../../../tests/integration/test-database.js";
import { registerPeopleRoutes } from "../routes.js";
import { PeopleRepository } from "../repository.js";
import { PersonContextService } from "../service.js";

const connectionStrings = getJarvisDatabaseUrls();
let db: Kysely<JarvisDatabase>;
let runner: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  runner = new DataContextRunner(db as never);
});

afterAll(async () => {
  await db?.destroy();
});

function buildApp() {
  const app = Fastify();
  registerPeopleRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "test" }),
    dataContext: runner,
    repo: new PeopleRepository(),
    svc: new PersonContextService(new PeopleRepository()),
  });
  return app;
}

describe("GET /api/people", () => {
  it("returns 200 with empty people array for new user", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/people" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.people)).toBe(true);
    await app.close();
  });
});

describe("GET /api/people/:id/links", () => {
  it("strips source_ref and normalized_value from link response", async () => {
    const app = buildApp();
    await app.ready();

    const repo = new PeopleRepository();
    let personId = "";
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "setup" }, async (sdb) => {
      const person = await repo.upsertPerson(sdb, {
        ownerUserId: ids.userA,
        displayName: "Test Person",
        status: "active",
      });
      personId = person.id;
      await repo.upsertLink(sdb, {
        ownerUserId: ids.userA,
        personId: person.id,
        sourceKind: "email",
        sourceRef: "PRIVATE_SOURCE_REF",
        sourceRefHash: "abc123",
        linkKind: "sender",
        confidence: 0.9,
        provenance: "source",
      });
    });

    const res = await app.inject({ method: "GET", url: `/api/people/${personId}/links` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.links)).toBe(true);
    for (const link of body.links) {
      expect(link).not.toHaveProperty("sourceRef");
      expect(link).not.toHaveProperty("source_ref");
      expect(link).not.toHaveProperty("normalizedValue");
      expect(link).not.toHaveProperty("normalized_value");
    }
    await app.close();
  });
});
