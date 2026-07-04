import type { QueryClient } from "@tanstack/react-query";
import type { ListSourceBehaviorsResponse, SourceBehaviorSourceDto } from "@jarv1s/shared";

import { queryKeys } from "../api/query-keys";

export const BRIEFING_SOURCE_BEHAVIORS = [
  {
    id: "email.briefings",
    label: "Include email signal",
    description: "Surface important threads in scheduled briefings."
  },
  {
    id: "calendar.briefings",
    label: "Include calendar signal",
    description: "Use calendar-derived readiness signals in scheduled briefings."
  }
] as const;

export function findSourceBehaviorEnabled(
  sources: readonly SourceBehaviorSourceDto[],
  behaviorId: string
): boolean {
  return (
    sources
      .flatMap((source) => source.behaviors)
      .find((behavior) => behavior.id === behaviorId)?.enabled ?? true
  );
}

export function writeSourceBehaviorCache(
  queryClient: QueryClient,
  data: ListSourceBehaviorsResponse
): void {
  queryClient.setQueryData(queryKeys.settings.sourceBehaviors, data);
}
