import { localDay, quadrantOf, type TaskDto } from "@jarv1s/shared";

/** Today-stat → Tasks filter presets. Applied via the `?focus=` query param so the
    filter works in either List or Matrix view (no hardcoded view). */
export type TaskFocus = "priorities" | "atrisk" | "donetoday";

export const FOCUS_LABELS: Record<TaskFocus, string> = {
  priorities: "Do First",
  atrisk: "At risk",
  donetoday: "Done today"
};

export function isTaskFocus(value: string | null): value is TaskFocus {
  return value === "priorities" || value === "atrisk" || value === "donetoday";
}

/** Whole calendar days between two `YYYY-MM-DD` keys (`to − from`). Both keys are
    already resolved in the user's zone, so they parse as UTC midnight and the delta
    is exact integer days, free of any ambient-zone influence. */
function dayKeyDelta(fromKey: string, toKey: string): number {
  return (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000;
}

/** Due today or within the next ~2 days, OR already overdue (and still open).
    Day-bucketed in the user's persisted timezone (#579), not the ambient browser zone. */
export function isAtRisk(task: TaskDto, timeZone?: string): boolean {
  if (task.status !== "todo" || !task.dueAt) return false;
  const delta = dayKeyDelta(localDay(new Date(), timeZone), localDay(task.dueAt, timeZone));
  return delta <= 2; // overdue (negative) … today (0) … +2 days
}

/** Completed today (and only today), in the user's persisted timezone (#579). */
export function isDoneToday(task: TaskDto, timeZone?: string): boolean {
  if (task.status !== "done" || !task.completedAt) return false;
  return localDay(task.completedAt, timeZone) === localDay(new Date(), timeZone);
}

/** "Do First" — important (priority ≥ High) AND urgent (matrix top-left). */
export function isDoFirst(task: TaskDto): boolean {
  return task.status === "todo" && quadrantOf(task) === "do";
}

export function matchesFocus(task: TaskDto, focus: TaskFocus, timeZone?: string): boolean {
  switch (focus) {
    case "priorities":
      return isDoFirst(task);
    case "atrisk":
      return isAtRisk(task, timeZone);
    case "donetoday":
      return isDoneToday(task, timeZone);
  }
}
