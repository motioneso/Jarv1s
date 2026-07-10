import { describe, expect, it } from "vitest";

import type { QueueDefinition } from "@jarv1s/jobs";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  assertModuleRegistryConsistency,
  getBuiltInModuleRegistrations,
  getExternalModuleDeletionTables,
  type BuiltInModuleRegistration
} from "@jarv1s/module-registry";

function manifest(overrides: Partial<JarvisModuleManifest>): JarvisModuleManifest {
  return {
    id: "fixture",
    name: "Fixture",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "required",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true },
    ...overrides
  };
}

function registration(
  manifestOverrides: Partial<JarvisModuleManifest>,
  queueDefinitions: readonly QueueDefinition[] = []
): BuiltInModuleRegistration {
  return {
    manifest: manifest(manifestOverrides),
    sqlMigrationDirectories: [],
    queueDefinitions
  };
}

describe("assertModuleRegistryConsistency", () => {
  it("accepts every built-in module registration", () => {
    expect(() => assertModuleRegistryConsistency(getBuiltInModuleRegistrations())).not.toThrow();
  });

  it("rejects duplicate module ids", () => {
    expect(() =>
      assertModuleRegistryConsistency([
        registration({ id: "tasks", name: "Tasks" }),
        registration({ id: "tasks", name: "Tasks Copy" })
      ])
    ).toThrow(/duplicate module id "tasks"/i);
  });

  it("rejects duplicate queue names, including foundation queue names", () => {
    expect(() =>
      assertModuleRegistryConsistency([
        registration({ id: "probe-owner" }, [{ name: "rls-probe" }])
      ])
    ).toThrow(/duplicate queue name "rls-probe"/i);

    expect(() =>
      assertModuleRegistryConsistency([
        registration({ id: "one" }, [{ name: "module.shared" }]),
        registration({ id: "two" }, [{ name: "module.shared" }])
      ])
    ).toThrow(/duplicate queue name "module.shared"/i);
  });

  it("rejects duplicate route method and path pairs", () => {
    expect(() =>
      assertModuleRegistryConsistency([
        registration({
          id: "one",
          routes: [{ method: "GET", path: "/api/collide" }]
        }),
        registration({
          id: "two",
          routes: [{ method: "GET", path: "/api/collide" }]
        })
      ])
    ).toThrow(/duplicate route "GET \/api\/collide"/i);
  });

  it("rejects duplicate owned tables", () => {
    // Both fixtures declare a satisfying dataLifecycle so the #801 parity check (below) does
    // not preempt this duplicate-table assertion — the first module in registration order
    // would otherwise fail that check first (it also has an owned table).
    const satisfyingLifecycle = {
      exportSections: [],
      deletion: { strategy: "cascade" as const, tables: [{ table: "app.shared" }] }
    };
    expect(() =>
      assertModuleRegistryConsistency([
        registration({
          id: "one",
          database: { migrations: [], ownedTables: ["app.shared"] },
          dataLifecycle: satisfyingLifecycle
        }),
        registration({
          id: "two",
          database: { migrations: [], ownedTables: ["app.shared"] },
          dataLifecycle: satisfyingLifecycle
        })
      ])
    ).toThrow(/duplicate owned table "app.shared"/i);
  });

  // #801 Phase A: dataLifecycle parity assertion.
  describe("dataLifecycle parity (#801 Phase A)", () => {
    it("RED: rejects a module with owned tables, no dataLifecycle, not on the allowlist", () => {
      expect(() =>
        assertModuleRegistryConsistency([
          registration({
            id: "unmigrated-fixture",
            database: { migrations: [], ownedTables: ["app.unmigrated_fixture"] }
          })
        ])
      ).toThrow(
        /module "unmigrated-fixture" has owned tables but declares no datalifecycle.*not.*lifecycle_migration_pending allowlist/i
      );
    });

    it("GREEN: accepts the same shape when the module id is on the allowlist", () => {
      // "tasks" is a real LIFECYCLE_MIGRATION_PENDING entry (Phase B, not yet migrated) —
      // reusing it here (rather than a synthetic id) proves the allowlist itself, not just
      // the membership-check mechanics.
      expect(() =>
        assertModuleRegistryConsistency([
          registration({
            id: "tasks",
            database: { migrations: [], ownedTables: ["app.tasks_fixture"] }
          })
        ])
      ).not.toThrow();
    });

    it("rejects a dataLifecycle declaration that omits exportSections on a module with owned tables", () => {
      expect(() =>
        assertModuleRegistryConsistency([
          registration({
            id: "no-export-sections-fixture",
            database: { migrations: [], ownedTables: ["app.fixture_table"] },
            dataLifecycle: {
              deletion: { strategy: "cascade", tables: [{ table: "app.fixture_table" }] }
            }
          })
        ])
      ).toThrow(/declares datalifecycle with owned tables but omits exportsections/i);
    });

    it("RED: rejects cascade deletion.tables missing an owned table (parity check)", () => {
      expect(() =>
        assertModuleRegistryConsistency([
          registration({
            id: "partial-deletion-fixture",
            database: {
              migrations: [],
              ownedTables: ["app.fixture_a", "app.fixture_b"]
            },
            dataLifecycle: {
              exportSections: [],
              deletion: { strategy: "cascade", tables: [{ table: "app.fixture_a" }] }
            }
          })
        ])
      ).toThrow(/dataLifecycle.deletion.tables is missing owned table\(s\): app.fixture_b/);
    });

    it("GREEN: accepts a fully-declared dataLifecycle covering every owned table", () => {
      expect(() =>
        assertModuleRegistryConsistency([
          registration({
            id: "fully-migrated-fixture",
            database: {
              migrations: [],
              ownedTables: ["app.fixture_a", "app.fixture_b"]
            },
            dataLifecycle: {
              exportSections: [],
              deletion: {
                strategy: "cascade",
                tables: [{ table: "app.fixture_a" }, { table: "app.fixture_b" }]
              }
            }
          })
        ])
      ).not.toThrow();
    });
  });
});

describe("getExternalModuleDeletionTables (#914)", () => {
  it("resolves owned tables from an installed external module's manifest, same shape as built-ins", () => {
    const externalManifest = manifest({
      id: "acme-widgets",
      database: { migrations: [], ownedTables: ["app.acme_widgets"] },
      dataLifecycle: {
        exportSections: [],
        deletion: {
          strategy: "cascade",
          tables: [{ table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }]
        }
      }
    });

    expect(getExternalModuleDeletionTables([externalManifest])).toEqual([
      { table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }
    ]);
  });

  it("applies the default count predicate when a table omits one", () => {
    const externalManifest = manifest({
      id: "acme-widgets",
      database: { migrations: [], ownedTables: ["app.acme_widgets"] },
      dataLifecycle: {
        exportSections: [],
        deletion: { strategy: "cascade", tables: [{ table: "app.acme_widgets" }] }
      }
    });

    expect(getExternalModuleDeletionTables([externalManifest])).toEqual([
      { table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }
    ]);
  });

  it("derives coverage from ownedTables alone — no dataLifecycle declaration required (spec D6: external modules carry no module code)", () => {
    const externalManifest = manifest({
      id: "acme-widgets",
      database: { migrations: [], ownedTables: ["app.acme_widgets", "app.acme_gadgets"] }
    });

    expect(getExternalModuleDeletionTables([externalManifest])).toEqual([
      { table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" },
      { table: "app.acme_gadgets", countPredicate: "owner_user_id = $1::uuid" }
    ]);
  });
});
