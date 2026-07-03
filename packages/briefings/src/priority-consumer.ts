/**
 * Briefings consumer for priority scorer.
 *
 * Normalizes tasks/calendar/email results into PriorityCandidates,
 * accepts priority model reads through an injected preference port, and calls scorer to rank
 * results.
 */

import type { PriorityCandidate, PriorityModelPreferenceV1 } from "@jarv1s/priority";
import { PriorityPreferencesRepository } from "@jarv1s/priority";
import type { DataContextDb } from "@jarv1s/db";

const PRIORITY_MODEL_KEY = "priority.model.v1";
const priorityPreferences = new PriorityPreferencesRepository();

export interface PriorityPreferenceReader {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
}

export interface TaskLine {
  readonly title: string;
  readonly dueAt?: string;
  readonly doAt?: string;
  readonly priority?: number;
  readonly effort?: "quick" | "medium" | "large";
}

export interface CalendarSignal {
  readonly summary: string;
  readonly type: string;
  readonly startsAt?: string;
  readonly day?: string;
}

export interface EmailSignal {
  readonly summary: string;
  readonly type: string;
  readonly receivedAt?: string;
}

export function tasksToCandidates(tasks: readonly TaskLine[]): PriorityCandidate[] {
  return tasks.map((task) => ({
    source: "tasks" as const,
    title: task.title,
    dueAt: task.dueAt,
    doAt: task.doAt,
    explicitPriority: task.priority as 1 | 2 | 3 | 4 | 5 | undefined,
    effort: task.effort,
    signalType: undefined,
    textForAnchorMatch: [task.title]
  }));
}

export function calendarSignalsToCandidates(
  signals: readonly CalendarSignal[]
): PriorityCandidate[] {
  return signals.map((signal) => ({
    source: "calendar" as const,
    title: signal.summary,
    startsAt: signal.startsAt,
    signalType: signal.type,
    textForAnchorMatch: [signal.summary]
  }));
}

export function emailSignalsToCandidates(signals: readonly EmailSignal[]): PriorityCandidate[] {
  return signals.map((signal) => ({
    source: "email" as const,
    title: signal.summary,
    occurredAt: signal.receivedAt,
    signalType: signal.type,
    textForAnchorMatch: [signal.summary]
  }));
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
