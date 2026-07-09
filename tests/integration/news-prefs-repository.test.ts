import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import { NewsPrefsRepository } from "../../packages/news/src/repository.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

// Owner-only RLS for app.news_prefs (#897). Mirrors sports-follows-repository.test.ts: a real
// API server for sign-up, then the repository exercised directly under each actor's DataContext
// GUC so RLS is the thing under test (not the route layer).
describe("news prefs repository RLS", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;
  let dataCtx: DataContextRunner;
  const repo = new NewsPrefsRepository();

  async function signUp(name: string, email: string): Promise<string> {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name, email, password: "password12345" }
    });
    return res.json<{ user: { id: string } }>().user.id;
  }

  async function disableApproval() {
    await setInstanceSetting("registration.requires_approval", { value: false });
  }

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
    dataCtx = new DataContextRunner(appDb);
  });

  afterEach(async () => {
    await Promise.allSettled([server?.close(), authRuntime?.close(), appDb?.destroy()]);
  });

  it("owner create then list round-trips (owner sees own pref)", async () => {
    const admin = await signUp("Admin", "news-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "news-alice@example.com");

    const created = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "news-1a" },
      (scopedDb) => repo.create(scopedDb, { kind: "source", key: "nytimes" })
    );
    expect(created.kind).toBe("source");
    expect(created.key).toBe("nytimes");

    const listed = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "news-1b" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("a second actor's list does NOT see the first actor's pref (owner-only isolation)", async () => {
    const admin = await signUp("Admin", "news2-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "news2-alice@example.com");
    const bob = await signUp("Bob", "news2-bob@example.com");

    await dataCtx.withDataContext({ actorUserId: alice, requestId: "news-2a" }, (scopedDb) =>
      repo.create(scopedDb, { kind: "source", key: "nytimes" })
    );

    const bobList = await dataCtx.withDataContext(
      { actorUserId: bob, requestId: "news-2b" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(bobList).toEqual([]);
  });

  it("duplicate (kind, key) create does not create a second row", async () => {
    const admin = await signUp("Admin", "news3-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "news3-alice@example.com");

    const first = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "news-3a" },
      (scopedDb) => repo.create(scopedDb, { kind: "topic", key: "technology" })
    );
    const second = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "news-3b" },
      (scopedDb) => repo.create(scopedDb, { kind: "topic", key: "technology" })
    );
    // The repository upserts on (user_id, kind, key), so the second create returns the
    // existing row rather than violating the unique constraint or duplicating it.
    expect(second.id).toBe(first.id);

    const listed = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "news-3c" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(listed).toHaveLength(1);
  });
});
