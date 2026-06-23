import { realpath } from "node:fs/promises";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getNotesLastSyncRouteSchema,
  getNotesSourceRouteSchema,
  putNotesSourceRouteSchema,
  type GetNotesLastSyncResponse,
  type GetNotesSourceResponse,
  type NotesLastSyncStats,
  type PutNotesSourceRequest
} from "@jarv1s/shared";

import { HttpError } from "@jarv1s/module-sdk";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

export const NOTES_SOURCE_PREFERENCE_KEY = "notes-source-path";
export const NOTES_LAST_SYNC_PREFERENCE_KEY = "notes-last-sync";

/**
 * Schedule-reconcile hook (#449). Injected by the composition root (it lives in
 * `@jarv1s/notes` and depends on `@jarv1s/settings` for `resolveNotesRoots`, so
 * `@jarv1s/settings` cannot import it back without a cycle). Settings calls only
 * this shape; the wiring is inverted. Best-effort: implementations swallow errors.
 */
export type ReconcileNotesScheduleFn = (actorUserId: string, hasPath: boolean) => Promise<void>;

interface NotesSourceRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
  /** Optional: enables the 15-min heartbeat schedule reconcile (#449). */
  readonly reconcileNotesSchedule?: ReconcileNotesScheduleFn;
}

export function resolveNotesRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env["JARVIS_NOTES_ROOTS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Best-effort per-actor schedule reconcile. Wrapped so a missing hook (boss not
 * wired) is a no-op and a throwing hook (pg-boss hiccup) never poisons a
 * successful preference write — the schedule self-heals on the next PUT.
 */
async function reconcileSchedule(
  fn: ReconcileNotesScheduleFn | undefined,
  actorUserId: string,
  hasPath: boolean
): Promise<void> {
  if (!fn) return;
  try {
    await fn(actorUserId, hasPath);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "notes_schedule_reconcile_failed",
        actorUserId,
        hasPath,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
  }
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
            dependencies.preferencesRepository.upsert(scopedDb, NOTES_SOURCE_PREFERENCE_KEY, null)
          );
          await reconcileSchedule(
            dependencies.reconcileNotesSchedule,
            accessContext.actorUserId,
            false
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
            // #449: persist the raw user input, not the resolved realpath. The
            // worker re-`realpath`s AND re-validates against allowed roots on
            // every run (jobs.ts), so storing the raw path has no TOCTOU hole —
            // and it preserves symlink semantics: a user can point the source at
            // a symlink and atomically repoint it later without re-saving.
            // Storing the resolved target instead would pin the old directory.
            providedPath
          )
        );
        await reconcileSchedule(
          dependencies.reconcileNotesSchedule,
          accessContext.actorUserId,
          true
        );
        return reply.send({ path: providedPath } satisfies GetNotesSourceResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/me/notes-last-sync",
    { schema: getNotesLastSyncRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, NOTES_LAST_SYNC_PREFERENCE_KEY)
        );
        // Normalize the stored JSONB into the response shape. `null` (no pref row)
        // and a missing `at` both surface as `lastSync: null` so the UI can render
        // "never synced" cleanly.
        if (!raw || typeof raw !== "object") {
          return reply.send({ lastSync: null } satisfies GetNotesLastSyncResponse);
        }
        const row = raw as Partial<NotesLastSyncStats>;
        if (typeof row.at !== "string") {
          return reply.send({ lastSync: null } satisfies GetNotesLastSyncResponse);
        }
        return reply.send({
          lastSync: {
            at: row.at,
            ingested: typeof row.ingested === "number" ? row.ingested : 0,
            skipped: typeof row.skipped === "number" ? row.skipped : 0,
            errors: typeof row.errors === "number" ? row.errors : 0,
            ...(typeof row.lastError === "string" ? { lastError: row.lastError } : {})
          }
        } satisfies GetNotesLastSyncResponse);
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}
