import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import {
  deleteWebSearchKeyRouteSchema,
  getWebSearchKeyRouteSchema,
  putWebSearchKeyRouteSchema,
  type PutWebSearchKeyRequest,
  type WebSearchKeyStatusDto
} from "@jarv1s/shared";

import type { SettingsRepository } from "./repository.js";
import { handleSettingsRouteError } from "./route-error.js";
import {
  clearBraveSearchApiKey,
  getWebSearchKeyConfig,
  setBraveSearchApiKey,
  type WebSearchSecretCipher
} from "./web-search-key.js";

export interface WebSearchKeyRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly repository: SettingsRepository;
  readonly cipher: WebSearchSecretCipher;
  /** Optional hook fired after a save/revoke so the provider cache can be invalidated. */
  readonly onKeyChanged?: () => void;
}

function requireRequestId(accessContext: AccessContext): string {
  if (!accessContext.requestId) {
    throw new HttpError(500, "Request id is missing");
  }
  return accessContext.requestId;
}

async function assertAdmin(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  userId: string
): Promise<void> {
  const user = await repository.getUserById(scopedDb, userId);
  if (!user) {
    throw new HttpError(401, "Session is missing or expired");
  }
  if (!user.is_instance_admin) {
    throw new HttpError(403, "Instance admin permission is required");
  }
}

/**
 * Admin-only routes for the instance-wide Brave Search API key. The key is AES-256-GCM
 * encrypted at rest and never returned — GET/PUT/DELETE all respond with `{ status: { configured,
 * source } }` only. Admin is asserted inside the same `withDataContext` transaction as the read/
 * write (RLS also gates instance_settings writes to admins as defense in depth).
 */
export function registerWebSearchKeyRoutes(
  server: FastifyInstance,
  dependencies: WebSearchKeyRoutesDependencies
): void {
  const { dataContext, resolveAccessContext, repository, cipher } = dependencies;

  server.get(
    "/api/admin/settings/web-search",
    { schema: getWebSearchKeyRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await resolveAccessContext(request);
        const status = await dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdmin(repository, scopedDb, accessContext.actorUserId);
          return getWebSearchKeyConfig(scopedDb);
        });
        return { status: status satisfies WebSearchKeyStatusDto };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/admin/settings/web-search",
    { schema: putWebSearchKeyRouteSchema },
    async (request, reply) => {
      try {
        const body = request.body as PutWebSearchKeyRequest;
        const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        if (apiKey.length === 0) {
          return reply.status(400).send({ error: "API key must not be empty" });
        }
        const accessContext = await resolveAccessContext(request);
        const status = await dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdmin(repository, scopedDb, accessContext.actorUserId);
          await setBraveSearchApiKey(scopedDb, repository, cipher, {
            apiKey,
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
          return getWebSearchKeyConfig(scopedDb);
        });
        dependencies.onKeyChanged?.();
        return { status: status satisfies WebSearchKeyStatusDto };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.delete(
    "/api/admin/settings/web-search",
    { schema: deleteWebSearchKeyRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await resolveAccessContext(request);
        const status = await dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertAdmin(repository, scopedDb, accessContext.actorUserId);
          await clearBraveSearchApiKey(scopedDb, repository, {
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
          return getWebSearchKeyConfig(scopedDb);
        });
        dependencies.onKeyChanged?.();
        return { status: status satisfies WebSearchKeyStatusDto };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}
