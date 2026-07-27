import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import { SportsFollowsRepository } from "../../packages/sports/src/repository.js";
import { SportsService } from "../../packages/sports/src/sports-service.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

// Same owner-only RLS (migration 0133) as sports-follows-repository.test.ts, but exercised
// through SportsService.followTeam/unfollowTeam — the exact surface the assistant tools call
// (chat-tools.ts) — rather than the repository directly, so this proves the tool path, not just
// the table.
describe("sports follow tools — cross-actor RLS isolation (#1265)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let dataCtx: DataContextRunner;
  const repository = new SportsFollowsRepository();
  const service = new SportsService({
    datasetClient: {} as never,
    dataContext: {
      withDataContext() {
        throw new Error(
          "not used — this test calls followTeam/unfollowTeam with a scoped db directly"
        );
      }
    },
    repository
  });

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
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, authRuntime, boss, logger: false });
    await server.ready();
    dataCtx = new DataContextRunner(appDb);
  });

  afterEach(async () => {
    await Promise.allSettled([
      server?.close(),
      authRuntime?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  it("a follow created by user A is invisible and unremovable from user B's tool call", async () => {
    const admin = await signUp("Admin", "sports-rls-admin@example.com");
    void admin;
    await disableApproval();
    const alice = await signUp("Alice", "sports-rls-alice@example.com");
    const bob = await signUp("Bob", "sports-rls-bob@example.com");

    const followed = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-rls-1a" },
      (scopedDb) => service.followTeam(scopedDb, { competitionKey: "nfl", teamKey: "dal" })
    );
    expect(followed.ok).toBe(true);

    const bobList = await dataCtx.withDataContext(
      { actorUserId: bob, requestId: "sports-rls-1b" },
      (scopedDb) => repository.list(scopedDb)
    );
    expect(bobList).toEqual([]);

    const bobUnfollow = await dataCtx.withDataContext(
      { actorUserId: bob, requestId: "sports-rls-1c" },
      (scopedDb) => service.unfollowTeam(scopedDb, { competitionKey: "nfl", teamKey: "dal" })
    );
    expect(bobUnfollow).toEqual({ ok: true, removed: false });

    const aliceList = await dataCtx.withDataContext(
      { actorUserId: alice, requestId: "sports-rls-1d" },
      (scopedDb) => repository.list(scopedDb)
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]?.teamKey).toBe("dal");
  });
});
