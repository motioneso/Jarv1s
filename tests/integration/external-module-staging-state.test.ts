import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  listExternalModuleAdminStates,
  setExternalModulePurgeRequested,
  updateExternalModuleStaging
} from "../../packages/settings/src/repository-external-modules.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("external-module staging + purge state (#964)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("admin stages a download for a module with no row (insert path, status stays disabled)", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-1" }, (db) =>
      updateExternalModuleStaging(
        db,
        {
          id: "job-search",
          stagedVersion: "1.2.0",
          stagedPackageHash: "sha256:" + "a".repeat(64),
          actorUserId: ids.adminUser,
          requestId: "stage-1"
        },
        repo.externalModuleAuditWriter(db)
      )
    );

    const states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "stage-r1" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")).toMatchObject({
      status: "disabled",
      stagedVersion: "1.2.0",
      stagedSource: "admin-download",
      purgeRequestedAt: null,
      lastInstallError: null
    });
  });

  it("re-staging an existing row updates staged fields and clears last_install_error", async () => {
    // Simulate a prior failed install recorded by the supervisor plane.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-2" }, (db) =>
      db.db
        .updateTable("app.external_modules")
        .set({ last_install_error: "boom" })
        .where("id", "=", "job-search")
        .execute()
    );

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "stage-3" }, (db) =>
      updateExternalModuleStaging(
        db,
        {
          id: "job-search",
          stagedVersion: "1.3.0",
          stagedPackageHash: "sha256:" + "b".repeat(64),
          actorUserId: ids.adminUser,
          requestId: "stage-3"
        },
        repo.externalModuleAuditWriter(db)
      )
    );

    const states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "stage-r2" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")).toMatchObject({
      stagedVersion: "1.3.0",
      lastInstallError: null
    });
  });

  it("purge request marks the row; cancel clears it; audit written for both", async () => {
    const marked = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-1" },
      (db) =>
        setExternalModulePurgeRequested(
          db,
          { id: "job-search", requested: true, actorUserId: ids.adminUser, requestId: "purge-1" },
          repo.externalModuleAuditWriter(db)
        )
    );
    expect(marked).toBe(true);

    let states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r1" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")?.purgeRequestedAt).toBeInstanceOf(Date);

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "purge-2" }, (db) =>
      setExternalModulePurgeRequested(
        db,
        { id: "job-search", requested: false, actorUserId: ids.adminUser, requestId: "purge-2" },
        repo.externalModuleAuditWriter(db)
      )
    );
    states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r2" },
      (db) => listExternalModuleAdminStates(db)
    );
    expect(states.find((s) => s.id === "job-search")?.purgeRequestedAt).toBeNull();

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-r3" },
      (db) => repo.listAdminAuditEvents(db)
    );
    const actions = audit.filter((e) => e.target_id === "job-search").map((e) => e.action);
    expect(actions).toContain("module.external_stage");
    expect(actions).toContain("module.external_purge_request");
    expect(actions).toContain("module.external_purge_cancel");
  });

  it("purge request on a module with no row returns false", async () => {
    const marked = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "purge-3" },
      (db) =>
        setExternalModulePurgeRequested(
          db,
          { id: "never-seen", requested: true, actorUserId: ids.adminUser, requestId: "purge-3" },
          repo.externalModuleAuditWriter(db)
        )
    );
    expect(marked).toBe(false);
  });

  it("RLS: a non-admin actor cannot stage a download", async () => {
    await expect(
      runner.withDataContext({ actorUserId: ids.userA, requestId: "stage-x" }, (db) =>
        updateExternalModuleStaging(
          db,
          {
            id: "sneaky",
            stagedVersion: "1.0.0",
            stagedPackageHash: "sha256:" + "c".repeat(64),
            actorUserId: ids.userA,
            requestId: "stage-x"
          },
          repo.externalModuleAuditWriter(db)
        )
      )
    ).rejects.toThrow();
  });
});
