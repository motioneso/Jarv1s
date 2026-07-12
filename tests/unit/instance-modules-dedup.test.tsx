import { describe, expect, it } from "vitest";

import { filterUndeclaredExternalModules } from "../../apps/web/src/settings/settings-admin-panes.js";
import type { ExternalModuleDto } from "@jarv1s/shared";

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

describe("filterUndeclaredExternalModules (#996, #860)", () => {
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
});
