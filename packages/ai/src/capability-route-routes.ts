import type { FastifyInstance, FastifyReply } from "fastify";

import type { DataContextDb } from "@jarv1s/db";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  listAiCapabilityRoutesRouteSchema,
  lookupAiCapabilityRouteRouteSchema,
  putAiCapabilityRouteRouteSchema,
  type AiConfiguredModelDto,
  type AiModelCapability,
  type PutAiCapabilityRouteRequest
} from "@jarv1s/shared";

import type { AiConfiguredModelSafeRow, AiRepository } from "./repository.js";
import type { AiRoutesDependencies } from "./routes.js";

type CapabilityParams = { readonly capability: string };

const MODEL_CAPABILITIES = new Set<AiModelCapability>([
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
]);

export function registerAiCapabilityRouteRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository
): void {
  server.get<{ Params: CapabilityParams }>(
    "/api/ai/capability-route/:capability",
    { schema: lookupAiCapabilityRouteRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const capability = parseCapability(request.params.capability);
        const route = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.resolveModelForCapability(scopedDb, capability)
        );

        return {
          route: {
            capability,
            available: Boolean(route.model),
            reason: route.reason,
            model: route.model ? serializeModel(route.model) : null
          }
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/ai/capability-routes",
    { schema: listAiCapabilityRoutesRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const routes = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listCapabilityRoutes(scopedDb)
        );

        return { routes };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put<{ Params: CapabilityParams }>(
    "/api/ai/capability-routes/:capability",
    { schema: putAiCapabilityRouteRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const capability = parseCapability(request.params.capability);
        const body = parsePutCapabilityRouteBody(request.body);

        await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
          await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);

          if (body.modelId !== null) {
            const models = await repository.listModels(scopedDb);
            const valid = models.some(
              (model) =>
                model.id === body.modelId &&
                model.status === "active" &&
                model.provider_status === "active" &&
                model.capabilities.includes(capability)
            );

            if (!valid) {
              throw new HttpError(400, "modelId must reference an active compatible model");
            }
          }

          await repository.setCapabilityRoute(scopedDb, {
            capability,
            modelId: body.modelId,
            actorUserId: accessContext.actorUserId
          });
        });

        return { route: { capability, modelId: body.modelId } };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parsePutCapabilityRouteBody(body: unknown): PutAiCapabilityRouteRequest {
  const value = requireObject(body);
  const modelId = value.modelId;
  if (modelId !== null && typeof modelId !== "string") {
    throw new HttpError(400, "modelId must be a string or null");
  }

  return { modelId };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function parseCapability(value: string): AiModelCapability {
  if (MODEL_CAPABILITIES.has(value as AiModelCapability)) {
    return value as AiModelCapability;
  }

  throw new HttpError(400, "capability is not supported");
}

function serializeModel(model: AiConfiguredModelSafeRow): AiConfiguredModelDto {
  return {
    id: model.id,
    providerConfigId: model.provider_config_id,
    providerKind: model.provider_kind,
    providerDisplayName: model.provider_display_name,
    providerStatus: model.provider_status,
    providerModelId: model.provider_model_id,
    displayName: model.display_name,
    capabilities: model.capabilities.map(parseCapability),
    status: model.status,
    tier: model.tier,
    allowUserOverride: model.allow_user_override,
    createdAt: serializeDate(model.created_at),
    updatedAt: serializeDate(model.updated_at)
  };
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  return handleModuleRouteError(error, reply, {
    invalidRequestMessage: "AI configuration request is invalid"
  });
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
