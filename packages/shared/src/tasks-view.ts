import type { TaskDto } from "./tasks-api.js";

export type TaskQuadrant = "do" | "schedule" | "delegate" | "eliminate";

export const TASK_URGENCY_WINDOW_HOURS = 48;
export const TASK_URGENCY_WINDOW_MS = TASK_URGENCY_WINDOW_HOURS * 60 * 60 * 1000;
export const TASK_IMPORTANT_PRIORITY_MIN = 4;

export const TASK_QUADRANT_AXES: Record<TaskQuadrant, { important: boolean; urgent: boolean }> = {
  do: { important: true, urgent: true },
  schedule: { important: true, urgent: false },
  delegate: { important: false, urgent: true },
  eliminate: { important: false, urgent: false }
};

interface PriorityLevel {
  readonly value: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
}

/** 5..1, highest first (SDP-1: Someday=1 … Critical=5). */
export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  { value: 5, label: "Critical" },
  { value: 4, label: "High" },
  { value: 3, label: "Medium" },
  { value: 2, label: "Low" },
  { value: 1, label: "Someday" }
];

interface QuadrantMeta {
  readonly key: TaskQuadrant;
  readonly title: string;
  readonly subtitle: string;
}

/** Eisenhower order: do → schedule → delegate → eliminate. */
export const QUADRANTS: readonly QuadrantMeta[] = [
  { key: "do", title: "Do First", subtitle: "Important & urgent" },
  { key: "schedule", title: "Schedule", subtitle: "Important, not urgent" },
  { key: "delegate", title: "Delegate", subtitle: "Urgent, not important" },
  { key: "eliminate", title: "Later", subtitle: "Neither" }
];

/** Classifies important × urgent using the shared quadrant matrix. */
export function quadrantOf(task: TaskDto): TaskQuadrant {
  const important = task.priority !== null && task.priority >= TASK_IMPORTANT_PRIORITY_MIN;
  let urgent = false;
  if (task.dueAt) {
    urgent = new Date(task.dueAt).getTime() - Date.now() <= TASK_URGENCY_WINDOW_MS;
  }
  const quadrant = (Object.keys(TASK_QUADRANT_AXES) as TaskQuadrant[]).find(
    (q) => TASK_QUADRANT_AXES[q].important === important && TASK_QUADRANT_AXES[q].urgent === urgent
  );
  return quadrant ?? "eliminate";
}

interface PriorityGroup {
  readonly value: 1 | 2 | 3 | 4 | 5 | null;
  readonly label: string;
  readonly tasks: TaskDto[];
}

function byDueThenTitle(a: TaskDto, b: TaskDto): number {
  const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return ad - bd || a.title.localeCompare(b.title);
}

/** Groups into 5..1 then a trailing "No priority" (null) group. Empty groups are kept (UI may hide them). */
export function groupByPriority(tasks: readonly TaskDto[]): PriorityGroup[] {
  const groups: PriorityGroup[] = PRIORITY_LEVELS.map((l) => ({
    value: l.value,
    label: l.label,
    tasks: tasks.filter((t) => t.priority === l.value).sort(byDueThenTitle)
  }));
  groups.push({
    value: null,
    label: "No priority",
    tasks: tasks.filter((t) => t.priority === null).sort(byDueThenTitle)
  });
  return groups;
}
