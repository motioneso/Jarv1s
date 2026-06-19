import type { FastifyInstance } from "fastify";

import {
  getAiSummaryRouteSchema,
  listAiConfiguredModelsRouteSchema,
  listAiProviderConfigsRouteSchema
} from "@jarv1s/shared";

import type { AiRepository } from "./repository.js";
import type { AiRoutesDependencies } from "./routes.js";
import {
  assertInstanceAdmin,
  handleRouteError,
  serializeModel,
  serializeProvider
} from "./routes.js";

export function registerProviderVisibilityRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository
): void {
  server.get("/api/ai/summary", { schema: getAiSummaryRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const [hasPersonalAiProvider, defaultChatModel] =
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          Promise.all([
            repository.hasPersonalProvider(scopedDb, accessContext.actorUserId),
            repository.selectModelForCapability(scopedDb, "chat")
          ])
        );

      return {
        summary: {
          hasPersonalAiProvider,
          sharedAssistantAvailable: defaultChatModel !== undefined
        }
      };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.get(
    "/api/ai/providers",
    { schema: listAiProviderConfigsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const providers = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
            return repository.listProviders(scopedDb);
          }
        );

        return { providers: await Promise.all(providers.map(serializeProvider)) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/ai/models",
    { schema: listAiConfiguredModelsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const models = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
            return repository.listModels(scopedDb);
          }
        );

        return { models: models.map((m) => serializeModel(m, accessContext.actorUserId)) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
