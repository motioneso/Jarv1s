/**
 * Chat consumer for priority scorer.
 *
 * Contract-only: defines how chat would use scorer after #525 cross-tool reasoning.
 * Ranks already-loaded candidates without triggering new source reads.
 */

import { PriorityPreferencesRepository, rankPriorityCandidates } from "@jarv1s/priority";
import type {
  PriorityCandidate,
  PriorityModelPreferenceV1,
  PriorityResult
} from "@jarv1s/priority";
import type { DataContextDb } from "@jarv1s/db";

const PRIORITY_MODEL_KEY = "priority.model.v1";
const priorityPreferences = new PriorityPreferencesRepository();

export interface PriorityPreferenceReader {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
}

export async function readPriorityModel(
  scopedDb: DataContextDb,
  preferencesRepository?: PriorityPreferenceReader
): Promise<PriorityModelPreferenceV1> {
  if (!preferencesRepository) {
    return priorityPreferences.defaults();
  }
  return priorityPreferences.get(await preferencesRepository.get(scopedDb, PRIORITY_MODEL_KEY));
}

export interface CrossToolCandidate {
  readonly source: "tasks" | "calendar" | "email" | "notes" | "memory";
  readonly title: string;
  readonly summary?: string;
  readonly dueAt?: string;
  readonly startsAt?: string;
  readonly explicitPriority?: 1 | 2 | 3 | 4 | 5;
  readonly relevanceReasons?: readonly string[];
  readonly textForAnchorMatch: readonly string[];
}

export function crossToolCandidatesToPriority(
  candidates: readonly CrossToolCandidate[]
): PriorityCandidate[] {
  return candidates.map((c) => ({
    source: c.source,
    title: c.title,
    summary: c.summary,
    dueAt: c.dueAt,
    startsAt: c.startsAt,
    explicitPriority: c.explicitPriority,
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

export function reorderByPriority<T extends { readonly source: string; readonly title: string }>(
  items: readonly T[],
  ranked: readonly PriorityResult[]
): T[] {
  if (ranked.length === 0) return [...items];
  const order = new Map<string, number>();
  for (const [index, result] of ranked.entries()) {
    const key = `${result.source}::${result.title}`;
    if (!order.has(key)) order.set(key, index);
  }
  return [...items].sort(
    (a, b) =>
      (order.get(`${a.source}::${a.title}`) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(`${b.source}::${b.title}`) ?? Number.MAX_SAFE_INTEGER)
  );
}
