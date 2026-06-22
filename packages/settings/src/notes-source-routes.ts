import { realpath } from "node:fs/promises";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getNotesSourceRouteSchema,
  putNotesSourceRouteSchema,
  type GetNotesSourceResponse,
  type PutNotesSourceRequest
} from "@jarv1s/shared";

import { HttpError } from "@jarv1s/module-sdk";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

export const NOTES_SOURCE_PREFERENCE_KEY = "notes-source-path";

interface NotesSourceRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function resolveNotesRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env["JARVIS_NOTES_ROOTS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerNotesSourceRoutes(
  server: FastifyInstance,
  dependencies: NotesSourceRoutesDependencies
): void {
  server.get(
    "/api/me/notes-source",
    { schema: getNotesSourceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY)
        );
        const path = typeof raw === "string" ? raw : null;
        return reply.send({ path } satisfies GetNotesSourceResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/me/notes-source",
    { schema: putNotesSourceRouteSchema },
    async (request, reply) => {
      try {
        const body = request.body as PutNotesSourceRequest | null;
        const providedPath = (body as { path?: string | null } | null)?.path ?? null;

        if (providedPath === null) {
          const accessContext = await dependencies.resolveAccessContext(request);
          await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
            dependencies.preferencesRepository.upsert(
              scopedDb,
              NOTES_SOURCE_PREFERENCE_KEY,
              null
            )
          );
          return reply.send({ path: null } satisfies GetNotesSourceResponse);
        }

        const allowedRoots = resolveNotesRoots();
        if (allowedRoots.length === 0) {
          throw new HttpError(503, "Notes roots not configured on this server");
        }

        let resolvedPath: string;
        try {
          resolvedPath = await realpath(providedPath);
        } catch {
          throw new HttpError(400, "Path does not exist or cannot be resolved");
        }

        const allowed = allowedRoots.some(
          (root) => resolvedPath === root || resolvedPath.startsWith(root + "/")
        );
        if (!allowed) {
          throw new HttpError(400, "Path is not within an allowed notes root");
        }

        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(
            scopedDb,
            NOTES_SOURCE_PREFERENCE_KEY,
            providedPath
          )
        );
        return reply.send({ path: providedPath } satisfies GetNotesSourceResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}
