import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("chat.multiplexer instance setting (settings repository)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const repo = new SettingsRepository();

  // Probe-seeded actors: adminUser is is_instance_admin=true; userA is a plain member.
  const adminCtx = { actorUserId: ids.adminUser, requestId: "test:chat-mux-admin" };
  const memberCtx = { actorUserId: ids.userA, requestId: "test:chat-mux-member" };

  beforeAll(() => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  beforeEach(async () => {
    await resetFoundationDatabase();
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("defaults to auto and round-trips an admin write", async () => {
    await dataContext.withDataContext(adminCtx, async (db) => {
      expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("auto");
      await repo.setChatMultiplexerSetting(db, {
        multiplexer: "herdr",
        actorUserId: adminCtx.actorUserId,
        requestId: adminCtx.requestId
      });
      expect((await repo.getChatMultiplexerSetting(db)).multiplexer).toBe("herdr");
    });
  });

  it("rejects a non-admin write (RLS WITH CHECK)", async () => {
    await expect(
      dataContext.withDataContext(memberCtx, async (db) =>
        repo.setChatMultiplexerSetting(db, {
          multiplexer: "tmux",
          actorUserId: memberCtx.actorUserId,
          requestId: memberCtx.requestId
        })
      )
    ).rejects.toThrow();
  });
});
