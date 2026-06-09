import { describe, expect, it } from "vitest";

import { groupByPriority, PRIORITY_LEVELS, quadrantOf, type TaskDto } from "@jarv1s/shared";

function task(partial: Partial<TaskDto>): TaskDto {
  return {
    id: "t", ownerUserId: "u", listId: "l", parentTaskId: null, title: "t",
    description: null, status: "todo", priority: null, position: 0, dueAt: null,
    doAt: null, effort: null, source: "manual", sourceRef: null, completedAt: null,
    createdAt: null, updatedAt: null, ...partial
  };
}

describe("tasks-view", () => {
  it("PRIORITY_LEVELS is Critical→Someday (5..1)", () => {
    expect(PRIORITY_LEVELS.map((l) => l.value)).toEqual([5, 4, 3, 2, 1]);
    expect(PRIORITY_LEVELS[0]?.label).toBe("Critical");
    expect(PRIORITY_LEVELS[4]?.label).toBe("Someday");
  });

  it("quadrantOf classifies important(>=4) × urgent(due<=48h)", () => {
    const soon = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    const far = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    expect(quadrantOf(task({ priority: 5, dueAt: soon }))).toBe("do");
    expect(quadrantOf(task({ priority: 5, dueAt: far }))).toBe("schedule");
    expect(quadrantOf(task({ priority: 2, dueAt: soon }))).toBe("delegate");
    expect(quadrantOf(task({ priority: 1, dueAt: far }))).toBe("eliminate");
    expect(quadrantOf(task({ priority: null, dueAt: null }))).toBe("eliminate");
  });

  it("groupByPriority returns 5..1 then null, each sorted by due then title", () => {
    const groups = groupByPriority([
      task({ id: "a", title: "b", priority: 5 }),
      task({ id: "b", title: "a", priority: 5 }),
      task({ id: "c", title: "n", priority: null })
    ]);
    expect(groups.map((g) => g.value)).toEqual([5, 4, 3, 2, 1, null]);
    const critical = groups.find((g) => g.value === 5)!;
    expect(critical.tasks.map((t) => t.title)).toEqual(["a", "b"]);
  });
});
