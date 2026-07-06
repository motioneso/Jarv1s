// Wellness selective export route (#484): POST /api/wellness/export.
//
// Creates an export job row (format='html', params={from,to,categories}) and enqueues a
// metadata-only wellness-export job. Status + download + expiry reuse the existing
// /api/me/export/* routes. Owner-scoped throughout; audit metadata-only.

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { PgBoss } from "@jarv1s/jobs";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import { wellnessExportRequestSchema, type WellnessExportCategory } from "@jarv1s/shared";

import { enqueueWellnessExportJob } from "./export-job.js";
import { DataExportRepository } from "./data-export-port.js";

export interface WellnessExportRoutesDependencies {
  readonly boss: PgBoss;
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
}

const MAX_RANGE_DAYS = 366;

export function registerWellnessExportRoutes(
  server: FastifyInstance,
  dependencies: WellnessExportRoutesDependencies
): void {
  const repository = new DataExportRepository();

  server.post(
    "/api/wellness/export",
    { schema: { body: wellnessExportRequestSchema } },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { from, to, categories } = parseExportBody(request.body);

        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            // Reuse an existing pending/building HTML export for this owner (avoid duplicates) —
            // but only when it was requested with the same window/categories. A second request
            // with different params while one is still pending must not silently return the
            // stale selection (#772); surface the conflict instead.
            const existing = await repository.findActiveJobForUser(
              scopedDb,
              accessContext.actorUserId,
              "html"
            );
            if (existing) {
              if (exportParamsMatch(existing.params, { from, to, categories })) {
                return { jobId: existing.id, status: existing.status };
              }
              throw new HttpError(
                409,
                "An export is already in progress with different parameters. Wait for it to finish before starting a new one."
              );
            }

            const job = await repository.createJob(scopedDb, accessContext.actorUserId, "html", {
              from,
              to,
              categories: [...categories]
            });
            await enqueueWellnessExportJob(dependencies.boss, accessContext.actorUserId, job.id);
            return { jobId: job.id, status: job.status };
          }
        );

        return reply.code(202).send(result);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

// Exported params are re-read from the pending job row (JSON column) and compared against the
// newly requested window/categories. Order-independent on categories.
function exportParamsMatch(
  existingParams: Record<string, unknown> | null,
  requested: {
    readonly from: string;
    readonly to: string;
    readonly categories: readonly WellnessExportCategory[];
  }
): boolean {
  if (!existingParams) return false;
  if (existingParams["from"] !== requested.from || existingParams["to"] !== requested.to) {
    return false;
  }
  const existingCategories = existingParams["categories"];
  if (!Array.isArray(existingCategories)) return false;
  const a = [...existingCategories].sort();
  const b = [...requested.categories].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseExportBody(body: unknown): {
  readonly from: string;
  readonly to: string;
  readonly categories: readonly WellnessExportCategory[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected JSON object body");
  }
  const value = body as Record<string, unknown>;
  const from = value["from"];
  const to = value["to"];
  if (typeof from !== "string" || typeof to !== "string") {
    throw new HttpError(400, "from and to are required");
  }
  // Range sanity (inclusive): from <= to, bounded to a sane window.
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new HttpError(400, "from and to must be valid dates");
  }
  if (fromDate.getTime() > toDate.getTime()) {
    throw new HttpError(400, "from must be on or before to");
  }
  const rangeDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new HttpError(400, `Date range must be at most ${MAX_RANGE_DAYS} days`);
  }
  const categories = value["categories"];
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new HttpError(400, "categories must be a non-empty array");
  }
  return { from, to, categories: categories as WellnessExportCategory[] };
}
