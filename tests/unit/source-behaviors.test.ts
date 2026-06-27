import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import type {
  JarvisModuleManifest,
  SourceBehaviorSourceDecl,
  SourceBehaviorDefault
} from "@jarv1s/module-sdk";
import { calendarModuleManifest } from "@jarv1s/calendar";
import { emailModuleManifest } from "@jarv1s/email";
import {
  collectSourceBehaviorSources,
  isBehaviorEnabled,
  SOURCE_BEHAVIOR_PREFERENCE_KEY,
  type SourceBehaviorPreferencesPort
} from "@jarv1s/source-behaviors";

const fakeScopedDb = { db: {} } as unknown as DataContextDb;

function manifestWithBehavior(
  moduleId: string,
  sourceName: string,
  behaviorId: string,
  defaultValue: SourceBehaviorDefault
): JarvisModuleManifest {
  return {
    id: moduleId,
    name: sourceName,
    version: "0.0.0",
    publisher: "test",
    lifecycle: "required",
    compatibility: { jarv1s: ">=0.0.0" },
    sourceBehaviors: [
      {
        id: moduleId,
        name: sourceName,
        description: `${sourceName} description`,
        behaviors: [
          {
            id: behaviorId,
            name: "Include in briefings",
            description: `${sourceName} briefing behavior`,
            default: defaultValue
          }
        ]
      } satisfies SourceBehaviorSourceDecl
    ]
  };
}

function prefRepo(values: Record<string, unknown>): SourceBehaviorPreferencesPort {
  return {
    get: async (_scopedDb, key) => values[key] ?? null,
    getWithMetadata: async () => null,
    upsert: async (_scopedDb, key, value) => {
      values[key] = value;
    }
  };
}

describe("source behavior policy", () => {
  it("collects sources from every module manifest in source-name order", () => {
    const sources = collectSourceBehaviorSources([
      manifestWithBehavior("email", "Email", "email.briefings", "default-on"),
      manifestWithBehavior("calendar", "Calendar", "calendar.briefings", "default-on")
    ]);

    expect(sources.map((source) => source.id)).toEqual(["calendar", "email"]);
    expect(sources.flatMap((source) => source.behaviors).map((behavior) => behavior.id)).toEqual([
      "calendar.briefings",
      "email.briefings"
    ]);
  });

  it("uses a user override before the declared default", async () => {
    const enabled = await isBehaviorEnabled(
      fakeScopedDb,
      {
        manifests: [
          manifestWithBehavior("calendar", "Calendar", "calendar.briefings", "default-on")
        ],
        preferencesRepository: prefRepo({
          [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "calendar.briefings": false }
        })
      },
      "calendar.briefings"
    );

    expect(enabled).toBe(false);
  });

  it("uses the declared default when no user override exists", async () => {
    const enabled = await isBehaviorEnabled(
      fakeScopedDb,
      {
        manifests: [manifestWithBehavior("email", "Email", "email.briefings", "default-on")],
        preferencesRepository: prefRepo({})
      },
      "email.briefings"
    );

    expect(enabled).toBe(true);
  });

  it("always returns false for coming-soon behaviors even if stored true", async () => {
    const enabled = await isBehaviorEnabled(
      fakeScopedDb,
      {
        manifests: [
          manifestWithBehavior("calendar", "Calendar", "calendar.writeback", "coming-soon")
        ],
        preferencesRepository: prefRepo({
          [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "calendar.writeback": true }
        })
      },
      "calendar.writeback"
    );

    expect(enabled).toBe(false);
  });

  it("returns false for unknown behavior ids", async () => {
    const enabled = await isBehaviorEnabled(
      fakeScopedDb,
      {
        manifests: [],
        preferencesRepository: prefRepo({})
      },
      "unknown.behavior"
    );

    expect(enabled).toBe(false);
  });

  it("collects calendar and email source behaviors from their owning manifests", () => {
    const sources = collectSourceBehaviorSources([calendarModuleManifest, emailModuleManifest]);
    const behaviorsBySourceId = new Map(sources.map((source) => [source.id, source]));
    const byId = new Map(
      sources.flatMap((source) => source.behaviors).map((behavior) => [behavior.id, behavior])
    );

    expect([...byId.keys()].sort()).toEqual([
      "calendar.briefings",
      "calendar.detect-commitments",
      "calendar.planning",
      "calendar.writeback",
      "email.briefings",
      "email.capture-tasks",
      "email.send-on-behalf",
      "email.thread-summaries"
    ]);
    expect(behaviorsBySourceId.get("calendar")?.name).toBe("Calendar");
    expect(behaviorsBySourceId.get("email")?.name).toBe("Email");
    expect(byId.get("calendar.briefings")).toMatchObject({ default: "default-on" });
    expect(byId.get("email.briefings")).toMatchObject({ default: "default-on" });
    expect(byId.get("calendar.planning")?.default).toBe("coming-soon");
    expect(byId.get("email.capture-tasks")?.default).toBe("coming-soon");
  });
});
