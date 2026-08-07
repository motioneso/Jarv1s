import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type MossDatabase } from "@moss/db";
import type { ToolContext } from "@moss/module-sdk";
import { PreferencesRepository } from "@moss/structured-state";
import { weatherLocationSetExecute } from "../../packages/settings/src/weather-location-tool.js";
import { settingsUndoStack } from "../../packages/settings/src/undo-stack.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const WEATHER_LOCATION_PREFERENCE_KEY = "weather-location";

function toolCtx(actorUserId: string): ToolContext {
  return { actorUserId, requestId: "req:weather-location-tool-test", chatSessionId: "" };
}

describe("settings.weatherLocation.set tool", () => {
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

  it("sets lat/lon/label and returns the stored value", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:weather-a" },
      (scopedDb) =>
        weatherLocationSetExecute(
          scopedDb,
          { lat: 39.7392, lon: -104.9903, label: "Denver, CO" },
          toolCtx(ids.userA)
        )
    );
    expect(result.data).toEqual({ lat: 39.7392, lon: -104.9903, label: "Denver, CO" });

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:weather-a-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, WEATHER_LOCATION_PREFERENCE_KEY)
    );
    expect(stored?.value).toEqual({ lat: 39.7392, lon: -104.9903, label: "Denver, CO" });
    expect(stored?.revision).toBe(1);
  });

  it("rejects lat out of range", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:weather-bad-lat" },
        (scopedDb) =>
          weatherLocationSetExecute(scopedDb, { lat: 200, lon: 0, label: "x" }, toolCtx(ids.userA))
      )
    ).rejects.toThrow();
  });

  it("rejects lon out of range", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:weather-bad-lon" },
        (scopedDb) =>
          weatherLocationSetExecute(scopedDb, { lat: 0, lon: 200, label: "x" }, toolCtx(ids.userA))
      )
    ).rejects.toThrow();
  });

  it("trims and caps label at 200 chars", async () => {
    const longLabel = "  " + "x".repeat(250) + "  ";
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:weather-b" },
      (scopedDb) =>
        weatherLocationSetExecute(
          scopedDb,
          { lat: 1, lon: 1, label: longLabel },
          toolCtx(ids.userB)
        )
    );
    expect(result.data.label).toBe("x".repeat(200));
  });

  it("is a no-op when lat/lon/label already match: no revision bump, no undo entry", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:weather-noop-seed" },
      (scopedDb) =>
        weatherLocationSetExecute(
          scopedDb,
          { lat: 39.7392, lon: -104.9903, label: "Denver, CO" },
          toolCtx(ids.adminUser)
        )
    );
    const before = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:weather-noop-before" },
      (scopedDb) => preferences.getWithRevision(scopedDb, WEATHER_LOCATION_PREFERENCE_KEY)
    );
    settingsUndoStack.clear(ids.adminUser, "");

    const result = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:weather-noop" },
      (scopedDb) =>
        weatherLocationSetExecute(
          scopedDb,
          { lat: 39.7392, lon: -104.9903, label: "Denver, CO" },
          toolCtx(ids.adminUser)
        )
    );
    expect(result.data).toEqual({ lat: 39.7392, lon: -104.9903, label: "Denver, CO" });

    const after = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:weather-noop-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, WEATHER_LOCATION_PREFERENCE_KEY)
    );
    expect(after?.revision).toBe(before?.revision);
    expect(settingsUndoStack.pop(ids.adminUser, "")).toBeUndefined();
  });
});
