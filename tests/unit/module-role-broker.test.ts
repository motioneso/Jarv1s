import { describe, expect, it } from "vitest";

import {
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";

describe("module role name derivation", () => {
  it("builds the runtime role name, replacing hyphens with underscores", () => {
    expect(moduleRuntimeRoleName("acme-widgets")).toBe("jarvis_mod_acme_widgets_runtime");
  });

  it("builds the install role name", () => {
    expect(moduleInstallRoleName("acme-widgets")).toBe("jarvis_mod_acme_widgets_install");
  });

  it("rejects a module id that is not a valid kebab slug", () => {
    expect(() => moduleRuntimeRoleName("Acme Widgets")).toThrow(/invalid module id/i);
  });
});
