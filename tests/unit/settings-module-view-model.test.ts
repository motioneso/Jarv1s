import { describe, expect, it } from "vitest";

import { visibleUserToggleModules } from "../../apps/web/src/settings/settings-module-view-model.js";
import type { MyModuleDto } from "@jarv1s/shared";

function mod(id: string, required: boolean): MyModuleDto {
  return { id, name: id, active: true, required, instanceDisabled: false } as MyModuleDto;
}

describe("visibleUserToggleModules (#996, #860)", () => {
  it("shows only non-required modules, driven by the field not a hardcoded id set", () => {
    const modules = [mod("wellness", false), mod("commitments", true), mod("acme-widgets", false)];
    expect(visibleUserToggleModules(modules).map((m) => m.id)).toEqual([
      "wellness",
      "acme-widgets"
    ]);
  });

  it("excludes 'finance' when it is required, proving the old hardcoded id set is gone", () => {
    expect(visibleUserToggleModules([mod("finance", true)])).toEqual([]);
  });
});
