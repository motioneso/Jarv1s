import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "@jarv1s/jobs";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import { VaultContextRunner, getVaultBaseDir, readVaultFile, deleteVaultFile } from "@jarv1s/vault";

import { enqueueExportBuildJob } from "./data-export-jobs.js";
import { DataExportRepository } from "./data-export-repository.js";

export interface DataExportAsyncRoutesDependencies {
  readonly boss: PgBoss;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
}

export function registerDataExportAsyncRoutes(
  server: FastifyInstance,
  dependencies: DataExportAsyncRoutesDependencies
): void {
  const repository = new DataExportRepository();

  server.post("/api/me/export", async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);

      const result = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const existing = await repository.findActiveJobForUser(
            scopedDb,
            accessContext.actorUserId
          );
          if (existing) {
            return { jobId: existing.id, status: existing.status };
          }

          const job = await repository.createJob(scopedDb, accessContext.actorUserId);
          await enqueueExportBuildJob(dependencies.boss, accessContext.actorUserId, job.id);

          return { jobId: job.id, status: job.status };
        }
      );

      return reply.code(202).send(result);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get("/api/me/export/status/:jobId", async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { jobId } = request.params as { jobId: string };

      const job = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.getJobById(scopedDb, jobId)
      );

      if (!job) {
        throw new HttpError(404, "Export job not found");
      }

      return {
        jobId: job.id,
        status: job.status,
        ...(job.expires_at ? { expiresAt: new Date(job.expires_at).toISOString() } : {}),
        ...(job.error_message ? { errorMessage: job.error_message } : {})
      };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get("/api/me/export/download/:jobId", async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const { jobId } = request.params as { jobId: string };

      const job = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.getJobById(scopedDb, jobId)
      );

      if (!job) {
        throw new HttpError(404, "Export job not found");
      }

      if (job.status !== "ready") {
        throw new HttpError(404, "Export not ready");
      }

      if (job.expires_at && new Date(job.expires_at) < new Date()) {
        const vaultRunner = new VaultContextRunner(getVaultBaseDir());
        const vaultAccessCtx = {
          actorUserId: accessContext.actorUserId,
          requestId: accessContext.requestId
        };
        await vaultRunner.withVaultContext(vaultAccessCtx, async (vaultCtx) => {
          try {
            await deleteVaultFile(vaultCtx, `exports/${jobId}.json`);
          } catch (e) {
            // ignore if already deleted
          }
        });
        throw new HttpError(410, "Export has expired");
      }

      const vaultRunner = new VaultContextRunner(getVaultBaseDir());
      const vaultAccessCtx = {
        actorUserId: accessContext.actorUserId,
        requestId: accessContext.requestId
      };

      const content = await vaultRunner.withVaultContext(vaultAccessCtx, (vaultCtx) =>
        readVaultFile(vaultCtx, `exports/${jobId}.json`)
      );

      const date = new Date().toISOString().slice(0, 10);
      const filename = `jarvis-export-${date}.json`;

      void reply.header("Content-Type", "application/json");
      void reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(content);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });
}
