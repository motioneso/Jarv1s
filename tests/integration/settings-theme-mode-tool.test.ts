import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  themeModeSetExecute,
  themeModeSetInputSchema
} from "../../packages/settings/src/theme-mode-tool.js";
import { settingsUndoStack } from "../../packages/settings/src/undo-stack.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const COLOR_MODE_KEY = "themes.color-mode";

function toolCtx(actorUserId: string): ToolContext {
  return { actorUserId, requestId: "req:theme-mode-tool-test", chatSessionId: "" };
}

describe("settings.themeMode.set tool", () => {
  let appDb: Kysely<JarvisDatabase>;
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

  it("sets color mode to dark and persists a revision", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:theme-mode-a" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.userA))
    );
    expect(result.data).toEqual({ mode: "dark" });

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:theme-mode-a-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(stored?.value).toBe("dark");
    expect(stored?.revision).toBe(1);
  });

  it("bumps the revision on a second write and does not affect another user", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:theme-mode-a2" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "light" }, toolCtx(ids.userA))
    );
    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:theme-mode-a2-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(stored?.value).toBe("light");
    expect(stored?.revision).toBe(2);

    const otherStored = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:theme-mode-b-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(otherStored).toBeNull();
  });

  it("declares the mode enum on inputSchema so the gateway rejects anything outside light|dark", () => {
    // Real validation happens upstream against inputSchema before execute is ever called
    // (module-sdk ToolExecute contract) — this asserts the schema itself is correctly scoped.
    expect(themeModeSetInputSchema.properties.mode.enum).toEqual(["light", "dark"]);
  });

  it("is a no-op when the mode already matches: no revision bump, no undo entry", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:theme-mode-noop-seed" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.adminUser))
    );
    const before = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:theme-mode-noop-before" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    settingsUndoStack.clear(ids.adminUser, "");

    const result = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:theme-mode-noop" },
      (scopedDb) => themeModeSetExecute(scopedDb, { mode: "dark" }, toolCtx(ids.adminUser))
    );
    expect(result.data).toEqual({ mode: "dark" });

    const after = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:theme-mode-noop-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, COLOR_MODE_KEY)
    );
    expect(after?.revision).toBe(before?.revision);
    expect(settingsUndoStack.pop(ids.adminUser, "")).toBeUndefined();
  });
});
