import type { MyModuleDto } from "@jarv1s/shared";

export type SettingsModule = MyModuleDto;

export type SettingsModuleControlModel =
  | {
      readonly kind: "required";
      readonly label: string;
      readonly canOpenSettings: boolean;
    }
  | {
      readonly kind: "locked";
      readonly label: string;
      readonly canOpenSettings: boolean;
    }
  | {
      readonly kind: "toggle";
      readonly checked: boolean;
      readonly canOpenSettings: boolean;
    };

// #996/#860: previously a hardcoded USER_TOGGLEABLE_MODULE_IDS set (including a stale
// "finance" id — no such module exists) had to be kept in sync by hand with every
// module's manifest lifecycle. Now derived directly from MyModuleDto.required, which
// the server already computes from each module's manifest (Task 10 flips
// commitments/people/goals/notes to required, so they drop out of this list for free).
export function visibleUserToggleModules(
  modules: readonly SettingsModule[]
): readonly SettingsModule[] {
  return modules.filter((module) => !module.required);
}

export function settingsModuleControlModel(module: SettingsModule): SettingsModuleControlModel {
  if (module.required) {
    return {
      kind: "required",
      label: "Required",
      canOpenSettings: module.active
    };
  }

  if (module.instanceDisabled) {
    return {
      kind: "locked",
      label: "Disabled by admin",
      canOpenSettings: false
    };
  }

  return {
    kind: "toggle",
    checked: module.active,
    canOpenSettings: module.active
  };
}
