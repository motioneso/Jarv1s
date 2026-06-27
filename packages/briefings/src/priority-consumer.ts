/**
 * Briefings consumer for priority scorer.
 *
 * Normalizes tasks/calendar/email results into PriorityCandidates,
 * reads priority model, and calls scorer to rank results.
 */

import type {
  PriorityCandidate,
  PriorityModelPreferenceV1,
  FocusSignalInput
} from "@jarv1s/priority";
import type { DataContextDb } from "@jarv1s/db";

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
  scopedDb: DataContextDb
): Promise<PriorityModelPreferenceV1> {
  const raw = await scopedDb.db
    .selectFrom("app.preferences")
    .select("value_json")
    .where("key", "=", "priority.model.v1")
    .executeTakeFirst();
  const value = raw?.value_json as PriorityModelPreferenceV1 | null | undefined;
  if (!value || value.version !== 1) {
    return {
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: [],
      updatedAt: new Date().toISOString()
    };
  }
  return value;
}

export interface ComposeDepsForPriority {
  readonly moduleManifests: readonly {
    manifest: { readonly focusSignalProviders?: readonly unknown[] };
  }[];
}

export async function getFocusReadiness(
  scopedDb: DataContextDb,
  deps: ComposeDepsForPriority
): Promise<readonly FocusSignalInput[]> {
  return [];
}
