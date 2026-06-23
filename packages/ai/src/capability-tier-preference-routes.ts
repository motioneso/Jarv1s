import type { FastifyInstance } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import {
  listAiCapabilityTierPreferencesRouteSchema,
  patchAiCapabilityTierPreferenceRouteSchema,
  type PatchAiCapabilityTierPreferenceRequest
} from "@jarv1s/shared";

import type { AiRepository } from "./repository.js";
import type { AiRoutesDependencies } from "./routes.js";

export function registerCapabilityTierPreferenceRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository
): void {
  server.get(
    "/api/ai/capability-tier-preferences",
    { schema: listAiCapabilityTierPreferencesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const preferences = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.listCapabilityTierPreferences(scopedDb)
        );
        return { preferences };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch(
    "/api/ai/capability-tier-preferences",
    { schema: patchAiCapabilityTierPreferenceRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PatchAiCapabilityTierPreferenceRequest;
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.setCapabilityTierPreference(scopedDb, body.capability, body.tier)
        );
        return reply.code(204).send();
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
