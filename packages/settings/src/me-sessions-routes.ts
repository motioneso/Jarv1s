import type { IncomingHttpHeaders } from "node:http";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext } from "@jarv1s/db";
import {
  listMySessionsRouteSchema,
  revokeMyOtherSessionsRouteSchema,
  revokeMySessionRouteSchema,
  type MeSessionDto
} from "@jarv1s/shared";
import { HttpError } from "@jarv1s/module-sdk";

import { handleSettingsRouteError } from "./route-error.js";

export interface MeSessionRevokeResult {
  /** True when a session owned by the actor was deleted. */
  readonly revoked: boolean;
  /** True when the targeted id is the request's own current session (delete refused). */
  readonly wasCurrent: boolean;
}

/**
 * Auth-owned port for current-user session management. The concrete implementation lives in
 * the auth boundary (`@jarv1s/auth`) and is the ONLY code that touches the session tables;
 * settings routes depend on this port and never hand-write auth-table queries with a root DB
 * handle (#237). Implementations MUST scope every read/write to the actor's `user_id`, never
 * select or expose the session token, and resolve the current session from the request headers.
 */
export interface MeSessionsService {
  list(input: {
    readonly actorUserId: string;
    readonly headers: IncomingHttpHeaders;
  }): Promise<readonly MeSessionDto[]>;
  revokeOne(input: {
    readonly actorUserId: string;
    readonly sessionId: string;
    readonly headers: IncomingHttpHeaders;
  }): Promise<MeSessionRevokeResult>;
  revokeOthers(input: {
    readonly actorUserId: string;
    readonly headers: IncomingHttpHeaders;
  }): Promise<number>;
}

interface MeSessionsRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  /** Absent in deployments without an auth runtime (e.g. some tests) — routes then 404. */
  readonly meSessions?: MeSessionsService;
}

export function registerMeSessionsRoutes(
  server: FastifyInstance,
  dependencies: MeSessionsRoutesDependencies
): void {
  function requireService(): MeSessionsService {
    if (!dependencies.meSessions) {
      throw new HttpError(404, "Session management is not available");
    }
    return dependencies.meSessions;
  }

  server.get("/api/me/sessions", { schema: listMySessionsRouteSchema }, async (request, reply) => {
    try {
      const service = requireService();
      const accessContext = await dependencies.resolveAccessContext(request);
      const sessions = await service.list({
        actorUserId: accessContext.actorUserId,
        headers: request.headers
      });
      return { sessions };
    } catch (error) {
      return handleSettingsRouteError(error, reply);
    }
  });

  // Static route registered before the parametric one so "others" can never be captured as :id.
  server.delete(
    "/api/me/sessions/others",
    { schema: revokeMyOtherSessionsRouteSchema },
    async (request, reply) => {
      try {
        const service = requireService();
        const accessContext = await dependencies.resolveAccessContext(request);
        const count = await service.revokeOthers({
          actorUserId: accessContext.actorUserId,
          headers: request.headers
        });
        return { success: true, count };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/api/me/sessions/:id",
    { schema: revokeMySessionRouteSchema },
    async (request, reply) => {
      try {
        const service = requireService();
        const accessContext = await dependencies.resolveAccessContext(request);
        const result = await service.revokeOne({
          actorUserId: accessContext.actorUserId,
          sessionId: request.params.id,
          headers: request.headers
        });
        // Refuse to sign out the current session through this surface (spec §3) — the client
        // uses the dedicated sign-out path for that.
        if (result.wasCurrent) {
          throw new HttpError(422, "Cannot revoke the current session here; use sign out");
        }
        // A miss is reported as 404 whether the id is unknown OR owned by another user, so a
        // caller cannot probe for another user's session id (no existence leak, #237).
        if (!result.revoked) {
          throw new HttpError(404, "Session not found");
        }
        return { success: true };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}
