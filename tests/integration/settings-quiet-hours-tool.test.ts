import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { quietHoursSetExecute } from "../../packages/settings/src/quiet-hours-tool.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const QUIET_HOURS_PREFERENCE_KEY = "quiet-hours";

function toolCtx(actorUserId: string): ToolContext {
  return { actorUserId, requestId: "req:quiet-hours-tool-test", chatSessionId: "" };
}

describe("settings.quietHours.set tool", () => {
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

  it("sets enabled/start/end/timezone and returns the stored value", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:quiet-hours-a" },
      (scopedDb) =>
        quietHoursSetExecute(
          scopedDb,
          { enabled: true, start: "22:00", end: "07:00", timezone: "America/Denver" },
          toolCtx(ids.userA)
        )
    );
    expect(result.data).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "America/Denver"
    });

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:quiet-hours-a-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, QUIET_HOURS_PREFERENCE_KEY)
    );
    expect(stored?.value).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "America/Denver"
    });
    expect(stored?.revision).toBe(1);
  });

  it("normalizes a blank timezone to null", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:quiet-hours-b" },
      (scopedDb) =>
        quietHoursSetExecute(
          scopedDb,
          { enabled: false, start: "23:00", end: "06:30", timezone: "  " },
          toolCtx(ids.userB)
        )
    );
    expect(result.data).toEqual({ enabled: false, start: "23:00", end: "06:30", timezone: null });
  });

  it("rejects a malformed start time", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:quiet-hours-bad-start" },
        (scopedDb) =>
          quietHoursSetExecute(
            scopedDb,
            { enabled: true, start: "25:00", end: "07:00", timezone: null },
            toolCtx(ids.userA)
          )
      )
    ).rejects.toThrow();
  });

  it("rejects a malformed end time", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:quiet-hours-bad-end" },
        (scopedDb) =>
          quietHoursSetExecute(
            scopedDb,
            { enabled: true, start: "22:00", end: "99:99", timezone: null },
            toolCtx(ids.userA)
          )
      )
    ).rejects.toThrow();
  });
});
