import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { ChatRepository, chatModuleManifest } from "@jarv1s/chat";
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

describe("chat.listTodaysTurns read tool + listThreadsByActivity", () => {
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

  it("listThreadsByActivity orders by last_active_at (active-today thread ahead of idle threads)", async () => {
    // An idle thread created/touched now, then an older thread re-activated AFTER it
    // via touchThread — the re-activated (older-created) thread must sort first.
    const idle = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Idle-by-activity" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const activeToday = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "Active-today-by-activity" })
    );
    // Touch the idle one LAST so it has the most-recent last_active_at.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.touchThread(scopedDb, idle.id)
    );

    const threads = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listThreadsByActivity(scopedDb, 20)
    );
    const idleIndex = threads.findIndex((t) => t.id === idle.id);
    const activeIndex = threads.findIndex((t) => t.id === activeToday.id);
    expect(idleIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    // idle was touched most recently, so it sorts before the earlier-touched thread.
    expect(idleIndex).toBeLessThan(activeIndex);
  });

  it("exposes chat.listTodaysTurns as a read tool excluding incognito threads", async () => {
    const tool = (chatModuleManifest.assistantTools ?? []).find(
      (t) => t.name === "chat.listTodaysTurns"
    );
    expect(tool?.risk).toBe("read");
    expect(tool?.permissionId).toBe("chat.view");

    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const normal = await repository.openNewThread(scopedDb, { title: "Today-tool-normal" });
      const secret = await repository.openNewThread(scopedDb, {
        title: "Today-tool-secret",
        incognito: true
      });
      await repository.recordCompletedTurn(scopedDb, normal.id, "hello today", "hi back", {
        provider: "anthropic",
        model: "claude-economy"
      });
      await repository.recordCompletedTurn(scopedDb, secret.id, "secret question", "secret reply", {
        provider: "anthropic",
        model: "claude-economy"
      });

      const result = await tool!.execute!(
        scopedDb,
        {},
        {
          actorUserId: ids.userA,
          requestId: "request:user-a-chat-live",
          chatSessionId: ""
        }
      );
      const turns = (result.data as { turns: Array<{ threadTitle: string; role: string }> }).turns;
      expect(turns.some((t) => t.threadTitle === "Today-tool-normal")).toBe(true);
      expect(turns.some((t) => t.threadTitle === "Today-tool-secret")).toBe(false);
      // both roles of the visible turn are present
      expect(turns.some((t) => t.threadTitle === "Today-tool-normal" && t.role === "user")).toBe(
        true
      );
      expect(
        turns.some((t) => t.threadTitle === "Today-tool-normal" && t.role === "assistant")
      ).toBe(true);
    });
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
