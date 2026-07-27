import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import type { NotificationPreferenceWriteService } from "../../packages/settings/src/notification-preference-application.js";
import { notificationPreferenceSetEnabledExecute } from "../../packages/settings/src/notification-preference-tool.js";
import { settingsUndoStack } from "../../packages/settings/src/undo-stack.js";

const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;

function ctx(overrides: Partial<{ actorUserId: string }> = {}) {
  return {
    actorUserId: overrides.actorUserId ?? "user-a",
    requestId: "req:test",
    chatSessionId: "chat-1"
  };
}

function fakeService(
  overrides: Partial<NotificationPreferenceWriteService> = {}
): NotificationPreferenceWriteService {
  return {
    setEnabled: async (_db, _actorUserId, moduleId, enabled) => ({
      preference: { moduleId, moduleName: "News", enabled },
      unreadCount: null,
      previous: { value: null, revision: null },
      changed: true
    }),
    ...overrides
  };
}

describe("notificationPreferenceSetEnabledExecute", () => {
  it("throws when the notificationPreferenceWrite service is not injected", async () => {
    await expect(
      notificationPreferenceSetEnabledExecute(
        scopedDb,
        { moduleId: "news", enabled: false },
        ctx(),
        undefined
      )
    ).rejects.toThrow("notificationPreferenceWrite service is not available");
  });

  it("turns notifications off and names the module in the message", async () => {
    const result = await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: false },
      ctx(),
      { notificationPreferenceWrite: fakeService() }
    );
    expect(result.data).toEqual({
      moduleId: "news",
      moduleName: "News",
      enabled: false,
      message: "Turned off notifications for News."
    });
  });

  it("turns notifications on and names the module in the message", async () => {
    const result = await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: true },
      ctx(),
      { notificationPreferenceWrite: fakeService() }
    );
    expect(result.data).toEqual({
      moduleId: "news",
      moduleName: "News",
      enabled: true,
      message: "Turned on notifications for News."
    });
  });

  it("passes clearUnread through to the service, defaulting to false", async () => {
    let receivedClearUnread: boolean | undefined;
    const service = fakeService({
      setEnabled: async (_db, _actorUserId, moduleId, enabled, clearUnread) => {
        receivedClearUnread = clearUnread;
        return {
          preference: { moduleId, moduleName: "News", enabled },
          unreadCount: null,
          previous: { value: null, revision: null },
          changed: true
        };
      }
    });

    await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: false },
      ctx(),
      { notificationPreferenceWrite: service }
    );
    expect(receivedClearUnread).toBe(false);

    await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: false, clearUnread: true },
      ctx(),
      { notificationPreferenceWrite: service }
    );
    expect(receivedClearUnread).toBe(true);
  });

  it("does not push an undo entry when the service reports changed=false (no-op)", async () => {
    settingsUndoStack.clear("user-a", "chat-1");
    const service = fakeService({
      setEnabled: async (_db, _actorUserId, moduleId, enabled) => ({
        preference: { moduleId, moduleName: "News", enabled },
        unreadCount: null,
        previous: { value: { enabled }, revision: 1 },
        changed: false
      })
    });

    await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: false },
      ctx(),
      { notificationPreferenceWrite: service }
    );

    expect(settingsUndoStack.pop("user-a", "chat-1")).toBeUndefined();
  });

  it("pushes an undo entry when the service reports changed=true", async () => {
    settingsUndoStack.clear("user-a", "chat-1");
    const service = fakeService({
      setEnabled: async (_db, _actorUserId, moduleId, enabled) => ({
        preference: { moduleId, moduleName: "News", enabled },
        unreadCount: null,
        previous: { value: { enabled: !enabled }, revision: 1 },
        changed: true
      })
    });

    await notificationPreferenceSetEnabledExecute(
      scopedDb,
      { moduleId: "news", enabled: false },
      ctx(),
      { notificationPreferenceWrite: service }
    );

    expect(settingsUndoStack.pop("user-a", "chat-1")).toMatchObject({
      key: "notifications:news",
      previousValue: { enabled: true },
      previousRevision: 1
    });
  });

  it("propagates the service's rejection (e.g. unknown module 404) unchanged", async () => {
    const service = fakeService({
      setEnabled: async () => {
        throw new Error("module not found");
      }
    });

    await expect(
      notificationPreferenceSetEnabledExecute(
        scopedDb,
        { moduleId: "does-not-exist", enabled: false },
        ctx(),
        { notificationPreferenceWrite: service }
      )
    ).rejects.toThrow("module not found");
  });
});
