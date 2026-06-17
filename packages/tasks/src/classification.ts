import type { Task } from "@jarv1s/db";

export const TASK_URGENCY_WINDOW_HOURS = 48;
export const TASK_URGENCY_WINDOW_MS = TASK_URGENCY_WINDOW_HOURS * 60 * 60 * 1000;
export const TASK_IMPORTANT_PRIORITY_MIN = 4;

export type TaskQuadrant = "do" | "schedule" | "delegate" | "eliminate";

/**
 * The single definition of the Eisenhower quadrants in terms of the two axes
 * (important × urgent). Both the in-memory classifier ({@link classifyTaskQuadrant})
 * and the SQL filter in the repository derive from this matrix and the shared
 * threshold/window constants — change the rule here and both paths follow, so the
 * backend cannot drift from itself (and stays in step with the frontend mirror).
 */
export const TASK_QUADRANT_AXES: Record<TaskQuadrant, { important: boolean; urgent: boolean }> = {
  do: { important: true, urgent: true },
  schedule: { important: true, urgent: false },
  delegate: { important: false, urgent: true },
  eliminate: { important: false, urgent: false }
};

export function isTaskImportant(task: Pick<Task, "priority">): boolean {
  return task.priority !== null && task.priority >= TASK_IMPORTANT_PRIORITY_MIN;
}

export function isTaskUrgent(task: Pick<Task, "due_at">, now: Date): boolean {
  if (!task.due_at) {
    return false;
  }
  const dueMs = (task.due_at instanceof Date ? task.due_at : new Date(task.due_at)).getTime();
  return dueMs - now.getTime() <= TASK_URGENCY_WINDOW_MS;
}

export function classifyTaskQuadrant(task: Task, now: Date): TaskQuadrant {
  const important = isTaskImportant(task);
  const urgent = isTaskUrgent(task, now);
  const quadrant = (Object.keys(TASK_QUADRANT_AXES) as TaskQuadrant[]).find(
    (q) => TASK_QUADRANT_AXES[q].important === important && TASK_QUADRANT_AXES[q].urgent === urgent
  );
  // The matrix is exhaustive over the four important×urgent combinations, so `find`
  // always matches; the default only satisfies the type.
  return quadrant ?? "eliminate";
}
