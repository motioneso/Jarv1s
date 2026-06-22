import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { sendJob } from "@jarv1s/jobs";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import { postNotesSyncRouteSchema, type PostNotesSyncResponse } from "@jarv1s/shared";
import type { PreferencesRepository } from "@jarv1s/structured-state";

import { NOTES_SOURCE_PREFERENCE_KEY } from "@jarv1s/settings";
import { NOTES_SYNC_QUEUE } from "./manifest.js";
import type { NotesSyncJobPayload } from "./jobs.js";

interface NotesSyncRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: PreferencesRepository;
  readonly boss: PgBoss;
}

export function registerNotesSyncRoutes(
  server: FastifyInstance,
  dependencies: NotesSyncRoutesDependencies
): void {
  server.post(
    "/api/notes/sync",
    { schema: postNotesSyncRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);

        const storedPath = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) =>
            dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
        );

        if (typeof storedPath !== "string" || storedPath.length === 0) {
          throw new HttpError(409, "No notes source configured. Set a path via PUT /api/me/notes-source first.");
        }

        const payload: NotesSyncJobPayload = {
          actorUserId: accessContext.actorUserId,
          sourcePath: storedPath
        };

        const jobId = await sendJob(dependencies.boss, NOTES_SYNC_QUEUE, payload, {
          singletonKey: `notes-sync:${accessContext.actorUserId}`
        });

        return reply.code(202).send({
          jobId: jobId ?? ""
        } satisfies PostNotesSyncResponse);
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
