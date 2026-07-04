import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { handleUpgradeNotifyJob } from "@jarv1s/jobs";
import { NotificationsRepository } from "@jarv1s/notifications";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("notification repository module preferences", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: NotificationsRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new NotificationsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("rejects new notification writes without a usable module id", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.create(scopedDb, {
          moduleId: " ",
          title: "Missing module id"
        })
      )
    ).rejects.toThrow("moduleId is required");
  });

  it("skips creating notifications when the module preference is disabled", async () => {
    const gatedRepository = new NotificationsRepository(undefined, {
      isModuleEnabled: async () => false
    });
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      gatedRepository.create(scopedDb, {
        moduleId: "briefings",
        title: "Muted briefing"
      })
    );

    expect(created).toBeNull();
  });

  it("upgrade notification worker creates one owner-visible notification and no non-owner row", async () => {
    const job = {
      id: "upgrade-notify-test",
      data: {
        kind: "upgrade-notify",
        actorUserId: ids.userA,
        version: "v9.9.9"
      }
    } as const;

    const first = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      handleUpgradeNotifyJob(job as never, scopedDb, { repository })
    );
    const retry = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      handleUpgradeNotifyJob(job as never, scopedDb, { repository })
    );
    const ownerList = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listVisible(scopedDb)
    );
    const nonOwnerList = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "request:user-b-notification-preferences" },
      (scopedDb) => repository.listVisible(scopedDb)
    );

    const ownerMatches = ownerList.notifications.filter(
      (notification) =>
        notification.metadata.kind === "upgrade_available" &&
        notification.metadata.version === "v9.9.9"
    );
    const nonOwnerMatches = nonOwnerList.notifications.filter(
      (notification) =>
        notification.metadata.kind === "upgrade_available" &&
        notification.metadata.version === "v9.9.9"
    );

    expect(first).toEqual({ created: true });
    expect(retry).toEqual({ created: false });
    expect(ownerMatches).toHaveLength(1);
    expect(ownerMatches[0]?.read_at).toBeNull();
    expect(nonOwnerMatches).toHaveLength(0);
  });
});

function userAContext() {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-notification-preferences"
  };
}
