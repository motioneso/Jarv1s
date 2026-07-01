import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import { SportsFollowsRepository } from "../../packages/sports/src/repository.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

// Owner-only RLS for app.sports_follows (migration 0133). Mirrors the multi-user-isolation
// harness: a real API server for sign-up, then the repository exercised directly under each
// actor's DataContext GUC so RLS is the thing under test (not the route layer).
describe("sports follows repository RLS", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;
  let dataCtx: DataContextRunner;
  const repo = new SportsFollowsRepository();

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

  it("owner create then list round-trips (owner sees own follow)", async () => {
    const admin = await signUp("Admin", "sports-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "sports-alice@example.com");

    const created = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-1a" },
      (scopedDb) => repo.create(scopedDb, { competitionKey: "nfl", teamKey: "min" })
    );
    expect(created.competitionKey).toBe("nfl");
    expect(created.teamKey).toBe("min");

    const listed = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-1b" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("a second actor's list does NOT see the first actor's follow (owner-only isolation)", async () => {
    const admin = await signUp("Admin", "sports2-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "sports2-alice@example.com");
    const bob = await signUp("Bob", "sports2-bob@example.com");

    await dataCtx.withDataContext({ actorUserId: alice, requestId: "sports-2a" }, (scopedDb) =>
      repo.create(scopedDb, { competitionKey: "nfl", teamKey: "min" })
    );

    const bobList = await dataCtx.withDataContext(
      { actorUserId: bob, requestId: "sports-2b" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(bobList).toEqual([]);
  });

  it("duplicate whole-competition follow (teamKey null twice) does not create a second row", async () => {
    const admin = await signUp("Admin", "sports3-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "sports3-alice@example.com");

    const first = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-3a" },
      (scopedDb) => repo.create(scopedDb, { competitionKey: "nfl", teamKey: null })
    );
    const second = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-3b" },
      (scopedDb) => repo.create(scopedDb, { competitionKey: "nfl", teamKey: null })
    );
    // The repository guards whole-competition (null-team) duplicates with an explicit
    // existence check, so the second create returns the existing row, not a new one.
    expect(second.id).toBe(first.id);

    const listed = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-3c" },
      (scopedDb) => repo.list(scopedDb)
    );
    expect(listed).toHaveLength(1);
  });
});
