import type { TaskApiStatus, TaskDto } from "@jarv1s/shared";

export const statusLabels: Record<TaskApiStatus, string> = {
  todo: "Open",
  done: "Done",
  archived: "Archived"
};

export function formatDate(value: string | null): string {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium"
  }).format(new Date(value));
}

export function toDateInputValue(value: string | null): string {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): string | null {
  if (!value) {
    return null;
  }

  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

export const effortLabels: Record<"quick" | "medium" | "large", string> = {
  quick: "Quick",
  medium: "Medium",
  large: "Large"
};

export function effortLabel(effort: "quick" | "medium" | "large" | null): string | null {
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
