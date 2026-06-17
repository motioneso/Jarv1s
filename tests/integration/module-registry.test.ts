import { describe, expect, it } from "vitest";

import type { QueueDefinition } from "@jarv1s/jobs";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  assertModuleRegistryConsistency,
  getBuiltInModuleRegistrations,
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
    expect(() =>
      assertModuleRegistryConsistency([
        registration({
          id: "one",
          database: { migrations: [], ownedTables: ["app.shared"] }
        }),
        registration({
          id: "two",
          database: { migrations: [], ownedTables: ["app.shared"] }
        })
      ])
    ).toThrow(/duplicate owned table "app.shared"/i);
  });
});
