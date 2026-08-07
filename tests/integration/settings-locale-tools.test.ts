import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type MossDatabase } from "@moss/db";
import type { ToolContext } from "@moss/module-sdk";
import { PreferencesRepository } from "@moss/structured-state";
import {
  isValidIanaTimeZone,
  localeSetRegionAndDateFormatExecute,
  localeSetTimezoneExecute
} from "../../packages/settings/src/locale-tools.js";
import { settingsUndoStack } from "../../packages/settings/src/undo-stack.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const LOCALE_PREFERENCE_KEY = "locale";

function toolCtx(actorUserId: string): ToolContext {
  return { actorUserId, requestId: "req:locale-tools-test", chatSessionId: "" };
}

describe("isValidIanaTimeZone", () => {
  it("accepts a real IANA zone", () => expect(isValidIanaTimeZone("America/Chicago")).toBe(true));
  it("rejects a bogus string", () => expect(isValidIanaTimeZone("Not/AZone")).toBe(false));
  it("rejects an offset-style string", () => expect(isValidIanaTimeZone("GMT+5")).toBe(false));
});

describe("settings.locale.setTimezone / settings.locale.setRegionAndDateFormat tools", () => {
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

  it("setTimezone updates only the timezone field, preserving region/dateFormat", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:locale-seed" },
      (scopedDb) =>
        preferences.upsertWithRevision(
          scopedDb,
          LOCALE_PREFERENCE_KEY,
          { timezone: "UTC", region: "en-GB", dateFormat: "12" },
          null
        )
    );

    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:locale-set-tz" },
      (scopedDb) =>
        localeSetTimezoneExecute(scopedDb, { timezone: "America/Denver" }, toolCtx(ids.userA))
    );
    expect(result.data).toEqual({ timezone: "America/Denver", region: "en-GB", dateFormat: "12" });

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:locale-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    expect(stored?.value).toEqual({
      timezone: "America/Denver",
      region: "en-GB",
      dateFormat: "12"
    });
    expect(stored?.revision).toBe(2);
  });

  it("setTimezone rejects an invalid IANA zone", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "req:locale-bad-tz" },
        (scopedDb) =>
          localeSetTimezoneExecute(scopedDb, { timezone: "Fake/Zone" }, toolCtx(ids.userA))
      )
    ).rejects.toThrow();
  });

  it("setRegionAndDateFormat updates region and dateFormat, preserving timezone", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:locale-seed-b" },
      (scopedDb) =>
        preferences.upsertWithRevision(
          scopedDb,
          LOCALE_PREFERENCE_KEY,
          { timezone: "Europe/Paris", region: "en-US", dateFormat: "24" },
          null
        )
    );

    const result = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:locale-set-region" },
      (scopedDb) =>
        localeSetRegionAndDateFormatExecute(
          scopedDb,
          { region: "fr-FR", dateFormat: "12" },
          toolCtx(ids.userB)
        )
    );
    expect(result.data).toEqual({ timezone: "Europe/Paris", region: "fr-FR", dateFormat: "12" });

    const stored = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:locale-read-b" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    expect(stored?.value).toEqual({ timezone: "Europe/Paris", region: "fr-FR", dateFormat: "12" });
  });

  it("setRegionAndDateFormat rejects an empty region", async () => {
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userB, requestId: "req:locale-bad-region" },
        (scopedDb) =>
          localeSetRegionAndDateFormatExecute(
            scopedDb,
            { region: "   ", dateFormat: "24" },
            toolCtx(ids.userB)
          )
      )
    ).rejects.toThrow();
  });

  it("setTimezone is a no-op when the timezone already matches: no revision bump, no undo entry", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-tz-noop-seed" },
      (scopedDb) =>
        preferences.upsertWithRevision(
          scopedDb,
          LOCALE_PREFERENCE_KEY,
          { timezone: "America/Denver", region: "en-US", dateFormat: "24" },
          null
        )
    );
    const before = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-tz-noop-before" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    settingsUndoStack.clear(ids.adminUser, "");

    const result = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-tz-noop" },
      (scopedDb) =>
        localeSetTimezoneExecute(scopedDb, { timezone: "America/Denver" }, toolCtx(ids.adminUser))
    );
    expect(result.data).toEqual({ timezone: "America/Denver", region: "en-US", dateFormat: "24" });

    const after = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-tz-noop-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    expect(after?.revision).toBe(before?.revision);
    expect(settingsUndoStack.pop(ids.adminUser, "")).toBeUndefined();
  });

  it("setRegionAndDateFormat is a no-op when region/dateFormat already match: no revision bump, no undo entry", async () => {
    // Reuses ids.adminUser + the "locale" key from the setTimezone no-op test above, which already
    // wrote a row — seeding with an assumed-null revision would throw PreferenceRevisionConflictError.
    const beforeSeed = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-region-noop-seed-read" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-region-noop-seed" },
      (scopedDb) =>
        preferences.upsertWithRevision(
          scopedDb,
          LOCALE_PREFERENCE_KEY,
          { timezone: "America/Denver", region: "fr-FR", dateFormat: "12" },
          beforeSeed?.revision ?? null
        )
    );
    const before = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-region-noop-before" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    settingsUndoStack.clear(ids.adminUser, "");

    const result = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-region-noop" },
      (scopedDb) =>
        localeSetRegionAndDateFormatExecute(
          scopedDb,
          { region: "fr-FR", dateFormat: "12" },
          toolCtx(ids.adminUser)
        )
    );
    expect(result.data).toEqual({ timezone: "America/Denver", region: "fr-FR", dateFormat: "12" });

    const after = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:locale-region-noop-after" },
      (scopedDb) => preferences.getWithRevision(scopedDb, LOCALE_PREFERENCE_KEY)
    );
    expect(after?.revision).toBe(before?.revision);
    expect(settingsUndoStack.pop(ids.adminUser, "")).toBeUndefined();
  });
});
