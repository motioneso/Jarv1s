import type { Task } from "@jarv1s/db";

export const TASK_URGENCY_WINDOW_HOURS = 48;
export const TASK_URGENCY_WINDOW_MS = TASK_URGENCY_WINDOW_HOURS * 60 * 60 * 1000;

export type TaskQuadrant = "do" | "schedule" | "delegate" | "eliminate";

export function classifyTaskQuadrant(task: Task, now: Date): TaskQuadrant {
  const important = task.priority !== null && task.priority >= 4;
  let urgent = false;

  if (task.due_at) {
    const dueMs = (task.due_at instanceof Date ? task.due_at : new Date(task.due_at)).getTime();
    urgent = dueMs - now.getTime() <= TASK_URGENCY_WINDOW_MS;
  }

  if (important && urgent) return "do";
  if (important && !urgent) return "schedule";
  if (!important && urgent) return "delegate";
  return "eliminate";
}
