import { quadrantOf, type TaskDto } from "@jarv1s/shared";

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

function isSameDay(date: Date, ref: Date): boolean {
  return (
    date.getFullYear() === ref.getFullYear() &&
    date.getMonth() === ref.getMonth() &&
    date.getDate() === ref.getDate()
  );
}

/** Due today or within the next ~2 days, OR already overdue (and still open). */
export function isAtRisk(task: TaskDto): boolean {
  if (task.status !== "todo" || !task.dueAt) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(task.dueAt);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return startDue - startToday <= 86_400_000 * 2; // overdue (negative) … today … +2 days
}

/** Completed today (and only today). */
export function isDoneToday(task: TaskDto): boolean {
  if (task.status !== "done" || !task.completedAt) return false;
  return isSameDay(new Date(task.completedAt), new Date());
}

/** "Do First" — important (priority ≥ High) AND urgent (matrix top-left). */
export function isDoFirst(task: TaskDto): boolean {
  return task.status === "todo" && quadrantOf(task) === "do";
}

export function matchesFocus(task: TaskDto, focus: TaskFocus): boolean {
  switch (focus) {
    case "priorities":
      return isDoFirst(task);
    case "atrisk":
      return isAtRisk(task);
    case "donetoday":
      return isDoneToday(task);
  }
}
