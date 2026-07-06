import type { FastifyInstance, FastifyReply } from "fastify";

import type { DataContextDb } from "@jarv1s/db";
import { HttpError, handleRouteError as handleModuleRouteError } from "@jarv1s/module-sdk";
import {
  AI_MODEL_CAPABILITIES,
  listAiCapabilityRoutesRouteSchema,
  lookupAiCapabilityRouteRouteSchema,
  putAiCapabilityRouteRouteSchema,
  type AiModelCapability,
  type PutAiCapabilityRouteRequest
} from "@jarv1s/shared";

import type { AiRepository } from "./repository.js";
import { type AiRoutesDependencies, serializeModel } from "./routes.js";

type CapabilityParams = { readonly capability: string };

const MODEL_CAPABILITIES = new Set<AiModelCapability>(AI_MODEL_CAPABILITIES);

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
            model: route.model ? serializeModel(route.model, accessContext.actorUserId) : null
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

/** Shared by transcription-routes.ts so both routes recognize exactly the same capability set. */
export function parseCapability(value: string): AiModelCapability {
  if (MODEL_CAPABILITIES.has(value as AiModelCapability)) {
    return value as AiModelCapability;
  }

  throw new HttpError(400, "capability is not supported");
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
