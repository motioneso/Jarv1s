import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type MossDatabase } from "@moss/db";
import type { ToolContext } from "@moss/module-sdk";
import { PreferencesRepository } from "@moss/structured-state";
import { themeModeSetExecute } from "../../packages/settings/src/theme-mode-tool.js";
import { settingsUndoLastExecute } from "../../packages/settings/src/undo-apply-tool.js";
import { settingsUndoStack } from "../../packages/settings/src/undo-stack.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const COLOR_MODE_KEY = "themes.color-mode";

function toolCtx(actorUserId: string): ToolContext {
  return { actorUserId, requestId: "req:undo-apply-tool-test", chatSessionId: "" };
}

describe("settings.undoLast tool", () => {
  let appDb: Kysely<MossDatabase>;
  let dataContext: DataContextRunner;
  const preferences = new PreferencesRepository();

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("reports nothing to undo when the stack is empty", async () => {
    settingsUndoStack.clear(ids.userA, "");
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-empty" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.userA))
    );
    expect(result.data).toEqual({
      status: "nothing_to_undo",
      key: null,
      message: "There's nothing to undo."
    });
  });

  it("undoes a tracked write immediately after it lands (absent-row case: deletes the row)", async () => {
    settingsUndoStack.clear(ids.userA, "");
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-absent-write" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.userA))
    );
    const afterWrite = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-absent-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(afterWrite?.value).toBe("dark");

    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-absent-undo" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.userA))
    );
    expect(result.data).toEqual({
      status: "undone",
      key: COLOR_MODE_KEY,
      message: "Changed that back."
    });

    const afterUndo = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-absent-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(afterUndo).toBeNull();
  });

  it("undoes a tracked write over an existing row (restores the prior value and revision)", async () => {
    settingsUndoStack.clear(ids.userB, "");
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:undo-existing-seed" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.userB))
    );
    settingsUndoStack.clear(ids.userB, "");
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:undo-existing-write" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "light" }, toolCtx(ids.userB))
    );

    const result = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:undo-existing-undo" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.userB))
    );
    expect(result.data).toEqual({
      status: "undone",
      key: COLOR_MODE_KEY,
      message: "Changed that back."
    });

    const afterUndo = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:undo-existing-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    // CAS revision is monotonic — undo is itself a new write, so it bumps past the tracked
    // write's own resulting revision (2) rather than reverting the counter to the pre-mutation
    // value (1). Only the VALUE rolls back, not the revision number.
    expect(afterUndo?.value).toBe("dark");
    expect(afterUndo?.revision).toBe(3);
  });

  it("refuses when a plain write landed on top since the tracked mutation, and leaves it untouched", async () => {
    settingsUndoStack.clear(ids.adminUser, "");
    // Seed an existing row outside CAS tracking so the tracked write below exercises the
    // upsert (non-absent-row) undo branch.
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:undo-conflict-seed" },
      (scopedDb) => preferences.upsert(scopedDb, COLOR_MODE_KEY, "light")
    );
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:undo-conflict-tracked" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.adminUser))
    );
    // A plain (non-CAS) write lands on top of the tracked mutation, outside undo's knowledge —
    // this is the scenario the coordinator's binding ruling requires a direct test for.
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:undo-conflict-interleave" },
      (scopedDb) => preferences.upsert(scopedDb, COLOR_MODE_KEY, "light")
    );

    const result = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:undo-conflict-undo" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.adminUser))
    );
    expect(result.data).toEqual({
      status: "cancelled",
      key: COLOR_MODE_KEY,
      message: "That setting changed again since, so I didn't undo it."
    });

    const afterCancelled = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:undo-conflict-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(afterCancelled?.value).toBe("light");
    expect(afterCancelled?.revision).toBe(3);
  });

  it("consumes the entry on a successful undo — a second undo finds nothing to redo", async () => {
    settingsUndoStack.clear(ids.userA, "");
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-twice-write" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.userA))
    );

    const first = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-twice-first" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.userA))
    );
    expect(first.data.status).toBe("undone");

    const second = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:undo-twice-second" },
      (scopedDb) => settingsUndoLastExecute(scopedDb, {}, toolCtx(ids.userA))
    );
    expect(second.data).toEqual({
      status: "nothing_to_undo",
      key: null,
      message: "There's nothing to undo."
    });
  });
});
