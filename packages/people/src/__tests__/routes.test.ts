import { chmod, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import { makeVaultDir, readVaultFile, VaultContextRunner, writeVaultFile } from "@jarv1s/vault";
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

beforeEach(async () => {
  await resetFoundationDatabase();
});

function buildApp(actorUserId = ids.userA, actorVaultRunner: VaultContextRunner = vaultRunner) {
  const app = Fastify();
  registerPeopleRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId, requestId: "test" }),
    dataContext: runner,
    repo: new PeopleRepository(),
    svc: new PersonContextService(new PeopleRepository()),
    vaultRunner: actorVaultRunner,
    peopleNotesService: new PeopleNotesService()
  });
  return app;
}

describe("People notes settings routes", () => {
  it("keeps directory discovery owner-scoped across symlinks", async () => {
    let userBRoot = "";
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userB, requestId: "directory-user-b" },
      async (ctx) => {
        userBRoot = ctx.vaultRoot;
        await makeVaultDir(ctx, "OnlyUserB");
      }
    );
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "directory-user-a" },
      (ctx) => symlink(userBRoot, join(ctx.vaultRoot, "EscapeToUserB"), "dir")
    );

    const app = buildApp(ids.userA);
    await app.ready();
    const root = await app.inject({ method: "GET", url: "/api/people/notes-directories" });
    expect(root.body).not.toContain("OnlyUserB");

    const escaped = await app.inject({
      method: "GET",
      url: "/api/people/notes-directories?path=EscapeToUserB"
    });
    expect(escaped.statusCode).toBe(400);
    expect(JSON.parse(escaped.body)).toEqual({ error: "People notes folder is unavailable" });
    expect(escaped.body).not.toContain(userBRoot);
    expect(escaped.body).not.toContain(ids.userB);
    expect(escaped.body).not.toContain("OnlyUserB");
    await app.close();
  });

  it("maps GET and PUT filesystem failures to one safe response", async () => {
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "not-directory-setup" },
      (ctx) => writeVaultFile(ctx, "QA987NotDirectory", "plain file")
    );
    const app = buildApp();
    await app.ready();

    for (const response of [
      await app.inject({
        method: "GET",
        url: "/api/people/notes-directories?path=QA987NotDirectory"
      }),
      await app.inject({
        method: "PUT",
        url: "/api/people/notes-settings",
        payload: { folder: "QA987NotDirectory/Child" }
      })
    ]) {
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: "People notes folder is unavailable" });
      expect(response.body).not.toContain(vaultRoot);
    }
    await app.close();

    const deniedRunner = {
      withVaultContext: async () => {
        throw Object.assign(new Error("/private/vault/denied"), { code: "EACCES" });
      }
    } as unknown as VaultContextRunner;
    const deniedApp = buildApp(ids.userA, deniedRunner);
    await deniedApp.ready();
    for (const response of [
      await deniedApp.inject({ method: "GET", url: "/api/people/notes-directories" }),
      await deniedApp.inject({
        method: "PUT",
        url: "/api/people/notes-settings",
        payload: { folder: "Denied/Child" }
      })
    ]) {
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: "People notes folder is unavailable" });
      expect(response.body).not.toContain("/private/vault/denied");
    }
    await deniedApp.close();
  });

  it("lists owner-relative directories and rejects traversal without vault details", async () => {
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "directory-setup" },
      async (ctx) => {
        await makeVaultDir(ctx, "QA987/Family");
        await makeVaultDir(ctx, "QA987Private");
      }
    );
    const app = buildApp();
    await app.ready();

    const root = await app.inject({ method: "GET", url: "/api/people/notes-directories" });
    expect(root.statusCode).toBe(200);
    expect(JSON.parse(root.body).directories).toEqual(
      expect.arrayContaining([
        { name: "QA987", path: "QA987" },
        { name: "QA987Private", path: "QA987Private" }
      ])
    );

    const invalid = await app.inject({
      method: "GET",
      url: "/api/people/notes-directories?path=People%2F..%2FPrivate"
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain(vaultRoot);
    expect(invalid.body).not.toContain(ids.userA);
    expect(invalid.body).not.toContain("QA987Private");
    await app.close();
  });

  it("serializes exact mixed refresh counters", async () => {
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "refresh-setup" },
      async (ctx) => {
        await writeVaultFile(
          ctx,
          "QA987Refresh/Canonical.md",
          `---
jarvisPersonId: 00000000-0000-4000-8000-000000000198
displayName: Route Canonical
aliases: []
emails: []
phones: []
status: active
---
body
`
        );
        await writeVaultFile(
          ctx,
          "QA987Refresh/Missing-Id.md",
          `---
displayName: Route Missing Id
aliases: []
emails: []
phones: []
status: active
---
body
`
        );
        await writeVaultFile(ctx, "QA987Refresh/Invalid.md", "# Invalid");
        await writeVaultFile(ctx, "QA987Refresh/Outside-counts.txt", "ignored extension");
      }
    );
    const app = buildApp();
    await app.ready();
    await app.inject({
      method: "PUT",
      url: "/api/people/notes-settings",
      payload: { folder: "QA987Refresh" }
    });
    const refresh = await app.inject({ method: "POST", url: "/api/people/notes/refresh" });
    expect(refresh.statusCode).toBe(200);
    expect(JSON.parse(refresh.body)).toEqual({
      discovered: 3,
      projected: 1,
      ignored: 1,
      candidates: 1
    });

    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "refresh-unreadable" },
      (ctx) => chmod(join(ctx.vaultRoot, "QA987Refresh/Canonical.md"), 0o000)
    );
    const unavailable = await app.inject({ method: "POST", url: "/api/people/notes/refresh" });
    expect(unavailable.statusCode).toBe(400);
    expect(JSON.parse(unavailable.body)).toEqual({
      error: "People notes folder is unavailable"
    });
    expect(unavailable.body).not.toContain(vaultRoot);

    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "refresh-loop" },
      async (ctx) => {
        await chmod(join(ctx.vaultRoot, "QA987Refresh/Canonical.md"), 0o600);
        await rm(join(ctx.vaultRoot, "QA987Refresh"), { recursive: true });
        await symlink("QA987Refresh", join(ctx.vaultRoot, "QA987Refresh"), "dir");
      }
    );
    const loop = await app.inject({ method: "POST", url: "/api/people/notes/refresh" });
    expect(loop.statusCode).toBe(400);
    expect(JSON.parse(loop.body)).toEqual({ error: "People notes folder is unavailable" });
    expect(loop.body).not.toContain(vaultRoot);
    await app.close();
  });

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
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "write-route-setup" },
      (ctx) => makeVaultDir(ctx, "PeopleRoute")
    );
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

    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "assert-route" },
      async (ctx) => {
        const note = await readVaultFile(ctx, notePath);
        expect(note).toContain("displayName: Route Person Edited");
        expect(note).toContain("status: archived");
      }
    );

    await app.close();
  });

  it("falls back to DB-only update/archive when person has no canonical note", async () => {
    await vaultRunner.withVaultContext(
      { actorUserId: ids.userA, requestId: "no-note-route-setup" },
      (ctx) => makeVaultDir(ctx, "PeopleNoNoteRoute")
    );
    const app = buildApp();
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/people/notes-settings",
      payload: { folder: "PeopleNoNoteRoute" }
    });

    const repo = new PeopleRepository();
    let personId = "";
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "no-note-setup" },
      async (sdb) => {
        const person = await repo.upsertPerson(sdb, {
          ownerUserId: ids.userA,
          displayName: "Projected Person",
          confidence: 0.8
        });
        personId = person.id;
      }
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/people/${personId}`,
      payload: { displayName: "Projected Person Edited" }
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body).person.displayName).toBe("Projected Person Edited");

    const archived = await app.inject({ method: "POST", url: `/api/people/${personId}/archive` });
    expect(archived.statusCode).toBe(200);
    expect(JSON.parse(archived.body)).toEqual({ archived: true });

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "no-note-assert" },
      async (sdb) => {
        const person = await repo.getPerson(sdb, ids.userA, personId);
        expect(person.displayName).toBe("Projected Person Edited");
        expect(person.status).toBe("archived");
      }
    );

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
