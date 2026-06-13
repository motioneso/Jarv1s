import { describe, expect, it } from "vitest";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { CORE_VERSION } from "@jarv1s/module-sdk";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

import { assertModulesCompatible } from "../../packages/module-registry/src/compat-gate.js";

function manifest(overrides: Partial<JarvisModuleManifest>): JarvisModuleManifest {
  return {
    id: "fixture",
    name: "Fixture",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true },
    ...overrides
  };
}

describe("assertModulesCompatible", () => {
  it("passes every built-in module (all >=0.0.0 admit CORE_VERSION)", () => {
    expect(() => assertModulesCompatible(getBuiltInModuleManifests())).not.toThrow();
  });

  it("throws naming the module, range, and CORE_VERSION when a range excludes CORE_VERSION", () => {
    expect(() =>
      assertModulesCompatible([manifest({ id: "future", compatibility: { jarv1s: ">=9.0.0" } })])
    ).toThrow(/future/);
    expect(() =>
      assertModulesCompatible([manifest({ id: "future", compatibility: { jarv1s: ">=9.0.0" } })])
    ).toThrow(new RegExp(CORE_VERSION.replace(/\./g, "\\.")));
  });

  it("rejects a built-in that is not defaultEnabled (forward seam is out of scope)", () => {
    expect(() =>
      assertModulesCompatible([manifest({ id: "off", availability: { defaultEnabled: false } })])
    ).toThrow(/defaultEnabled/);
  });
});
