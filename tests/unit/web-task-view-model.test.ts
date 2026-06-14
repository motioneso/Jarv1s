import { describe, expect, it } from "vitest";

import type { TaskDto, TaskListDto } from "@jarv1s/shared";
import {
  deriveTaskFilters,
  groupTasksByQuadrant,
  type ListState
} from "../../apps/web/src/tasks/task-view-model.js";

describe("task view model", () => {
  it("derives visible tasks and list counts in one filter pass", () => {
    const lists = [list("work", "Work"), list("home", "Home")];
    const tasks = [
      task("a", { listId: "work", title: "Send report", tags: ["urgent"], priority: 5 }),
      task("b", { listId: "work", title: "Plan trip", status: "done", tags: ["travel"] }),
      task("c", { listId: "home", title: "Buy paint", tags: ["house"] }),
      task("sub", { listId: "home", title: "Nested", parentTaskId: "c" })
    ];

    const derived = deriveTaskFilters({
      tasks,
      lists,
      statusFilter: "todo",
      focus: null,
      listStates: {},
      tagFilter: [],
      search: "paint"
    });

    expect(derived.visibleTasks.map((item) => item.id)).toEqual(["c"]);
    expect(derived.soloIds).toEqual([]);
    expect(derived.allTags).toEqual(["house", "travel", "urgent"]);
    expect(derived.listCounts).toEqual({ work: 1, home: 1 });
    expect(derived.listCountTotal).toBe(2);
  });

  it("uses Sets for solo lists and tag filters without changing filter semantics", () => {
    const listStates: Record<string, ListState> = { work: "solo", home: "included" };
    const tasks = [
      task("a", { listId: "work", title: "One", tags: ["urgent"] }),
      task("b", { listId: "work", title: "Two", tags: ["house"] }),
      task("c", { listId: "home", title: "Three", tags: ["urgent"] })
    ];

    const derived = deriveTaskFilters({
      tasks,
      lists: [list("work", "Work"), list("home", "Home")],
      statusFilter: "todo",
      focus: null,
      listStates,
      tagFilter: ["urgent"],
      search: ""
    });

    expect(derived.soloIds).toEqual(["work"]);
    expect(derived.visibleTasks.map((item) => item.id)).toEqual(["a"]);
    expect(derived.listCounts).toEqual({ work: 1, home: 1 });
  });

  it("groups matrix tasks with one pass over the task list", () => {
    const grouped = groupTasksByQuadrant([
      task("do", { priority: 5, dueAt: "2026-06-14T12:00:00.000Z" }),
      task("schedule", { priority: 4 }),
      task("delegate", { priority: 2, dueAt: "2026-06-14T12:00:00.000Z" }),
      task("eliminate", { priority: null })
    ]);

    expect(grouped.do.map((item) => item.id)).toEqual(["do"]);
    expect(grouped.schedule.map((item) => item.id)).toEqual(["schedule"]);
    expect(grouped.delegate.map((item) => item.id)).toEqual(["delegate"]);
    expect(grouped.eliminate.map((item) => item.id)).toEqual(["eliminate"]);
  });
});

const OWNER_ID = "11111111-1111-1111-1111-111111111111";

function list(id: string, name: string): TaskListDto {
  return {
    id,
    ownerUserId: OWNER_ID,
    name,
    position: 0,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  };
}

function task(
  id: string,
  overrides: Partial<Omit<TaskDto, "tags">> & { readonly tags?: readonly string[] } = {}
): TaskDto {
  const tagNames = overrides.tags ?? [];
  return {
    id,
    ownerUserId: OWNER_ID,
    listId: overrides.listId ?? "work",
    parentTaskId: overrides.parentTaskId ?? null,
    title: overrides.title ?? id,
    description: overrides.description ?? null,
    status: overrides.status ?? "todo",
    priority: overrides.priority === undefined ? null : overrides.priority,
    position: overrides.position ?? 0,
    dueAt: overrides.dueAt ?? null,
    doAt: overrides.doAt ?? null,
    effort: overrides.effort ?? null,
    source: overrides.source ?? "manual",
    sourceRef: overrides.sourceRef ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-06-14T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-14T00:00:00.000Z",
    tags: tagNames.map((name, index) => ({
      id: `${id}-tag-${index}`,
      ownerUserId: OWNER_ID,
      listId: overrides.listId ?? "work",
      name,
      createdAt: "2026-06-14T00:00:00.000Z"
    }))
  };
}
