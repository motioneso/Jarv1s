import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import type { Kysely } from "kysely";

import { AiRepository, grantSelfOperationForModule } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AdminAuditEvent,
  type JarvisDatabase
} from "@jarv1s/db";
import { createActiveModulesResolver, getModuleDeletionTables } from "@jarv1s/module-registry";
import {
  HttpError,
  type JarvisModuleManifest,
  type JsonJarvisModuleManifest,
  type ModuleAssistantToolManifest
} from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";

import {
  registerSettingsRoutes,
  type ExternalModuleDiscovery,
  type ExternalModulesDependencies
} from "../../packages/settings/src/routes.js";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  connectionStrings,
  ids,
  resetEmptyFoundationDatabase,
  resetFoundationDatabase
} from "./test-database.js";
import {
  instanceOnlyDisablableModule,
  optionalModule,
  requiredFixtureModule
} from "./fixtures/optional-module.js";

const { Client } = pg;

function tool(
  name: string,
  overrides: Partial<ModuleAssistantToolManifest> = {}
): ModuleAssistantToolManifest {
  return {
    name,
    description: name,
    permissionId: "test.permission",
    risk: "write",
    executionPolicy: "auto",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ data: {} }),
    ...overrides
  };
}

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

  it("idempotent no-op instance writes do NOT emit an admin-audit row", async () => {
    const moduleId = "noop-audit-probe";

    function countAuditFor(events: AdminAuditEvent[]): number {
      return events.filter(
        (e) =>
          e.target_type === "module" &&
          e.target_id === moduleId &&
          (e.action === "module.instance_disable" || e.action === "module.instance_enable")
      ).length;
    }

    // Enable-when-already-enabled (DELETE affects 0 rows): no audit row.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "noop-1" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId,
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "noop-1"
      })
    );
    let audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "noop-r1" },
      (db) => repo.listAdminAuditEvents(db)
    );
    expect(countAuditFor(audit)).toBe(0);

    // First real disable (INSERT affects 1 row): exactly one audit row.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "noop-2" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId,
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "noop-2"
      })
    );
    // Re-disable (onConflict-do-nothing affects 0 rows): no additional audit row.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "noop-3" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId,
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "noop-3"
      })
    );
    audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "noop-r2" },
      (db) => repo.listAdminAuditEvents(db)
    );
    expect(countAuditFor(audit)).toBe(1);

    // First real enable (DELETE affects 1 row): one more audit row (total 2).
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "noop-4" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId,
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "noop-4"
      })
    );
    // Re-enable (DELETE affects 0 rows): no additional audit row.
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "noop-5" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId,
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "noop-5"
      })
    );
    audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "noop-r3" },
      (db) => repo.listAdminAuditEvents(db)
    );
    expect(countAuditFor(audit)).toBe(2);
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

describe("module enable routes grant self-operation policy (#1263 Task 15)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let aiRepo: AiRepository;
  let server: FastifyInstance;

  const grantableManifest: JarvisModuleManifest = {
    id: "grantable-fixture",
    name: "Grantable Fixture",
    version: "0.1.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true, required: false, supportsUserDisable: true },
    assistantTools: [
      tool("grantable-fixture.autoThing", {
        selfOperationGrant: "granted_at_install",
        actionFamilyId: "grantable-fixture.family"
      })
    ]
  };

  const externalDiscoveryManifest = {
    id: "ext-fixture",
    name: "Ext Fixture",
    version: "0.1.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    assistantTools: [
      tool("ext-fixture.autoThing", {
        selfOperationGrant: "granted_at_install",
        actionFamilyId: "ext-fixture.family"
      })
    ]
  } as unknown as JsonJarvisModuleManifest;

  const externalModules: ExternalModulesDependencies = {
    enabled: true,
    discoveries: [
      {
        id: "ext-fixture",
        dir: "/tmp/ext-fixture",
        manifest: externalDiscoveryManifest,
        manifestHash: "hash-manifest",
        packageHash: "hash-package"
      } satisfies ExternalModuleDiscovery
    ],
    rejected: [],
    reconcile: () => ({
      modules: [
        {
          id: "ext-fixture",
          name: "Ext Fixture",
          version: "0.1.0",
          publisher: "test",
          status: "enabled",
          active: true,
          drifted: false,
          disabledReason: null,
          web: null
        }
      ],
      driftDisable: []
    })
  };

  function authHeaders(sessionId: string): Record<string, string> {
    return { authorization: `Bearer ${sessionId}` };
  }

  async function policyFor(actorUserId: string, moduleId: string, actionFamilyId: string) {
    return dataContext.withDataContext(
      { actorUserId, requestId: "req:grant-read" },
      async (scopedDb) => {
        const policies = await aiRepo.listActionPolicies(scopedDb);
        return policies.find((p) => p.moduleId === moduleId && p.actionFamilyId === actionFamilyId);
      }
    );
  }

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    aiRepo = new AiRepository();
    server = Fastify({ logger: false });
    registerSettingsRoutes(server, {
      rootDb: appDb,
      dataContext,
      resolveAccessContext: async (request) => {
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token === ids.sessionA) return { actorUserId: ids.userA, requestId: "req:grant-a" };
        if (token === ids.sessionB) return { actorUserId: ids.userB, requestId: "req:grant-b" };
        if (token === ids.sessionAdmin) {
          return { actorUserId: ids.adminUser, requestId: "req:grant-admin" };
        }
        throw new HttpError(401, "Unauthorized");
      },
      listModuleManifests: () => [grantableManifest],
      moduleDeletionTables: getModuleDeletionTables(),
      preferencesRepository: new PreferencesRepository(),
      externalModules,
      grantSelfOperationForModule: (scopedDb, manifest) =>
        grantSelfOperationForModule(scopedDb, aiRepo, manifest)
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server.close(), appDb.destroy()]);
  });

  it("user enable stores trusted_auto for eligible module families", async () => {
    const response = await server.inject({
      method: "PATCH",
      url: "/api/me/modules/grantable-fixture",
      headers: authHeaders(ids.sessionA),
      payload: { disabled: false }
    });
    expect(response.statusCode).toBe(200);
    const stored = await policyFor(ids.userA, "grantable-fixture", "grantable-fixture.family");
    expect(stored?.tier).toBe("trusted_auto");
  });

  it("admin enable stores grants only for the acting admin", async () => {
    const response = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/grantable-fixture",
      headers: authHeaders(ids.sessionAdmin),
      payload: { disabled: false }
    });
    expect(response.statusCode).toBe(200);
    const adminStored = await policyFor(
      ids.adminUser,
      "grantable-fixture",
      "grantable-fixture.family"
    );
    expect(adminStored?.tier).toBe("trusted_auto");
    // Scoped to the acting admin only — userB never enabled anything in this describe block yet.
    const otherActor = await policyFor(ids.userB, "grantable-fixture", "grantable-fixture.family");
    expect(otherActor).toBeUndefined();
  });

  it("re-enable does not overwrite always_confirm", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:grant-preset" },
      (scopedDb) =>
        aiRepo.setActionPolicy(
          scopedDb,
          "grantable-fixture",
          "grantable-fixture.family",
          "always_confirm"
        )
    );

    const response = await server.inject({
      method: "PATCH",
      url: "/api/me/modules/grantable-fixture",
      headers: authHeaders(ids.sessionB),
      payload: { disabled: false }
    });
    expect(response.statusCode).toBe(200);

    const stored = await policyFor(ids.userB, "grantable-fixture", "grantable-fixture.family");
    expect(stored?.tier).toBe("always_confirm");
  });

  it("disable never mutates action-policy preferences", async () => {
    const before = await policyFor(ids.userA, "grantable-fixture", "grantable-fixture.family");
    expect(before?.tier).toBe("trusted_auto");

    const response = await server.inject({
      method: "PATCH",
      url: "/api/me/modules/grantable-fixture",
      headers: authHeaders(ids.sessionA),
      payload: { disabled: true }
    });
    expect(response.statusCode).toBe(200);

    const after = await policyFor(ids.userA, "grantable-fixture", "grantable-fixture.family");
    expect(after?.tier).toBe("trusted_auto");
  });

  it("external enable remains outside built-in grant wiring", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/admin/external-modules/ext-fixture",
      headers: authHeaders(ids.sessionAdmin),
      payload: { enabled: true }
    });
    expect(response.statusCode).toBe(200);

    // Even though the discovered manifest declares a granted_at_install tool, the external-module
    // route never calls grantSelfOperationForModule (#1267 territory) — no policy row appears.
    const stored = await policyFor(ids.adminUser, "ext-fixture", "ext-fixture.family");
    expect(stored).toBeUndefined();
  });
});
