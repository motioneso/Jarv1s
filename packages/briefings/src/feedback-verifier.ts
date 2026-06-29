import type {
  FeedbackTargetVerifier,
  UsefulnessFeedbackRepository
} from "@jarv1s/usefulness-feedback";

import { BriefingsRepository } from "./repository.js";

export function createBriefingsFeedbackTargetVerifier(
  repository = new BriefingsRepository(),
  feedbackRepository: Pick<UsefulnessFeedbackRepository, "findTarget">
): FeedbackTargetVerifier {
  return async (scopedDb, input) => {
    if (input.targetKind === "briefing_run" && input.surface === "briefing") {
      const run = await repository.getOwnedRunById(scopedDb, input.targetRef);
      if (!run || run.owner_user_id !== input.actorUserId) return null;
      return {
        ownerUserId: input.actorUserId,
        targetKind: input.targetKind,
        targetRef: input.targetRef,
        surface: input.surface,
        sourceKind: "briefing",
        sourceLabel: "Briefing",
        metadata: { briefingType: run.briefing_type },
        canRemember: false
      };
    }

    if (input.targetKind === "briefing_item") {
      const target = await feedbackRepository.findTarget(
        scopedDb,
        input.actorUserId,
        input.targetKind,
        input.targetRef,
        input.surface
      );
      if (!target) return null;
      return {
        ownerUserId: input.actorUserId,
        targetKind: input.targetKind,
        targetRef: input.targetRef,
        surface: input.surface,
        sourceKind: target.source_kind ?? undefined,
        sourceLabel: target.source_label ?? undefined,
        priorityBand: target.priority_band ?? undefined,
        metadata: target.metadata_json,
        canRemember: false
      };
    }

    return null;
  };
}
