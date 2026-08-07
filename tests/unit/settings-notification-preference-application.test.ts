import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@moss/db";
import type { MossModuleManifest } from "@moss/module-sdk";
import { PreferenceRevisionConflictError } from "@moss/structured-state";
import { setNotificationPreferenceEnabled } from "../../packages/settings/src/notification-preference-application.js";
import type { NotificationPreferenceApplicationDeps } from "../../packages/settings/src/notification-preference-application.js";

const scopedDb = {} as DataContextDb;

function manifest(overrides: Partial<MossModuleManifest> = {}): MossModuleManifest {
  return {
    id: "news",
    name: "News",
    version: "1.0.0",
    publisher: "jarv1s",
    lifecycle: "ga",
    compatibility: { jarv1s: "*" },
    notifications: { supported: true },
    ...overrides
  } as MossModuleManifest;
}

function deps(
  overrides: Partial<NotificationPreferenceApplicationDeps> & {
    manifests?: readonly MossModuleManifest[];
    denyRows?: readonly { scope: "instance" | "user"; module_id: string; user_id: string | null }[];
  } = {}
): NotificationPreferenceApplicationDeps {
  const manifests = overrides.manifests ?? [manifest()];
  const denyRows = overrides.denyRows ?? [];
  const prefs = new Map<string, { value: unknown; revision: number }>();
  return {
    listModuleManifests: () => manifests,
    repository: {
      listModuleDenyRowsForActor: async () => denyRows as never
    } as unknown as NotificationPreferenceApplicationDeps["repository"],
    preferencesRepository: {
      get: async (_db: DataContextDb, key: string) => prefs.get(key)?.value ?? null,
      getWithMetadata: async () => null,
      upsert: async (_db: DataContextDb, key: string, value: unknown) => {
        const existing = prefs.get(key);
        prefs.set(key, { value, revision: (existing?.revision ?? 0) + 1 });
      },
      getWithRevision: async (_db: DataContextDb, key: string) => prefs.get(key) ?? null,
      upsertWithRevision: async (
        _db: DataContextDb,
        key: string,
        value: unknown,
        expectedRevision: number | null
      ) => {
        const existing = prefs.get(key);
        const currentRevision = existing?.revision ?? null;
        if (currentRevision !== expectedRevision) {
          throw new PreferenceRevisionConflictError(key);
        }
        const revision = currentRevision === null ? 1 : currentRevision + 1;
        prefs.set(key, { value, revision });
        return { revision };
      }
    },
    ...overrides
  };
}

describe("setNotificationPreferenceEnabled", () => {
  it("sets enabled=false and returns the updated preference", async () => {
    const result = await setNotificationPreferenceEnabled(
      scopedDb,
      deps(),
      "user-a",
      "news",
      false,
      false
    );
    expect(result.preference).toEqual({ moduleId: "news", moduleName: "News", enabled: false });
  });

  it("throws HttpError(404) when the module does not exist", async () => {
    await expect(
      setNotificationPreferenceEnabled(
        scopedDb,
        deps({ manifests: [] }),
        "user-a",
        "news",
        false,
        false
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws HttpError(422) when the module does not support notifications", async () => {
    await expect(
      setNotificationPreferenceEnabled(
        scopedDb,
        deps({ manifests: [manifest({ notifications: undefined })] }),
        "user-a",
        "news",
        false,
        false
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("throws HttpError(422) when the module is not active for this user", async () => {
    await expect(
      setNotificationPreferenceEnabled(
        scopedDb,
        deps({ denyRows: [{ scope: "user", module_id: "news", user_id: "user-a" }] }),
        "user-a",
        "news",
        false,
        false
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("stays active for a required module even with a user-deny row (preserves toMyModuleDto semantics)", async () => {
    const result = await setNotificationPreferenceEnabled(
      scopedDb,
      deps({
        manifests: [manifest({ availability: { defaultEnabled: true, required: true } })],
        denyRows: [{ scope: "user", module_id: "news", user_id: "user-a" }]
      }),
      "user-a",
      "news",
      false,
      false
    );
    expect(result.preference.enabled).toBe(false);
  });

  it("clears unread count only when enabled=false and clearUnread=true and the port is present", async () => {
    let markedModuleId: string | null = null;
    const withPort = deps({
      notificationUnreadPort: {
        markModuleRead: async (_db: DataContextDb, moduleId: string) => {
          markedModuleId = moduleId;
          return 3;
        }
      }
    });

    const cleared = await setNotificationPreferenceEnabled(
      scopedDb,
      withPort,
      "user-a",
      "news",
      false,
      true
    );
    expect(cleared.unreadCount).toBe(3);
    expect(markedModuleId).toBe("news");

    const notClearedNoFlag = await setNotificationPreferenceEnabled(
      scopedDb,
      withPort,
      "user-a",
      "news",
      false,
      false
    );
    expect(notClearedNoFlag.unreadCount).toBeNull();

    const notClearedEnabled = await setNotificationPreferenceEnabled(
      scopedDb,
      withPort,
      "user-a",
      "news",
      true,
      true
    );
    expect(notClearedEnabled.unreadCount).toBeNull();

    const noPort = deps();
    const withoutPort = await setNotificationPreferenceEnabled(
      scopedDb,
      noPort,
      "user-a",
      "news",
      false,
      true
    );
    expect(withoutPort.unreadCount).toBeNull();
  });

  it("throws PreferenceRevisionConflictError (not a silent clobber) when the revision moved since read", async () => {
    const base = deps();
    // Seed the key, then simulate a second writer landing between our read and our write.
    await base.preferencesRepository.upsertWithRevision(
      scopedDb,
      "notifications:news",
      { enabled: true },
      null
    );
    await base.preferencesRepository.upsertWithRevision(
      scopedDb,
      "notifications:news",
      { enabled: true },
      1
    );
    const staleRead: NotificationPreferenceApplicationDeps = {
      ...base,
      preferencesRepository: {
        ...base.preferencesRepository,
        getWithRevision: async () => ({ value: { enabled: true }, revision: 1 })
      }
    };

    await expect(
      setNotificationPreferenceEnabled(scopedDb, staleRead, "user-a", "news", false, false)
    ).rejects.toThrow(PreferenceRevisionConflictError);

    const stored = await base.preferencesRepository.get(scopedDb, "notifications:news");
    expect(stored).toEqual({ enabled: true });
  });

  it("is a no-op when enabled already matches: no revision bump, changed=false", async () => {
    const base = deps();
    await base.preferencesRepository.upsertWithRevision(
      scopedDb,
      "notifications:news",
      { enabled: false },
      null
    );

    const result = await setNotificationPreferenceEnabled(
      scopedDb,
      base,
      "user-a",
      "news",
      false,
      false
    );
    expect(result.changed).toBe(false);

    const stored = await base.preferencesRepository.getWithRevision(scopedDb, "notifications:news");
    expect(stored?.revision).toBe(1);
  });

  it("sets changed=true when enabled actually flips", async () => {
    const base = deps();
    await base.preferencesRepository.upsertWithRevision(
      scopedDb,
      "notifications:news",
      { enabled: false },
      null
    );

    const result = await setNotificationPreferenceEnabled(
      scopedDb,
      base,
      "user-a",
      "news",
      true,
      false
    );
    expect(result.changed).toBe(true);

    const stored = await base.preferencesRepository.getWithRevision(scopedDb, "notifications:news");
    expect(stored?.revision).toBe(2);
  });
});
