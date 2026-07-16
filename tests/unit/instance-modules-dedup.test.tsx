import { describe, expect, it } from "vitest";

import {
  filterUndeclaredExternalModules,
  registryIndexIds
} from "../../apps/web/src/settings/settings-instance-modules-pane.js";
import type { ExternalModuleDto, ModuleRegistryRowDto } from "@jarv1s/shared";

function ext(id: string): ExternalModuleDto {
  return {
    id,
    name: id,
    version: "0.1.0",
    publisher: "p",
    status: "enabled",
    active: true,
    drifted: false,
    disabledReason: null,
    web: null
  };
}

// #1084: real deriveModuleRegistryRows shapes (packages/settings/src/module-registry-rows.ts),
// not a synthetic Set — the bug was in how registryIds got BUILT from these rows
// (every row id, not just index-backed ones), so the unit test has to exercise that
// derivation against a row shape a discovered-but-unpublished module would actually get.
function row(
  overrides: Partial<ModuleRegistryRowDto> & Pick<ModuleRegistryRowDto, "id">
): ModuleRegistryRowDto {
  return {
    name: overrides.id,
    description: null,
    state: "installed-enabled",
    installedVersion: "0.1.0",
    latestVersion: null,
    stagedVersion: null,
    requiresCore: null,
    capabilities: null,
    lastInstallError: null,
    purgePending: false,
    ...overrides
  };
}

describe("registryIndexIds (#1084)", () => {
  it("includes only rows backed by a registry-index entry (latestVersion set)", () => {
    const rows = [
      // Published in the index (Task 1's ModuleRegistryEntry -> latestVersion set).
      row({ id: "acme-widgets", latestVersion: "1.2.0" }),
      // Discovered on disk but never published — module-registry-rows.ts leaves
      // latestVersion null for local-only rows. This is the case that regressed:
      // it used to land in the id Set just like the row above.
      row({ id: "local-only-mod", latestVersion: null })
    ];
    expect(registryIndexIds(rows)).toEqual(new Set(["acme-widgets"]));
  });

  it("is empty when the registry has no index-backed rows (e.g. registry unreachable)", () => {
    expect(registryIndexIds([row({ id: "local-only-mod", latestVersion: null })])).toEqual(
      new Set()
    );
  });
});

describe("filterUndeclaredExternalModules (#996, #860, #1084)", () => {
  it("drops external modules already present in the registry index", () => {
    const result = filterUndeclaredExternalModules(
      [ext("acme-widgets"), ext("local-only-mod")],
      new Set(["acme-widgets"])
    );
    expect(result.map((m) => m.id)).toEqual(["local-only-mod"]);
  });

  it("keeps everything when the registry set is empty (registry unreachable)", () => {
    expect(filterUndeclaredExternalModules([ext("a")], new Set()).map((m) => m.id)).toEqual(["a"]);
  });

  // #1084 regression: an external module that's discovered on disk but was never
  // published to the registry index must still surface in the External-modules group
  // (trust warning + #918 admin credentials section) — composing the real
  // registryIndexIds derivation with filterUndeclaredExternalModules must NOT drop it,
  // which is exactly what the old "every row id" registryIds computation did.
  it("keeps a discovered-only module through registryIndexIds + filterUndeclaredExternalModules", () => {
    const rows = [
      row({ id: "acme-widgets", latestVersion: "1.2.0" }),
      row({ id: "local-only-mod", latestVersion: null })
    ];
    const result = filterUndeclaredExternalModules(
      [ext("acme-widgets"), ext("local-only-mod")],
      registryIndexIds(rows)
    );
    expect(result.map((m) => m.id)).toEqual(["local-only-mod"]);
  });
});
