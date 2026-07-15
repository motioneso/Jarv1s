import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import { postHerdrInstallRouteSchema, type HerdrInstallResultDto } from "@jarv1s/shared";

import type { SettingsRepository } from "./repository.js";
import type { GetChatMultiplexerStatus } from "./routes.js";

/**
 * Fixed-script Herdr install executor port. The composition root wires the real
 * implementation (apps/api/src/herdr-install-port.ts — execFile, argv-only, no
 * request-derived args). Absent ⇒ the route fails closed (503).
 */
export interface HerdrInstallDependencies {
  readonly install: () => Promise<{ ok: boolean; timedOut: boolean }>;
}

export interface HostInstallRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly repository: SettingsRepository;
  readonly getChatMultiplexerStatus?: GetChatMultiplexerStatus;
  readonly herdrInstall?: HerdrInstallDependencies;
  readonly assertAdminUser: (scopedDb: DataContextDb, userId: string) => Promise<User>;
  readonly requireRequestId: (accessContext: AccessContext) => string;
  readonly handleRouteError: (error: unknown, reply: FastifyReply) => unknown;
}

/**
 * POST /api/admin/host/install — admin-only, fixed-script Herdr install (#993).
 *
 * 3-phase: (1) DB-context authorize + read the configured multiplexer, (2) OUTSIDE any
 * DB context run the fixed install executor (exec I/O must never happen inside an open
 * transaction), (3) DB-context write the audit event and derive fresh herdrInstalled
 * status. `state` is strictly installed|failed|timeout — installer stdout/stderr never
 * crosses the process boundary (Locked Decision, spec 2026-07-15-993-host-truth.md).
 */
export function registerHerdrInstallRoutes(
  server: FastifyInstance,
  dependencies: HostInstallRoutesDependencies
): void {
  server.post(
    "/api/admin/host/install",
    { schema: postHerdrInstallRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const requestId = dependencies.requireRequestId(accessContext);

        const { multiplexer } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
            // Authorization passed — only now is it safe to surface the 503 if the
            // port is missing, so a non-admin can never distinguish the states.
            if (!dependencies.herdrInstall) {
              throw new HttpError(503, "Herdr install is not available");
            }
            return dependencies.repository.getChatMultiplexerSetting(scopedDb);
          }
        );

        // herdrInstall is guaranteed defined here (the closure above throws otherwise),
        // and this call is deliberately OUTSIDE any DB context (see host-install-port.ts).
        const { ok, timedOut } = await (
          dependencies.herdrInstall as HerdrInstallDependencies
        ).install();
        const state: HerdrInstallResultDto["state"] = timedOut
          ? "timeout"
          : ok
            ? "installed"
            : "failed";

        const { herdrInstalled } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await dependencies.repository.insertAuditEvent(scopedDb, {
              actorUserId: accessContext.actorUserId,
              action: "host.herdr_install",
              targetType: "host",
              targetId: null,
              metadata: { state },
              requestId
            });
            const status = (await dependencies.getChatMultiplexerStatus?.(multiplexer)) ?? {
              available: { tmux: false, herdr: false },
              herdrInstalled: false,
              active: null,
              activeSource: null,
              envOverride: null
            };
            return { herdrInstalled: status.herdrInstalled };
          }
        );

        const body: HerdrInstallResultDto = { state, herdrInstalled };
        return body;
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );
}
