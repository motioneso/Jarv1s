import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "@jarv1s/settings";
import {
  getAiAdminUserPinRouteSchema,
  putAiAdminUserPinRouteSchema,
  type PutAiAdminUserPinRequest
} from "@jarv1s/shared";
import { HttpError } from "@jarv1s/module-sdk";

import type { AiRepository, AiConfiguredModelSafeRow } from "./repository.js";
import {
  assertInstanceAdmin,
  handleRouteError,
  serializeModel,
  type AiRoutesDependencies
} from "./routes.js";

type UserParams = { readonly userId: string };

export function registerAiAdminPinRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies,
  repository: AiRepository
): void {
  server.get<{ Params: UserParams }>(
    "/api/admin/users/:userId/ai-pin",
    { schema: getAiAdminUserPinRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const targetUserId = request.params.userId;
        await requireAdminAndTarget(dependencies, repository, accessContext, targetUserId);

        const pin = await dependencies.dataContext.withDataContext(
          { actorUserId: targetUserId, requestId: accessContext.requestId },
          (scopedDb) => readPin(repository, scopedDb, targetUserId)
        );

        return { pin };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.put<{ Params: UserParams }>(
    "/api/admin/users/:userId/ai-pin",
    { schema: putAiAdminUserPinRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const targetUserId = request.params.userId;
        const body = parsePutBody(request.body);
        await requireAdminAndTarget(dependencies, repository, accessContext, targetUserId);

        const pin = await dependencies.dataContext.withDataContext(
          { actorUserId: targetUserId, requestId: accessContext.requestId },
          async (scopedDb) => {
            const model = await repository.setAdminPinnedModel(scopedDb, body.modelId);
            if (body.modelId !== null && !model) {
              throw new HttpError(
                400,
                "modelId must reference an active model owned by the target user"
              );
            }
            return readPin(repository, scopedDb, targetUserId);
          }
        );

        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          recordAuditEvent(scopedDb, {
            actorUserId: accessContext.actorUserId,
            action: body.modelId === null ? "ai.admin_pin.clear" : "ai.admin_pin.set",
            targetType: "user",
            targetId: targetUserId,
            metadata: body.modelId === null ? {} : { modelId: body.modelId },
            requestId: accessContext.requestId ?? randomUUID()
          })
        );

        return { pin };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

async function requireAdminAndTarget(
  dependencies: AiRoutesDependencies,
  repository: AiRepository,
  accessContext: Awaited<ReturnType<AiRoutesDependencies["resolveAccessContext"]>>,
  targetUserId: string
): Promise<void> {
  await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
    await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
    const target = await repository.getUserById(scopedDb, targetUserId);
    if (!target) throw new HttpError(404, "User not found");
  });
}

async function readPin(
  repository: AiRepository,
  scopedDb: Parameters<AiRepository["getAdminPinnedModelId"]>[0],
  targetUserId: string
) {
  const [pinnedModelId, pinnedModel, effectiveChat, models] = await Promise.all([
    repository.getAdminPinnedModelId(scopedDb),
    repository.getAdminPinnedModel(scopedDb),
    repository.resolveModelForCapability(scopedDb, "chat"),
    repository.listModels(scopedDb)
  ]);
  const activeModels = models.filter(isActiveModel);

  return {
    pinnedModelId,
    pinnedModel: pinnedModel ? serializeModel(pinnedModel, targetUserId) : null,
    effectiveChatModel: effectiveChat.model ? serializeModel(effectiveChat.model, targetUserId) : null,
    effectiveChatReason: effectiveChat.reason,
    availableModels: activeModels.map((model) => serializeModel(model, targetUserId))
  };
}

function isActiveModel(model: AiConfiguredModelSafeRow): boolean {
  return model.status === "active" && model.provider_status === "active";
}

function parsePutBody(body: unknown): PutAiAdminUserPinRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  const modelId = (body as Record<string, unknown>).modelId;
  if (modelId !== null && typeof modelId !== "string") {
    throw new HttpError(400, "modelId must be a string or null");
  }

  return { modelId };
}
