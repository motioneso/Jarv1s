import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import {
  getHostDiagnosticsRouteSchema,
  postHostRestartRouteSchema,
  postInstallHerdrRouteSchema,
  type ChatMultiplexerAvailability
} from "@jarv1s/shared";

import { buildHostDiagnostics, type HostDiagnosticsProvider } from "./host-diagnostics.js";
import type { SettingsRepository } from "./repository.js";

export interface HostDiagnosticsRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly repository: SettingsRepository;
  /** Boot-time multiplexer availability snapshot (same one the chat-multiplexer route echoes). */
  readonly chatMultiplexerAvailability?: ChatMultiplexerAvailability;
  /** Runtime-facts provider; injected by the composition root. Absent → 503. */
  readonly hostDiagnostics?: HostDiagnosticsProvider;
  readonly requestRestart?: () => void | Promise<void>;
  readonly installHerdr?: () => void | Promise<void>;
  readonly assertAdminUser: (scopedDb: DataContextDb, userId: string) => Promise<User>;
  readonly handleRouteError: (error: unknown, reply: FastifyReply) => unknown;
}

/**
 * GET /api/admin/host/diagnostics — admin-only, read-only, secret-safe (#255).
 *
 * The admin check and the DB connectivity probe share ONE transaction (the
 * established settings pattern). The response is built only from explicit,
 * allowlisted, non-secret fields by buildHostDiagnostics — no env/config/process
 * dump — and that builder also runs assertDiagnosticsSafe as a final guard.
 */
export function registerHostDiagnosticsRoutes(
  server: FastifyInstance,
  dependencies: HostDiagnosticsRoutesDependencies
): void {
  server.get(
    "/api/admin/host/diagnostics",
    { schema: getHostDiagnosticsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { dbOk, multiplexer, latestAvailableVersion, releaseNotes } =
          await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
            await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
            // Authorization passed — only now is it safe to surface the 503 if the
            // provider is missing, so a non-admin can never distinguish the states.
            if (!dependencies.hostDiagnostics) {
              throw new HttpError(503, "Host diagnostics are not available");
            }
            let ok = true;
            try {
              await dependencies.repository.pingDatabase(scopedDb);
            } catch {
              ok = false;
            }
            const { multiplexer: mux } =
              await dependencies.repository.getChatMultiplexerSetting(scopedDb);

            const latestReleaseRaw = await scopedDb.db
              .selectFrom("app.instance_settings")
              .select("value")
              .where("key", "=", "latest_release")
              .executeTakeFirst();

            let latestAvailableVersion: string | null = null;
            let releaseNotes: string | null = null;

            if (latestReleaseRaw?.value) {
              const val = latestReleaseRaw.value as Record<string, unknown>;
              if (typeof val.version === "string") latestAvailableVersion = val.version;
              if (typeof val.notes === "string") releaseNotes = val.notes;
            }

            return { dbOk: ok, multiplexer: mux, latestAvailableVersion, releaseNotes };
          });

        // hostDiagnostics is guaranteed defined here (the closure throws otherwise).
        const provider = dependencies.hostDiagnostics as HostDiagnosticsProvider;
        const pgBossOk = await provider.pgBossInstalled().catch(() => false);

        return buildHostDiagnostics({
          info: provider.info(),
          multiplexer,
          available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false },
          dbOk,
          pgBossOk,
          latestAvailableVersion,
          releaseNotes
        });
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/admin/host/restart",
    { schema: postHostRestartRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
        });
        if (!dependencies.requestRestart) {
          throw new HttpError(503, "Restart is not available");
        }
        await dependencies.requestRestart();
        return { accepted: true };
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/admin/host/herdr/install",
    { schema: postInstallHerdrRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
        });
        if (!dependencies.installHerdr) {
          throw new HttpError(503, "Herdr installation is not available");
        }
        await dependencies.installHerdr();
        return { installed: true };
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );
}
