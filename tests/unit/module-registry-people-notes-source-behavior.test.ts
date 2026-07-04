import { describe, expect, it } from "vitest";

import type { DataContextDb, PreferencesPort } from "@jarv1s/db";
import { isPeopleNotesSuggestUpdatesEnabled } from "@jarv1s/module-registry";
import { SOURCE_BEHAVIOR_PREFERENCE_KEY } from "@jarv1s/source-behaviors";

const fakeScopedDb = { db: {} } as DataContextDb;

function prefRepo(values: Record<string, unknown>): PreferencesPort {
  return {
    get: async (_scopedDb, key) => values[key] ?? null,
    getWithMetadata: async () => null,
    upsert: async (_scopedDb, key, value) => {
      values[key] = value;
    }
  };
}

describe("People notes source behavior gate", () => {
  it("uses the built-in behavior default when no user override exists", async () => {
    await expect(isPeopleNotesSuggestUpdatesEnabled(fakeScopedDb, prefRepo({}))).resolves.toBe(
      true
    );
  });

  it("honors a user override that disables automatic People note updates", async () => {
    await expect(
      isPeopleNotesSuggestUpdatesEnabled(
        fakeScopedDb,
        prefRepo({
          [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "people.notes.suggest-updates": false }
        })
      )
    ).resolves.toBe(false);
  });
});
