import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  discoverAiProviderModelsRouteSchema,
  testAiProviderConfigRouteSchema
} from "@jarv1s/shared";

import type { AiSecretCipher } from "./crypto.js";
import { discoverProviderModels, testProviderCredential } from "./provider-validation.js";
import type { AiRepository } from "./repository.js";

interface IdParams {
  readonly id: string;
}

export interface AiProviderValidationRouteDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository: AiRepository;
  readonly secretCipher: AiSecretCipher;
}

export function registerAiProviderValidationRoutes(
  server: FastifyInstance,
  dependencies: AiProviderValidationRouteDependencies
): void {
  server.post<{ Params: IdParams }>(
    "/api/ai/providers/:id/test",
    { schema: testAiProviderConfigRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const provider = await loadTestableProvider(
              dependencies,
              scopedDb,
              accessContext,
              request.params.id
            );
            return testProviderCredential({
              providerKind: provider.provider_kind,
              authMethod: provider.auth_method,
              baseUrl: provider.base_url,
              credential: dependencies.secretCipher.decryptJson(provider.encrypted_credential)
            });
          }
        );

        return { result };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: IdParams }>(
    "/api/ai/providers/:id/discover-models",
    { schema: discoverAiProviderModelsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const models = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const provider = await loadTestableProvider(
              dependencies,
              scopedDb,
              accessContext,
              request.params.id
            );
            return discoverProviderModels({
              providerKind: provider.provider_kind,
              authMethod: provider.auth_method,
              baseUrl: provider.base_url,
              credential: dependencies.secretCipher.decryptJson(provider.encrypted_credential)
            });
          }
        );

        return { models };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

async function loadTestableProvider(
  dependencies: AiProviderValidationRouteDependencies,
  scopedDb: DataContextDb,
  accessContext: AccessContext,
  providerId: string
) {
  await assertInstanceAdmin(dependencies.repository, scopedDb, accessContext.actorUserId);
  const provider = await dependencies.repository.selectProviderWithCredential(scopedDb, providerId);
  if (!provider) {
    throw new HttpError(404, "AI provider config not found");
  }
  if (provider.status === "revoked") {
    throw new HttpError(400, "AI provider config is revoked");
  }
  return provider;
}

async function assertInstanceAdmin(
  repository: AiRepository,
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

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    invalidRequestMessage: "AI configuration request is invalid"
  });
}
