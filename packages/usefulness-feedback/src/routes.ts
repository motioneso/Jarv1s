import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner, UsefulnessFeedbackSignal } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  createUsefulnessFeedbackRouteSchema,
  listUsefulnessFeedbackRouteSchema,
  undoUsefulnessFeedbackRouteSchema,
  type CreateUsefulnessFeedbackRequest,
  type FeedbackSurface,
  type FeedbackTargetKind,
  type UsefulnessFeedbackDto,
  type UsefulnessFeedbackKind
} from "@jarv1s/shared";

import { sanitizeFeedbackMetadata } from "./metadata.js";
import { UsefulnessFeedbackRepository } from "./repository.js";
import { isAllowedFeedbackPair, type FeedbackTargetVerifierRegistry } from "./target-verifiers.js";

export interface UsefulnessFeedbackRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly registry: FeedbackTargetVerifierRegistry;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly repository?: UsefulnessFeedbackRepository;
  readonly cardSideEffects?: {
    applyDismiss(
      scopedDb: Parameters<Parameters<DataContextRunner["withDataContext"]>[1]>[0],
      actorUserId: string,
      cardId: string
    ): Promise<void>;
    undoDismissCard(
      scopedDb: Parameters<Parameters<DataContextRunner["withDataContext"]>[1]>[0],
      actorUserId: string,
      cardId: string
    ): Promise<void>;
  };
  readonly manualMemoryCandidates?: {
    createPendingManualCandidate(
      scopedDb: Parameters<Parameters<DataContextRunner["withDataContext"]>[1]>[0],
      ownerUserId: string,
      input: {
        readonly targetKind: string;
        readonly targetRef: string;
        readonly excerpt: string;
        readonly episodeId?: string | null;
        readonly provenance?: "volunteered" | "inferred";
      }
    ): Promise<{ readonly id: string }>;
    cancelPendingManualCandidate(
      scopedDb: Parameters<Parameters<DataContextRunner["withDataContext"]>[1]>[0],
      ownerUserId: string,
      id: string
    ): Promise<boolean>;
  };
}

export function registerUsefulnessFeedbackRoutes(
  server: FastifyInstance,
  dependencies: UsefulnessFeedbackRoutesDependencies
): void {
  const repository = dependencies.repository ?? new UsefulnessFeedbackRepository();

  server.post(
    "/api/me/usefulness-feedback",
    { schema: { response: createUsefulnessFeedbackRouteSchema.response } },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const input = parseCreateBody(request.body);
        if (!isAllowedFeedbackPair(input.targetKind, input.surface, input.kind)) {
          throw new HttpError(400, "Feedback target/action pair is invalid");
        }

        const result = await dependencies.dataContext.withDataContext(access, async (scopedDb) => {
          const existing = await repository.findActive(
            scopedDb,
            access.actorUserId,
            input.targetKind,
            input.targetRef,
            input.kind
          );
          if (existing) return { feedback: existing, created: false };

          const verifier = dependencies.registry.get(input.targetKind);
          if (!verifier) throw new HttpError(404, "Feedback target not found");
          const verification = await verifier(scopedDb, {
            actorUserId: access.actorUserId,
            targetKind: input.targetKind,
            targetRef: input.targetRef,
            surface: input.surface
          });
          if (!verification) throw new HttpError(404, "Feedback target not found");
          if (input.kind === "remember_this" && !verification.canRemember) {
            throw new HttpError(400, "Feedback target cannot be remembered");
          }
          let effectKind: string | null = null;
          let effectRef: string | null = null;
          if (input.kind === "remember_this") {
            const excerpt = verification.rememberExcerpt?.replace(/\s+/g, " ").trim();
            if (!excerpt || !dependencies.manualMemoryCandidates) {
              throw new HttpError(400, "Feedback target cannot be remembered");
            }
            const candidate =
              await dependencies.manualMemoryCandidates.createPendingManualCandidate(
                scopedDb,
                access.actorUserId,
                {
                  targetKind: input.targetKind,
                  targetRef: input.targetRef,
                  excerpt,
                  provenance: input.targetKind === "chat_message" ? "volunteered" : "inferred"
                }
              );
            effectKind = "memory_candidate";
            effectRef = candidate.id;
          }
          if (input.kind === "dismiss" && input.targetKind === "proactive_card") {
            await dependencies.cardSideEffects?.applyDismiss(
              scopedDb,
              access.actorUserId,
              input.targetRef
            );
            effectKind = "proactive_card_dismissed";
            effectRef = input.targetRef;
          }

          return {
            feedback: await repository.create(scopedDb, {
              ownerUserId: access.actorUserId,
              targetKind: input.targetKind,
              targetRef: input.targetRef,
              surface: input.surface,
              kind: input.kind,
              verification,
              metadata: sanitizeFeedbackMetadata(verification.metadata),
              effectKind,
              effectRef
            }),
            created: true
          };
        });

        return reply
          .code(result.created ? 201 : 200)
          .send({ feedback: serializeFeedback(result.feedback) });
      } catch (error) {
        return handleRouteError(error, reply, {
          invalidRequestMessage: "Usefulness feedback request is invalid"
        });
      }
    }
  );

  server.get(
    "/api/me/usefulness-feedback",
    { schema: listUsefulnessFeedbackRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const feedback = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.list(scopedDb, access.actorUserId)
        );
        return { feedback: feedback.map(serializeFeedback) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    "/api/me/usefulness-feedback/:id/undo",
    { schema: undoUsefulnessFeedbackRouteSchema },
    async (request, reply) => {
      try {
        const access = await dependencies.resolveAccessContext(request);
        const feedback = await dependencies.dataContext.withDataContext(access, (scopedDb) =>
          repository.undo(scopedDb, access.actorUserId, request.params.id, {
            cancelMemoryCandidate: dependencies.manualMemoryCandidates
              ? (candidateId) =>
                  dependencies.manualMemoryCandidates!.cancelPendingManualCandidate(
                    scopedDb,
                    access.actorUserId,
                    candidateId
                  )
              : undefined,
            undoDismissCard: dependencies.cardSideEffects
              ? (cardId) =>
                  dependencies.cardSideEffects!.undoDismissCard(scopedDb, access.actorUserId, cardId)
              : undefined
          })
        );
        if (!feedback) throw new HttpError(404, "Feedback not found");
        return { feedback: serializeFeedback(feedback) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

const FEEDBACK_TARGET_KINDS = new Set<FeedbackTargetKind>([
  "chat_message",
  "briefing_run",
  "briefing_item",
  "proactive_card"
]);
const FEEDBACK_SURFACES = new Set<FeedbackSurface>(["chat", "briefing", "today", "proactive"]);
const FEEDBACK_KINDS = new Set<UsefulnessFeedbackKind>([
  "more_like_this",
  "too_much",
  "wrong_priority",
  "not_useful",
  "remember_this",
  "dismiss"
]);

function parseCreateBody(body: unknown): CreateUsefulnessFeedbackRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !== "kind|surface|targetKind|targetRef") {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  if (
    typeof value.targetRef !== "string" ||
    value.targetRef.length < 1 ||
    value.targetRef.length > 1024
  ) {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  if (
    typeof value.targetKind !== "string" ||
    !FEEDBACK_TARGET_KINDS.has(value.targetKind as FeedbackTargetKind)
  ) {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  if (
    typeof value.surface !== "string" ||
    !FEEDBACK_SURFACES.has(value.surface as FeedbackSurface)
  ) {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  if (typeof value.kind !== "string" || !FEEDBACK_KINDS.has(value.kind as UsefulnessFeedbackKind)) {
    throw new HttpError(400, "Usefulness feedback request is invalid");
  }
  return {
    targetKind: value.targetKind as FeedbackTargetKind,
    targetRef: value.targetRef,
    surface: value.surface as FeedbackSurface,
    kind: value.kind as UsefulnessFeedbackKind
  };
}

function serializeFeedback(row: UsefulnessFeedbackSignal): UsefulnessFeedbackDto {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    targetKind: row.target_kind as FeedbackTargetKind,
    targetRef: row.target_ref,
    surface: row.surface as FeedbackSurface,
    kind: row.kind as UsefulnessFeedbackKind,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    priorityBand: row.priority_band,
    effectKind: row.effect_kind,
    effectRef: row.effect_ref,
    metadata: row.metadata_json,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    resolvedAt: row.resolved_at ? toIsoString(row.resolved_at) : null
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
