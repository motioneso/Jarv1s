import { localDay, type TaskApiStatus, type TaskDto, type TaskEffort } from "@jarv1s/shared";

export const statusLabels: Record<TaskApiStatus, string> = {
  todo: "Open",
  suggested: "Suggested",
  done: "Done",
  archived: "Archived"
};

// #877 finding 3: this used to slice the UTC day straight off `value`, so a
// dueAt instant near UTC midnight could land on a different calendar day in
// this edit-form input than the list label shows (task-view-model.ts computes
// the label via `localDay(dueAt, tz)`). Route both through the same shared
// `localDay` helper and the caller's persisted-locale timezone so the two
// surfaces always agree. `timeZone` stays optional so this still compiles for
// any caller without a locale in scope, but every real caller (formFromTask)
// must pass the user's persisted locale timezone.
export function toDateInputValue(value: string | null, timeZone?: string): string {
  if (!value) {
    return "";
  }

  return localDay(value, timeZone);
}

export function fromDateInputValue(value: string): string | null {
  if (!value) {
    return null;
  }

  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

export const effortLabels: Record<TaskEffort, string> = {
  quick: "Small",
  medium: "Medium",
  large: "Large"
};

export function effortLabel(effort: TaskEffort | null): string | null {
  return effort ? effortLabels[effort] : null;
}

export function sortTasks(tasks: readonly TaskDto[]): TaskDto[] {
  return [...tasks].sort((left, right) => {
    const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const dueSort = leftDueAt - rightDueAt;

    if (dueSort !== 0) {
      return dueSort;
    }

    return left.title.localeCompare(right.title);
  });
}
