import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import { getHostDiagnosticsRouteSchema, type ChatMultiplexerAvailability } from "@jarv1s/shared";

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
        const { dbOk, multiplexer } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
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
            return { dbOk: ok, multiplexer: mux };
          }
        );

        // hostDiagnostics is guaranteed defined here (the closure throws otherwise).
        const provider = dependencies.hostDiagnostics as HostDiagnosticsProvider;
        const pgBossOk = await provider.pgBossInstalled().catch(() => false);

        return buildHostDiagnostics({
          info: provider.info(),
          multiplexer,
          available: dependencies.chatMultiplexerAvailability ?? { tmux: false, herdr: false },
          dbOk,
          pgBossOk
        });
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );
}
