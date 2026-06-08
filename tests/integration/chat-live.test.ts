import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { ChatRepository } from "@jarv1s/chat";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
const { Client } = pg;

describe("chat live runtime migration (0038)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });
  it("0038: chat_threads has last_active_at", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const col = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='app' AND table_name='chat_threads' AND column_name='last_active_at'`
      );
      expect(col.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe("chat live runtime repository (recency + executed-model stamp)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;

  beforeAll(async () => {
    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
  });

  it("openNewThread creates a thread that getCurrentThread returns", async () => {
    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "First live thread" })
    );
    const current = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(created.owner_user_id).toBe(ids.userA);
    expect(created.last_active_at).toBeTruthy();
    expect(current?.id).toBe(created.id);
  });

  it("a newer thread becomes the current one", async () => {
    const first = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Recency thread one" })
    );
    // Ensure a strictly later last_active_at for the second thread.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Recency thread two" })
    );

    const current = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(first.id).not.toBe(second.id);
    expect(current?.id).toBe(second.id);
  });

  it("touchThread on an older thread makes it current again", async () => {
    const older = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Touch older" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Touch newer" })
    );

    const beforeTouch = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );
    expect(beforeTouch?.id).toBe(newer.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.touchThread(scopedDb, older.id)
    );

    const afterTouch = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userA)
    );

    expect(touched?.id).toBe(older.id);
    expect(afterTouch?.id).toBe(older.id);
  });

  it("getCurrentThread returns undefined for an owner with no threads", async () => {
    const current = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getCurrentThread(scopedDb, ids.userB)
    );
    expect(current).toBeUndefined();
  });
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-chat-live"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-chat-live"
  };
}
