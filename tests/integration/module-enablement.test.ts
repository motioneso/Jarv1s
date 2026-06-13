import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createActiveModulesResolver } from "@jarv1s/module-registry";

import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";
import {
  instanceOnlyDisablableModule,
  optionalModule,
  requiredFixtureModule
} from "./fixtures/optional-module.js";

const { Client } = pg;

describe("module-enablement store (app.module_enablement)", () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates the table with the expected columns", async () => {
    const result = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'module_enablement'
        ORDER BY column_name`
    );
    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "scope",
        "module_id",
        "user_id",
        "disabled_by_user_id",
        "created_at",
        "updated_at"
      ])
    );
  });

  it("enforces the scope/user_id consistency check", async () => {
    // scope='instance' must have NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('instance', 'x', $1)`,
        ["00000000-0000-4000-8000-000000000099"]
      )
    ).rejects.toThrow();
    // scope='user' must have a non-NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('user', 'x', NULL)`
      )
    ).rejects.toThrow();
  });

  it("enforces the partial unique indexes", async () => {
    await client.query(
      `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
    );
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
      )
    ).rejects.toThrow();
    await client.query(`DELETE FROM app.module_enablement WHERE module_id = 'dup-instance'`);
  });

  it("FORCE ROW LEVEL SECURITY is enabled", async () => {
    const result = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'app.module_enablement'::regclass`
    );
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.relforcerowsecurity).toBe(true);
  });
});

describe("SettingsRepository deny-list methods", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  beforeAll(async () => {
    // resetFoundationDatabase seeds userA, userB, adminUser (see test-database.ts).
    const { resetFoundationDatabase } = await import("./test-database.js");
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("admin can disable then re-enable a module at instance scope (and audit is written)", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "req-admin-1" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "req-admin-1"
      })
    );

    const afterDisable = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-1" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(afterDisable.some((r) => r.scope === "instance" && r.module_id === "weather")).toBe(
      true
    );

    // Idempotent disable (insert-on-conflict-do-nothing) does not throw or duplicate.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "req-admin-2" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "req-admin-2"
      })
    );

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "req-admin-3" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "req-admin-3"
      })
    );

    const afterEnable = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-2" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(afterEnable.some((r) => r.scope === "instance" && r.module_id === "weather")).toBe(
      false
    );

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-4" },
      (db) => repo.listAdminAuditEvents(db)
    );
    const actions = audit.map((e) => e.action);
    expect(actions).toContain("module.instance_disable");
    expect(actions).toContain("module.instance_enable");
  });

  it("user deny rows are owner-scoped (RLS isolates actors)", async () => {
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "req-a-3" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.userA,
        requestId: "req-a-3"
      })
    );

    const aRows = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-4" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(aRows.some((r) => r.scope === "user" && r.module_id === "weather")).toBe(true);

    const bRows = await runner.withDataContext(
      { actorUserId: ids.userB, requestId: "req-b-1" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(bRows.some((r) => r.scope === "user" && r.module_id === "weather")).toBe(false);
  });

  it("listInstanceModuleDenyRows returns instance rows only", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "req-admin-5" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "req-admin-5"
      })
    );
    const rows = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-6" },
      (db) => repo.listInstanceModuleDenyRows(db)
    );
    expect(rows.every((r) => r.scope === "instance")).toBe(true);
    expect(rows.some((r) => r.module_id === "wellness")).toBe(true);
  });

  // ── RLS enforcement at the DB policy level (not just repo logic). These run on the
  // app runtime role (DataContext), so they exercise the actual GRANTs + policies in
  // migration 0065, the security floor. A repo method behaving is not enough — the
  // policy must reject a hostile/buggy write even if the repo is bypassed.

  it("RLS: a NON-admin actor cannot write an instance-scope row", async () => {
    // userA is not an admin. The instance_insert policy requires current_actor_is_admin().
    await expect(
      runner.withDataContext({ actorUserId: ids.userA, requestId: "req-a-9" }, (db) =>
        db.db
          .insertInto("app.module_enablement")
          .values({
            scope: "instance",
            module_id: "rls-probe-instance",
            user_id: null,
            disabled_by_user_id: ids.userA,
            created_at: new Date(),
            updated_at: new Date()
          })
          .execute()
      )
    ).rejects.toThrow();
    // And no row leaked in.
    const rows = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-9" },
      (db) => repo.listInstanceModuleDenyRows(db)
    );
    expect(rows.some((r) => r.module_id === "rls-probe-instance")).toBe(false);
  });

  it("RLS: an actor cannot insert a user-scope row targeting a DIFFERENT user_id", async () => {
    // userA tries to disable a module FOR userB. The user_insert WITH CHECK pins
    // user_id = current_actor_user_id(), so this must be rejected by the policy.
    await expect(
      runner.withDataContext({ actorUserId: ids.userA, requestId: "req-a-10" }, (db) =>
        db.db
          .insertInto("app.module_enablement")
          .values({
            scope: "user",
            module_id: "rls-probe-user",
            user_id: ids.userB,
            disabled_by_user_id: ids.userA,
            created_at: new Date(),
            updated_at: new Date()
          })
          .execute()
      )
    ).rejects.toThrow();
    // userB sees no such row (RLS + the rejected write).
    const bRows = await runner.withDataContext(
      { actorUserId: ids.userB, requestId: "req-b-10" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(bRows.some((r) => r.module_id === "rls-probe-user")).toBe(false);
  });
});

describe("createActiveModulesResolver", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  const fixtures = [optionalModule, instanceOnlyDisablableModule, requiredFixtureModule];

  beforeAll(async () => {
    const { resetFoundationDatabase } = await import("./test-database.js");
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  function resolver() {
    return createActiveModulesResolver({ dataContext: runner, manifests: fixtures });
  }

  it("empty store: all fixture modules are active (zero behavior-change baseline)", async () => {
    const active = await resolver()(ids.userA);
    expect(active.map((m) => m.id).sort()).toEqual(["tasks-fixture", "weather", "wellness"].sort());
  });

  it("instance deny row drops a non-required module for ALL actors", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r1" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r1"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("weather");
    expect((await resolver()(ids.userB)).map((m) => m.id)).not.toContain("weather");
    // cleanup
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r2" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "r2"
      })
    );
  });

  it("user deny row drops the module only for that actor (RLS)", async () => {
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r3" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.userA,
        requestId: "r3"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("weather");
    expect((await resolver()(ids.userB)).map((m) => m.id)).toContain("weather");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r4" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "weather",
        disabled: false,
        actorUserId: ids.userA,
        requestId: "r4"
      })
    );
  });

  it("supportsUserDisable:false ignores a user row but obeys an instance row", async () => {
    // user row against wellness is ignored (per-user disable not supported)
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r5" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: ids.userA,
        requestId: "r5"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).toContain("wellness");

    // instance row against wellness still drops it
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r6" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r6"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("wellness");
  });

  it("required modules are never droppable, even with a defensively-inserted instance row", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r7" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "tasks-fixture",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r7"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).toContain("tasks-fixture");
  });
});
