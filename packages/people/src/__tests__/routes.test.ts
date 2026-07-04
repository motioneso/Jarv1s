import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { readVaultFile, VaultContextRunner } from "@jarv1s/vault";
import type { Kysely } from "kysely";
import type { JarvisDatabase } from "@jarv1s/db";
import { resetFoundationDatabase, ids } from "../../../../tests/integration/test-database.js";
import { registerPeopleRoutes } from "../routes.js";
import { PeopleRepository } from "../repository.js";
import { PersonContextService } from "../service.js";
import { PeopleNotesService } from "../notes-service.js";

const connectionStrings = getJarvisDatabaseUrls();
let db: Kysely<JarvisDatabase>;
let runner: DataContextRunner;
let vaultRoot: string;
let vaultRunner: VaultContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  db = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  runner = new DataContextRunner(db as never);
  vaultRoot = await mkdtemp(join(tmpdir(), "jarvis-people-routes-"));
  vaultRunner = new VaultContextRunner(vaultRoot);
});

afterAll(async () => {
  await db?.destroy();
  if (vaultRoot) await rm(vaultRoot, { recursive: true, force: true });
});

function buildApp() {
  const app = Fastify();
  registerPeopleRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "test" }),
    dataContext: runner,
    repo: new PeopleRepository(),
    svc: new PersonContextService(new PeopleRepository()),
    vaultRunner,
    peopleNotesService: new PeopleNotesService()
  });
  return app;
}

describe("People notes settings routes", () => {
  it("stores and reads the configured People folder", async () => {
    const app = buildApp();
    await app.ready();

    const initial = await app.inject({ method: "GET", url: "/api/people/notes-settings" });
    expect(initial.statusCode).toBe(200);
    expect(JSON.parse(initial.body)).toEqual({ folder: null });

    const put = await app.inject({
      method: "PUT",
      url: "/api/people/notes-settings",
      payload: { folder: "People" }
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual({ folder: "People" });

    await app.close();
  });
});

describe("People note write routes", () => {
  it("creates, edits, and archives through the canonical note", async () => {
    const app = buildApp();
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/people/notes-settings",
      payload: { folder: "PeopleRoute" }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/people",
      payload: { displayName: "Route Person", emails: ["route@example.test"] }
    });
    expect(created.statusCode).toBe(200);
    const createdBody = JSON.parse(created.body);
    const personId = createdBody.person.id;
    const notePath = createdBody.notePath;
    expect(notePath).toBe("PeopleRoute/Route-Person.md");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/people/${personId}`,
      payload: { displayName: "Route Person Edited" }
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body).person.displayName).toBe("Route Person Edited");

    const archived = await app.inject({ method: "POST", url: `/api/people/${personId}/archive` });
    expect(archived.statusCode).toBe(200);

    await vaultRunner.withVaultContext({ actorUserId: ids.userA, requestId: "assert-route" }, async (ctx) => {
      const note = await readVaultFile(ctx, notePath);
      expect(note).toContain("displayName: Route Person Edited");
      expect(note).toContain("status: archived");
    });

    await app.close();
  });
});

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
        status: "active"
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
        provenance: "source"
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
