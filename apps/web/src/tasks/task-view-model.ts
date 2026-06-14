import { quadrantOf, type TaskDto, type TaskListDto, type TaskQuadrant } from "@jarv1s/shared";

import { matchesFocus, type TaskFocus } from "./focus.js";

export const statusFilters = ["all", "todo", "done", "archived"] as const;
export type StatusFilter = (typeof statusFilters)[number];
export type ListState = "included" | "solo" | "excluded";

export interface TaskFilterInput {
  readonly tasks: readonly TaskDto[];
  readonly lists: readonly TaskListDto[];
  readonly statusFilter: StatusFilter;
  readonly focus: TaskFocus | null;
  readonly listStates: Readonly<Record<string, ListState>>;
  readonly tagFilter: readonly string[];
  readonly search: string;
}

export interface TaskFilterResult {
  readonly visibleTasks: readonly TaskDto[];
  readonly allTags: readonly string[];
  readonly soloIds: readonly string[];
  readonly listCounts: Record<string, number>;
  readonly listCountTotal: number;
}

type QuadrantTaskGroups = Record<TaskQuadrant, TaskDto[]>;

export function deriveTaskFilters(input: TaskFilterInput): TaskFilterResult {
  const needle = input.search.trim().toLowerCase();
  const tagSet = new Set(input.tagFilter);
  const soloIds = input.lists
    .filter((list) => input.listStates[list.id] === "solo")
    .map((list) => list.id);
  const soloSet = new Set(soloIds);
  const anySolo = soloSet.size > 0;
  const allTags = new Set<string>();
  const listCounts = Object.fromEntries(input.lists.map((list) => [list.id, 0]));
  const visibleTasks: TaskDto[] = [];

  for (const task of input.tasks) {
    for (const tag of task.tags) allTags.add(tag.name);
    if (task.parentTaskId !== null) continue;

    const matchesStatusOrFocus = input.focus
      ? matchesFocus(task, input.focus)
      : input.statusFilter === "all" || task.status === input.statusFilter;
    if (!matchesStatusOrFocus) continue;

    const matchesTags = tagSet.size === 0 || task.tags.some((tag) => tagSet.has(tag.name));
    if (!matchesTags) continue;

    if (Object.hasOwn(listCounts, task.listId)) {
      listCounts[task.listId] = (listCounts[task.listId] ?? 0) + 1;
    }

    const listState = input.listStates[task.listId] ?? "included";
    if (listState === "excluded") continue;
    if (anySolo && !soloSet.has(task.listId)) continue;
    if (needle && !matchesSearch(task, needle)) continue;

    visibleTasks.push(task);
  }

  return {
    visibleTasks,
    allTags: [...allTags].sort((left, right) => left.localeCompare(right)),
    soloIds,
    listCounts,
    listCountTotal: Object.values(listCounts).reduce((sum, count) => sum + count, 0)
  };
}

export function groupTasksByQuadrant(tasks: readonly TaskDto[]): QuadrantTaskGroups {
  const groups: QuadrantTaskGroups = {
    do: [],
    schedule: [],
    delegate: [],
    eliminate: []
  };

  for (const task of tasks) {
    groups[quadrantOf(task)].push(task);
  }

  for (const group of Object.values(groups)) {
    group.sort(byDueThenTitle);
  }

  return groups;
}

function matchesSearch(task: TaskDto, needle: string): boolean {
  return (
    task.title.toLowerCase().includes(needle) ||
    (task.description?.toLowerCase().includes(needle) ?? false)
  );
}

function byDueThenTitle(left: TaskDto, right: TaskDto): number {
  const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return leftDueAt - rightDueAt || left.title.localeCompare(right.title);
}
