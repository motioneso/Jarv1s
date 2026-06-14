import { describe, expect, it } from "vitest";

import {
  buildTaskFields,
  blankTaskDetailsForm
} from "../../apps/web/src/tasks/task-details-model.js";

describe("task details model", () => {
  it("builds the task write payload from explicit form state", () => {
    const fields = buildTaskFields(
      {
        ...blankTaskDetailsForm("list-a"),
        title: "  Renew passport  ",
        description: "",
        priority: "4",
        dueAt: "2026-07-01",
        effort: "medium",
        repeat: "weekly",
        repeatEnd: "2026-08-01"
      },
      "list-fallback"
    );

    expect(fields).toMatchObject({
      title: "Renew passport",
      description: null,
      status: "todo",
      priority: 4,
      effort: "medium",
      listId: "list-a",
      recurrence: {
        freq: "weekly",
        interval: 1
      }
    });
    expect(fields.dueAt).toContain("2026-07-01");
    expect(fields.recurrence).toMatchObject({ until: expect.stringContaining("2026-08-01") });
  });

  it("falls back to a default list and clears recurrence when repeat is never", () => {
    const fields = buildTaskFields(
      { ...blankTaskDetailsForm(), title: "", listId: "", repeat: "never" },
      "default-list"
    );

    expect(fields.title).toBe("Untitled task");
    expect(fields.listId).toBe("default-list");
    expect(fields.recurrence).toBeNull();
  });
});
