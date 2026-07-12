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
  serializeProvider,
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
            // #870/M4a: model pin and provider pin are mutually exclusive. parsePutBody already
            // rejects both-set; the repo setters clear the sibling key so state can never carry both.
            if (body.providerId != null) {
              const provider = await repository.setAdminPinnedProvider(scopedDb, body.providerId);
              if (!provider) {
                throw new HttpError(400, "providerId must reference an active provider");
              }
            } else {
              // A null/absent providerId with a modelId sets the model pin; both null clears all pins
              // (setAdminPinnedProvider(null) below removes any lingering provider pin).
              const model = await repository.setAdminPinnedModel(scopedDb, body.modelId ?? null);
              if (body.modelId != null && !model) {
                throw new HttpError(
                  400,
                  "modelId must reference an active model owned by the target user"
                );
              }
              if (body.modelId == null) {
                await repository.setAdminPinnedProvider(scopedDb, null);
              }
            }
            return readPin(repository, scopedDb, targetUserId);
          }
        );

        // Describe which pin kind changed for the audit trail.
        const pinKind =
          body.providerId != null ? "provider" : body.modelId != null ? "model" : null;
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          recordAuditEvent(scopedDb, {
            actorUserId: accessContext.actorUserId,
            action: pinKind === null ? "ai.admin_pin.clear" : "ai.admin_pin.set",
            targetType: "user",
            targetId: targetUserId,
            metadata:
              pinKind === "provider"
                ? { providerId: body.providerId }
                : pinKind === "model"
                  ? { modelId: body.modelId }
                  : {},
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
  const [
    pinnedModelId,
    pinnedModel,
    pinnedProviderId,
    pinnedProvider,
    effectiveChat,
    models,
    providers
  ] = await Promise.all([
    repository.getAdminPinnedModelId(scopedDb),
    repository.getAdminPinnedModel(scopedDb),
    repository.getAdminPinnedProviderId(scopedDb),
    repository.getAdminPinnedProvider(scopedDb),
    repository.resolveModelForCapability(scopedDb, "chat"),
    repository.listModels(scopedDb),
    repository.listProviders(scopedDb)
  ]);
  const activeModels = models.filter(isActiveModel);
  const activeProviders = providers.filter((provider) => provider.status === "active");

  // serializeProvider is async (it probes CLI availability), so resolve provider DTOs up front.
  const [serializedPinnedProvider, availableProviders] = await Promise.all([
    pinnedProvider ? serializeProvider(pinnedProvider) : Promise.resolve(null),
    Promise.all(activeProviders.map((provider) => serializeProvider(provider)))
  ]);

  return {
    pinnedModelId,
    pinnedModel: pinnedModel ? serializeModel(pinnedModel, targetUserId) : null,
    // #870/D8: provider pin — hard-locks ALL of the user's traffic to one provider.
    pinnedProviderId,
    pinnedProvider: serializedPinnedProvider,
    effectiveChatModel: effectiveChat.model
      ? serializeModel(effectiveChat.model, targetUserId)
      : null,
    effectiveChatReason: effectiveChat.reason,
    availableModels: activeModels.map((model) => serializeModel(model, targetUserId)),
    availableProviders
  };
}

function isActiveModel(model: AiConfiguredModelSafeRow): boolean {
  return model.status === "active" && model.provider_status === "active";
}

function parsePutBody(body: unknown): PutAiAdminUserPinRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  const record = body as Record<string, unknown>;
  const modelId = record.modelId;
  const providerId = record.providerId;

  if (modelId !== undefined && modelId !== null && typeof modelId !== "string") {
    throw new HttpError(400, "modelId must be a string or null");
  }
  if (providerId !== undefined && providerId !== null && typeof providerId !== "string") {
    throw new HttpError(400, "providerId must be a string or null");
  }
  // #870/M4a: mutually exclusive — at most one pin kind may be set in a single request.
  if (modelId != null && providerId != null) {
    throw new HttpError(400, "modelId and providerId are mutually exclusive");
  }

  return {
    modelId: modelId === undefined ? null : (modelId as string | null),
    providerId: providerId === undefined ? null : (providerId as string | null)
  };
}
