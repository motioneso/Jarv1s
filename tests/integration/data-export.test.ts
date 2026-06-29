import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { Job } from "@jarv1s/jobs";
import type { Kysely } from "kysely";
import { VaultContextRunner, readVaultFile, writeVaultFile } from "@jarv1s/vault";

import { fastify, type FastifyInstance } from "fastify";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import type { ExportBuildJobPayload } from "../../packages/settings/src/data-export-jobs.js";
import { registerSettingsRoutes } from "../../packages/settings/src/routes.js";
import pg from "pg";

import { HttpError } from "@jarv1s/module-sdk";

const { Client } = pg;

describe("Data export", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let server: FastifyInstance;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authDb = createDatabase({ connectionString: connectionStrings.auth, maxConnections: 1 });
    workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
    server = fastify();

    registerSettingsRoutes(server, {
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
      },
      listModuleManifests: () => getBuiltInModuleManifests()
    });

    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    await appDb?.destroy();
    await authDb?.destroy();
    await workerDb?.destroy();
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

  it("exports wellness tables (deletion-parity guard: #361)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/settings/me/data-export",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tables: Record<string, unknown> };
    // These four tables are purged on account deletion (#361 fix) — confirm they are also exported.
    expect(Array.isArray(body.tables.wellnessCheckins)).toBe(true);
    expect(Array.isArray(body.tables.medications)).toBe(true);
    expect(Array.isArray(body.tables.medicationLogs)).toBe(true);
    expect(Array.isArray(body.tables.wellnessTherapyNotes)).toBe(true);
    expect(Array.isArray(body.tables.jarvisGoals)).toBe(true);
    expect(Array.isArray(body.tables.jarvisGoalEvidence)).toBe(true);
    expect(Array.isArray(body.tables.jarvisActionAuditLog)).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/settings/me/data-export"
    });

    expect(res.statusCode).toBe(401);
  });

  it("declares the data-export route in the settings manifest so the route guard exposes it", () => {
    const settingsManifest = getBuiltInModuleManifests().find(
      (manifest) => manifest.id === "settings"
    );
    expect(settingsManifest?.routes).toContainEqual({
      method: "GET",
      path: "/api/settings/me/data-export",
      permissionId: "settings.view"
    });
  });

  it("Finding 2: completedJob sets completed_at = now() and distinct from expires_at", async () => {
    const repository = new (
      await import("../../packages/settings/src/data-export-repository.js")
    ).DataExportRepository();
    const dataContext = new DataContextRunner(appDb);
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:test" },
      async (scopedDb) => {
        const job = await repository.createJob(scopedDb, ids.userA);

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const completedAt = new Date(Date.now() - 10000); // artificially old completedAt

        await repository.completeJob(scopedDb, job.id, completedAt, expiresAt);

        const finishedJob = await repository.getJobById(scopedDb, job.id);
        expect(finishedJob?.status).toBe("ready");
        expect(finishedJob?.completed_at).toBeDefined();
        expect(finishedJob?.expires_at).toBeDefined();
        // completed_at shouldn't equal expires_at
        expect(finishedJob?.completed_at?.getTime()).not.toBe(finishedJob?.expires_at?.getTime());
        expect(finishedJob?.completed_at?.getTime()).toBe(completedAt.getTime());
      }
    );
  });

  it("Finding 3: initial status update throw marks job failed instead of stuck pending", async () => {
    const { handleExportBuildJob } =
      await import("../../packages/settings/src/data-export-jobs.js");
    const dataContext = new DataContextRunner(appDb);
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:test" },
      async (scopedDb) => {
        const repository = new (
          await import("../../packages/settings/src/data-export-repository.js")
        ).DataExportRepository();
        const jobRecord = await repository.createJob(scopedDb, ids.userA);

        const spy = vi
          .spyOn(
            (await import("../../packages/settings/src/data-export-repository.js"))
              .DataExportRepository.prototype,
            "updateJobStatus"
          )
          .mockRejectedValueOnce(new Error("Forced failure"));

        const jobPayload = {
          data: { actorUserId: ids.userA, jobId: jobRecord.id, kind: "export.build" as const }
        } as Job<ExportBuildJobPayload>;

        try {
          await handleExportBuildJob(jobPayload, scopedDb);

          const updatedJob = await repository.getJobById(scopedDb, jobRecord.id);
          expect(updatedJob?.status).toBe("failed");
          expect(updatedJob?.error_message).toContain("Forced failure");
        } finally {
          spy.mockRestore();
        }
      }
    );
  });

  it("lets the worker invoke the bounded expired-export listing function without direct table SELECT", async () => {
    const repository = new (
      await import("../../packages/settings/src/data-export-repository.js")
    ).DataExportRepository();
    const dataContext = new DataContextRunner(appDb);
    const expiredAt = new Date(Date.now() - 60_000);
    const futureAt = new Date(Date.now() + 60_000);

    const { expiredJob, futureJob } = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:test" },
      async (scopedDb) => {
        const expiredJob = await repository.createJob(scopedDb, ids.userA);
        const futureJob = await repository.createJob(scopedDb, ids.userA);
        await repository.completeJob(scopedDb, expiredJob.id, new Date(), expiredAt);
        await repository.completeJob(scopedDb, futureJob.id, new Date(), futureAt);
        return { expiredJob, futureJob };
      }
    );

    const workerClient = new Client({ connectionString: connectionStrings.worker });
    await workerClient.connect();
    try {
      await expect(workerClient.query("SELECT id FROM app.data_export_jobs")).rejects.toThrow(
        /permission denied|violates row-level security|policy/i
      );

      const result = await workerClient.query<{
        id: string;
        ownerUserId: string;
        format: string;
      }>("SELECT * FROM app.list_expired_data_export_jobs(now())");

      expect(result.rows).toContainEqual({
        id: expiredJob.id,
        ownerUserId: ids.userA,
        format: "json"
      });
      expect(result.rows).not.toContainEqual({
        id: futureJob.id,
        ownerUserId: ids.userA,
        format: "json"
      });
    } finally {
      await workerClient.end();
    }

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:test" },
      async (scopedDb) => {
        expect((await repository.getJobById(scopedDb, expiredJob.id))?.status).toBe("ready");
        expect((await repository.getJobById(scopedDb, futureJob.id))?.status).toBe("ready");
      }
    );
  });

  it("schedules data export cleanup with a metadata-only payload", async () => {
    const { EXPORT_CLEANUP_CRON, reconcileDataExportCleanupSchedule } =
      await import("../../packages/settings/src/data-export-schedule.js");
    const { EXPORT_CLEANUP_QUEUE } =
      await import("../../packages/settings/src/data-export-jobs.js");
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule };

    await reconcileDataExportCleanupSchedule(boss as never);

    expect(schedule).toHaveBeenCalledWith(
      EXPORT_CLEANUP_QUEUE,
      EXPORT_CLEANUP_CRON,
      { kind: "export.cleanup" },
      { tz: "UTC", key: "data-export-cleanup" }
    );
  });

  it("deletes expired export vault files before marking rows expired", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "jarvis-export-cleanup-"));
    const originalVaultRoot = process.env.JARVIS_VAULT_ROOT;
    process.env.JARVIS_VAULT_ROOT = vaultRoot;
    try {
      const { handleExportCleanupJob } =
        await import("../../packages/settings/src/data-export-jobs.js");
      const repository = new (
        await import("../../packages/settings/src/data-export-repository.js")
      ).DataExportRepository();
      const dataContext = new DataContextRunner(appDb);
      const expiresAt = new Date(Date.now() - 60_000);
      const jobRecord = await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          const jobRecord = await repository.createJob(scopedDb, ids.userA);
          await repository.completeJob(scopedDb, jobRecord.id, new Date(), expiresAt);
          return jobRecord;
        }
      );

      const vaultRunner = new VaultContextRunner(vaultRoot);
      await vaultRunner.withVaultContext({ actorUserId: ids.userA }, (vaultCtx) =>
        writeVaultFile(vaultCtx, `exports/${jobRecord.id}.json`, "{}")
      );

      await handleExportCleanupJob(
        { data: { kind: "export.cleanup" } } as never,
        workerDb,
        dataContext
      );

      await vaultRunner.withVaultContext({ actorUserId: ids.userA }, async (vaultCtx) => {
        await expect(readVaultFile(vaultCtx, `exports/${jobRecord.id}.json`)).rejects.toThrow();
      });
      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          expect((await repository.getJobById(scopedDb, jobRecord.id))?.status).toBe("expired");
        }
      );
    } finally {
      if (originalVaultRoot === undefined) delete process.env.JARVIS_VAULT_ROOT;
      else process.env.JARVIS_VAULT_ROOT = originalVaultRoot;
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("marks expired export rows cleaned when the vault file is already missing", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "jarvis-export-cleanup-"));
    const originalVaultRoot = process.env.JARVIS_VAULT_ROOT;
    process.env.JARVIS_VAULT_ROOT = vaultRoot;
    try {
      const { handleExportCleanupJob } =
        await import("../../packages/settings/src/data-export-jobs.js");
      const repository = new (
        await import("../../packages/settings/src/data-export-repository.js")
      ).DataExportRepository();
      const dataContext = new DataContextRunner(appDb);
      const jobRecord = await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          const jobRecord = await repository.createJob(scopedDb, ids.userA);
          await repository.completeJob(
            scopedDb,
            jobRecord.id,
            new Date(),
            new Date(Date.now() - 60_000)
          );
          return jobRecord;
        }
      );

      await handleExportCleanupJob(
        { data: { kind: "export.cleanup" } } as never,
        workerDb,
        dataContext
      );

      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          expect((await repository.getJobById(scopedDb, jobRecord.id))?.status).toBe("expired");
        }
      );
    } finally {
      if (originalVaultRoot === undefined) delete process.env.JARVIS_VAULT_ROOT;
      else process.env.JARVIS_VAULT_ROOT = originalVaultRoot;
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("keeps an expired export row ready when vault deletion fails", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "jarvis-export-cleanup-"));
    const originalVaultRoot = process.env.JARVIS_VAULT_ROOT;
    process.env.JARVIS_VAULT_ROOT = vaultRoot;
    try {
      const { mkdir } = await import("node:fs/promises");
      const { handleExportCleanupJob } =
        await import("../../packages/settings/src/data-export-jobs.js");
      const repository = new (
        await import("../../packages/settings/src/data-export-repository.js")
      ).DataExportRepository();
      const dataContext = new DataContextRunner(appDb);
      const jobRecord = await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          const jobRecord = await repository.createJob(scopedDb, ids.userA);
          await repository.completeJob(
            scopedDb,
            jobRecord.id,
            new Date(),
            new Date(Date.now() - 60_000)
          );
          return jobRecord;
        }
      );

      const vaultRunner = new VaultContextRunner(vaultRoot);
      await vaultRunner.withVaultContext({ actorUserId: ids.userA }, async (vaultCtx) => {
        await mkdir(join(vaultCtx.vaultRoot, "exports", `${jobRecord.id}.json`), {
          recursive: true
        });
      });

      await expect(
        handleExportCleanupJob({ data: { kind: "export.cleanup" } } as never, workerDb, dataContext)
      ).rejects.toThrow();

      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:test" },
        async (scopedDb) => {
          expect((await repository.getJobById(scopedDb, jobRecord.id))?.status).toBe("ready");
        }
      );
    } finally {
      if (originalVaultRoot === undefined) delete process.env.JARVIS_VAULT_ROOT;
      else process.env.JARVIS_VAULT_ROOT = originalVaultRoot;
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
