import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  isValidIanaTimeZone,
  localeSetRegionAndDateFormatExecute,
  localeSetTimezoneExecute
} from "../../packages/settings/src/locale-tools.js";

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
});
