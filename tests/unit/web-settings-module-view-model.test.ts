import { describe, expect, it } from "vitest";

import {
  visibleUserToggleModules,
  settingsModuleControlModel,
  type SettingsModule
} from "../../apps/web/src/settings/settings-module-view-model.js";

const moduleRow = (input: Partial<SettingsModule> = {}): SettingsModule => ({
  id: "finance",
  name: "Finance",
  version: "0.1.0",
  lifecycle: "user-toggleable",
  required: false,
  supportsUserDisable: true,
  instanceDisabled: false,
  userDisabled: false,
  active: true,
  ...input
});

describe("settings module view model", () => {
  it("locks a module disabled instance-wide instead of offering a personal toggle", () => {
    expect(
      settingsModuleControlModel(
        moduleRow({ instanceDisabled: true, userDisabled: false, active: false })
      )
    ).toEqual({
      kind: "locked",
      label: "Disabled by admin",
      canOpenSettings: false
    });
  });

  it("offers a personal toggle for user-toggleable modules", () => {
    expect(settingsModuleControlModel(moduleRow({ userDisabled: true, active: false }))).toEqual({
      kind: "toggle",
      checked: false,
      canOpenSettings: false
    });
  });

  it("marks required modules without pretending they can be toggled", () => {
    expect(
      settingsModuleControlModel(
        moduleRow({
          id: "tasks",
          name: "Tasks",
          lifecycle: "required",
          required: true,
          supportsUserDisable: false
        })
      )
    ).toEqual({
      kind: "required",
      label: "Required",
      canOpenSettings: true
    });
  });

  it("keeps the personal module switcher to additional modules only", () => {
    const visible = visibleUserToggleModules([
      moduleRow({ id: "goals", name: "Goals" }),
      moduleRow({ id: "notes", name: "Notes" }),
      moduleRow({ id: "commitments", name: "Commitments" }),
      moduleRow({ id: "people", name: "People & Context" }),
      moduleRow({ id: "sports", name: "Sports" }),
      moduleRow({ id: "finance", name: "Finance" })
    ]);

    expect(visible.map((module) => module.name)).toEqual(["Sports", "Finance"]);
  });
});
