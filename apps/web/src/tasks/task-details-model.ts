import type { CreateTaskRequest, TaskApiStatus, TaskDto, UpdateTaskRequest } from "@jarv1s/shared";

import { fromDateInputValue, toDateInputValue } from "./task-format.js";

export type Repeat = "never" | "daily" | "weekly" | "monthly";
export type TaskEffort = "quick" | "medium" | "large";

export interface TaskDetailsFormState {
  readonly title: string;
  readonly description: string;
  readonly status: TaskApiStatus;
  readonly listId: string;
  readonly priority: string;
  readonly dueAt: string;
  readonly doAt: string;
  readonly effort: "" | TaskEffort;
  readonly repeat: Repeat;
  readonly repeatEnd: string;
}

export function blankTaskDetailsForm(defaultListId = ""): TaskDetailsFormState {
  return {
    title: "",
    description: "",
    status: "todo",
    listId: defaultListId,
    priority: "",
    dueAt: "",
    doAt: "",
    effort: "",
    repeat: "never",
    repeatEnd: ""
  };
}

export function formFromTask(task: TaskDto): TaskDetailsFormState {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    listId: task.listId,
    priority: task.priority === null ? "" : String(task.priority),
    dueAt: toDateInputValue(task.dueAt),
    doAt: toDateInputValue(task.doAt),
    effort: task.effort ?? "",
    repeat: "never",
    repeatEnd: ""
  };
}

export function buildTaskFields(
  form: TaskDetailsFormState,
  defaultListId?: string
): CreateTaskRequest & UpdateTaskRequest {
  return {
    title: form.title.trim() || "Untitled task",
    description: form.description || null,
    status: form.status,
    priority: form.priority ? Number(form.priority) : null,
    dueAt: fromDateInputValue(form.dueAt),
    doAt: fromDateInputValue(form.doAt),
    effort: form.effort || null,
    listId: form.listId || defaultListId || undefined,
    recurrence:
      form.repeat === "never"
        ? null
        : {
            freq: form.repeat,
            interval: 1,
            ...(form.repeatEnd ? { until: fromDateInputValue(form.repeatEnd) } : {})
          }
  };
}

export function normalizeTagName(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

export function cleanSubtasks(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}
