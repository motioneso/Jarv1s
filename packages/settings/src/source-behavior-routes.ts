import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { handleRouteError } from "@jarv1s/module-sdk";
import {
  listSourceBehaviorsRouteSchema,
  putSourceBehaviorRouteSchema,
  type ListSourceBehaviorsResponse,
  type PutSourceBehaviorRequest
} from "@jarv1s/shared";
import {
  listSourceBehaviorStates,
  setSourceBehaviorOverride,
  type SourceBehaviorPreferencesPort,
  type SourceBehaviorSourceState
} from "@jarv1s/source-behaviors";

interface SourceBehaviorRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listModuleManifests?: () => readonly JarvisModuleManifest[];
  readonly preferencesRepository: SourceBehaviorPreferencesPort;
}

interface BehaviorParams {
  readonly id: string;
}

export function registerSourceBehaviorRoutes(
  server: FastifyInstance,
  dependencies: SourceBehaviorRoutesDependencies
): void {
  server.get(
    "/api/me/source-behaviors",
    { schema: listSourceBehaviorsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const response = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) =>
            toResponse(
              await listSourceBehaviorStates(scopedDb, {
                manifests: dependencies.listModuleManifests?.() ?? [],
                preferencesRepository: dependencies.preferencesRepository
              })
            )
        );
        return response;
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put<{ Params: BehaviorParams; Body: PutSourceBehaviorRequest }>(
    "/api/me/source-behaviors/:id",
    { schema: putSourceBehaviorRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const response = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) =>
            toResponse(
              await setSourceBehaviorOverride(
                scopedDb,
                {
                  manifests: dependencies.listModuleManifests?.() ?? [],
                  preferencesRepository: dependencies.preferencesRepository
                },
                request.params.id,
                request.body.enabled
              )
            )
        );
        return response;
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

function toResponse(sources: readonly SourceBehaviorSourceState[]): ListSourceBehaviorsResponse {
  return {
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description,
      behaviors: source.behaviors.map((behavior) => ({
        id: behavior.id,
        sourceId: source.id,
        name: behavior.name,
        description: behavior.description,
        default: behavior.default,
        enabled: behavior.enabled,
        toggleable: behavior.toggleable
      }))
    }))
  };
}

function handleSettingsRouteError(error: unknown, reply: FastifyReply) {
  return handleRouteError(error, reply, {
    mappers: [
      (e, r) => {
        if (e instanceof Error) {
          const code = (e as Error & { code?: string }).code;
          if (code === "account_pending_approval" || code === "account_deactivated") {
            return r.code(403).send({ error: e.message, code });
          }
        }
        return undefined;
      }
    ]
  });
}
