/**
 * Chat consumer for priority scorer.
 *
 * Contract-only: defines how chat would use scorer after #525 cross-tool reasoning.
 * Ranks already-loaded candidates without triggering new source reads.
 */

import type { PriorityCandidate, PriorityModelPreferenceV1, PriorityResult } from "@jarv1s/priority";

export interface CrossToolCandidate {
  readonly source: "tasks" | "calendar" | "email" | "notes" | "memory";
  readonly title: string;
  readonly summary?: string;
  readonly dueAt?: string;
  readonly startsAt?: string;
  readonly relevanceReasons?: readonly string[];
  readonly textForAnchorMatch: readonly string[];
}

export function crossToolCandidatesToPriority(candidates: readonly CrossToolCandidate[]): PriorityCandidate[] {
  return candidates.map((c) => ({
    source: c.source,
    title: c.title,
    summary: c.summary,
    dueAt: c.dueAt,
    startsAt: c.startsAt,
    textForAnchorMatch: [...c.textForAnchorMatch]
  }));
}

export function rankChatContext(
  crossToolCandidates: readonly CrossToolCandidate[],
  model: PriorityModelPreferenceV1,
  now: string,
  timeZone: string
): PriorityResult[] {
  const priorityCandidates = crossToolCandidatesToPriority(crossToolCandidates).slice(0, 200);
  return rankPriorityCandidates({
    model,
    candidates: priorityCandidates,
    now,
    timeZone,
    focusReadiness: []
  });
}
