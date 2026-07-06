import type { DataContextDb } from "@jarv1s/db";

export interface CalendarFollowThroughRefs {
  readonly targetRef: string;
  readonly taskId?: string;
  readonly calendarEventId?: string;
}

export interface CalendarFollowThroughPort {
  executeAutoActions(args: {
    readonly scopedDb: DataContextDb;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly targetRef: string;
    readonly signal: {
      readonly summary: string;
      readonly suggestedActions: readonly string[];
      readonly startsAt?: string;
      readonly endsAt?: string;
    };
  }): Promise<CalendarFollowThroughRefs>;
}

export function calendarFollowThroughSourceRef(targetRef: string): string {
  return `calendar:briefing-item:${targetRef}`;
}

export function isCalendarFollowThroughTask(
  task: { readonly source: string | null; readonly source_ref: string | null },
  sourceRef: string
): boolean {
  return task.source === "calendar" && task.source_ref === sourceRef;
}

export function isCalendarFollowThroughEvent(
  event: { readonly external_metadata: unknown },
  targetRef: string
): boolean {
  const metadata = event.external_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.jarvisCreated === true && record.followThroughTargetRef === targetRef;
}
