import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { VaultContextRunner, getVaultBaseDir, writeVaultFile } from "@jarv1s/vault";
import { HttpError } from "@jarv1s/module-sdk";

import { registerDataExportAsyncRoutes } from "../../packages/settings/src/data-export-async-routes.js";
import { DataExportRepository } from "../../packages/settings/src/data-export-repository.js";

import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";
import pg from "pg";

const { Client } = pg;

const userId = "00000000-0000-4000-8000-000000000071";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let server: FastifyInstance;
let repository: DataExportRepository;
let prevVaultBase: string | undefined;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'well-export-fmt@example.test', false)`,
      [userId]
    );
  } finally {
    await client.end();
  }
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  dataContext = new DataContextRunner(appDb);
  repository = new DataExportRepository();

  // Redirect vault base to a temp dir so the test is hermetic.
  prevVaultBase = getVaultBaseDir();
  process.env.JARVIS_VAULT_ROOT = await mkdtemp(join(tmpdir(), "well-export-fmt-"));

  server = Fastify();
  registerDataExportAsyncRoutes(server, {
    boss: { send: async () => undefined } as unknown as Parameters<
      typeof registerDataExportAsyncRoutes
    >[1]["boss"],
    dataContext,
    resolveAccessContext: async (request) => {
      const auth = request.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) throw new HttpError(401, "Unauthorized");
      return { actorUserId: userId, requestId: "req:fmt-test" };
    }
  });
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  await appDb?.destroy();
  if (prevVaultBase) process.env.JARVIS_VAULT_ROOT = prevVaultBase;
});

describe("format-aware export download + active-job isolation (#484)", () => {
  it("serves an html-format job as text/html with a wellness-export-<range>.html filename", async () => {
    const jobId = await dataContext.withDataContext(
      { actorUserId: userId, requestId: "req:fmt-test" },
      async (scopedDb) => {
        const job = await repository.createJob(scopedDb, userId, "html", {
          from: "2026-01-01",
          to: "2026-03-31",
          categories: ["checkins"]
        });
        const expiresAt = new Date(Date.now() + 60_000);
        await repository.completeJob(scopedDb, job.id, new Date(), expiresAt);

        // Write the HTML payload to the vault where the download handler reads it.
        const vaultRunner = new VaultContextRunner(getVaultBaseDir());
        await vaultRunner.withVaultContext(
          { actorUserId: userId, requestId: "req:fmt-test" },
          (vaultCtx) => writeVaultFile(vaultCtx, `exports/${job.id}.html`, "<!doctype html><p>doc</p>")
        );
        return job.id;
      }
    );

    const res = await server.inject({
      method: "GET",
      url: `/api/me/export/download/${jobId}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="wellness-export-2026-01-01-to-2026-03-31.html"'
    );
    expect(res.payload).toContain("<!doctype html>");
  });

  it("serves a json-format job as application/json with the jarvis-export filename (unchanged path)", async () => {
    const jobId = await dataContext.withDataContext(
      { actorUserId: userId, requestId: "req:fmt-test" },
      async (scopedDb) => {
        const job = await repository.createJob(scopedDb, userId, "json");
        await repository.completeJob(scopedDb, job.id, new Date(), new Date(Date.now() + 60_000));
        const vaultRunner = new VaultContextRunner(getVaultBaseDir());
        await vaultRunner.withVaultContext(
          { actorUserId: userId, requestId: "req:fmt-test" },
          (vaultCtx) => writeVaultFile(vaultCtx, `exports/${job.id}.json`, '{"ok":true}')
        );
        return job.id;
      }
    );

    const res = await server.inject({
      method: "GET",
      url: `/api/me/export/download/${jobId}`,
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="jarvis-export-\d{4}-\d{2}-\d{2}\.json"$/);
  });

  it("findActiveJobForUser(format) isolates kinds: a pending json job does not block an html job", async () => {
    await dataContext.withDataContext(
      { actorUserId: userId, requestId: "req:fmt-test" },
      async (scopedDb) => {
        await repository.createJob(scopedDb, userId, "json"); // stays pending
        const htmlActive = await repository.findActiveJobForUser(scopedDb, userId, "html");
        expect(htmlActive).toBeUndefined();
        const jsonActive = await repository.findActiveJobForUser(scopedDb, userId, "json");
        expect(jsonActive?.format).toBe("json");
      }
    );
  });
});
