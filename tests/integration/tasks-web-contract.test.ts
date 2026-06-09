import { describe, expect, it } from "vitest";

import { TASK_STATUSES, type TaskApiStatus } from "@jarv1s/shared";

describe("tasks status contract (Plan 3 narrowing)", () => {
  it("TASK_STATUSES is narrowed to todo|done|archived; in_progress retired", () => {
    expect([...TASK_STATUSES]).toEqual(["todo", "done", "archived"]);
    // @ts-expect-error — in_progress is no longer assignable to TaskApiStatus
    const retired: TaskApiStatus = "in_progress";
    expect(retired).toBe("in_progress");
  });
});
