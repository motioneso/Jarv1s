import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { AuthSessionResolver } from "../src/auth.js";
import { DataContextRunner, type AccessContext } from "../src/data-context.js";
import { createDatabase } from "../src/database.js";
import { RlsProbeRepository } from "../src/rls-probe-repository.js";
import type { SpikeDatabase } from "../src/types.js";
import { SpikeWorkerRunner } from "../src/worker.js";
import { connectionStrings, ids, resetSpikeDatabase } from "./test-database.js";

const { Client } = pg;

describe("auth/session to Postgres RLS safety spike", () => {
  let appDb: Kysely<SpikeDatabase>;
  let workerDb: Kysely<SpikeDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let worker: SpikeWorkerRunner;
  let repository: RlsProbeRepository;

  beforeAll(async () => {
    await resetSpikeDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });

    workerDb = createDatabase({
      connectionString: connectionStrings.worker,
      maxConnections: 1
    });

    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    worker = new SpikeWorkerRunner(workerDb);
    repository = new RlsProbeRepository();
  });

  afterAll(async () => {
    await appDb?.destroy();
    await workerDb?.destroy();
  });

  it("denies protected rows when no app context is set", async () => {
    await expect(dataContext.unsafeSelectVisibleProbeIdsForTest()).resolves.toEqual([]);
    await expect(worker.unsafeSelectVisibleProbeIdsForTest()).resolves.toEqual([]);
  });

  it("keeps runtime roles from owning protected tables or bypassing RLS", async () => {
    const client = new Client({ connectionString: connectionStrings.superuser });

    await client.connect();
    try {
      const roles = await client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `
          SELECT rolname, rolsuper, rolbypassrls
          FROM pg_roles
          WHERE rolname IN ('jarvis_app_runtime', 'jarvis_worker_runtime')
          ORDER BY rolname
        `
      );

      const owner = await client.query<{ tableowner: string }>(
        `
          SELECT tableowner
          FROM pg_tables
          WHERE schemaname = 'app'
            AND tablename = 'rls_probe_items'
        `
      );

      expect(roles.rows).toEqual([
        { rolname: "jarvis_app_runtime", rolsuper: false, rolbypassrls: false },
        { rolname: "jarvis_worker_runtime", rolsuper: false, rolbypassrls: false }
      ]);
      expect(owner.rows[0]?.tableowner).toBe("jarvis_migration_owner");
    } finally {
      await client.end();
    }
  });

  it("resolves a session to app authz context and lets a user read their own private row", async () => {
    const accessContext = await auth.resolveAccessContext(ids.sessionA, "request:user-a");

    const item = await dataContext.withDataContext(accessContext, (scopedDb) =>
      repository.getById(scopedDb, ids.itemAOwnPrivate)
    );

    expect(accessContext.actorUserId).toBe(ids.userA);
    expect(item?.id).toBe(ids.itemAOwnPrivate);
  });

  it("prevents a user from reading another user's unshared private row", async () => {
    const item = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBPrivate)
    );

    expect(item).toBeUndefined();
  });

  it("does not let an instance admin read another user's private row by role alone", async () => {
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin");

    const item = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, ids.itemBPrivate)
    );

    expect(item).toBeUndefined();
  });

  it("allows access through an explicit resource grant", async () => {
    const item = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBGrantedToA)
    );

    expect(item?.id).toBe(ids.itemBGrantedToA);
  });

  it("allows workspace membership only for workspace-shared rows in the active workspace context", async () => {
    const withoutWorkspace = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBWorkspaceShared)
    );

    const visibleIds = await dataContext.withDataContext(
      {
        ...userAContext(),
        workspaceId: ids.workspaceAlpha
      },
      async (scopedDb) => (await repository.listVisible(scopedDb)).map((item) => item.id)
    );

    expect(withoutWorkspace).toBeUndefined();
    expect(visibleIds).toContain(ids.itemBWorkspaceShared);
    expect(visibleIds).not.toContain(ids.itemBWorkspacePrivate);
  });

  it("does not leak SET LOCAL identity across pooled requests", async () => {
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const visibleIds = (await repository.listVisible(scopedDb)).map((item) => item.id);
      expect(visibleIds).toContain(ids.itemAOwnPrivate);
    });

    await expect(dataContext.unsafeSelectVisibleProbeIdsForTest()).resolves.toEqual([]);
  });

  it("clears transaction-local context after rollback", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), async (scopedDb) => {
        await expect(repository.getById(scopedDb, ids.itemAOwnPrivate)).resolves.toBeDefined();
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");

    await expect(dataContext.unsafeSelectVisibleProbeIdsForTest()).resolves.toEqual([]);
  });

  it("runs worker jobs with stored actor context and does not bypass RLS", async () => {
    const forbiddenItem = await worker.runJob(ids.jobForUserA, (scopedDb) =>
      repository.getById(scopedDb, ids.itemBPrivate)
    );

    const ownItem = await worker.runJob(ids.jobForUserA, (scopedDb) =>
      repository.getById(scopedDb, ids.itemAOwnPrivate)
    );

    expect(forbiddenItem).toBeUndefined();
    expect(ownItem?.id).toBe(ids.itemAOwnPrivate);
  });

  it("fails loudly when a repository is called without the data-context wrapper", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a"
  };
}
