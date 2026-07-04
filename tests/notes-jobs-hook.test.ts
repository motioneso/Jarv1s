import { describe, expect, it } from "vitest";

import { runNotesAfterSyncHook } from "../packages/notes/src/jobs.js";

describe("runNotesAfterSyncHook", () => {
  it("calls the hook with metadata only after a real sync", async () => {
    const calls: unknown[] = [];

    await runNotesAfterSyncHook(
      { ingested: 1, skipped: 0, errors: 0 },
      (input) => {
        calls.push(input);
        return Promise.resolve();
      },
      { actorUserId: "u1", sourcePath: "/notes" }
    );

    expect(calls).toEqual([{ actorUserId: "u1", sourcePath: "/notes" }]);
  });

  it("does not call the hook for no-op syncs", async () => {
    const calls: unknown[] = [];

    await runNotesAfterSyncHook(
      { ingested: 0, skipped: 0, errors: 0, noOp: true },
      (input) => {
        calls.push(input);
        return Promise.resolve();
      },
      { actorUserId: "u1", sourcePath: null }
    );

    expect(calls).toEqual([]);
  });
});
