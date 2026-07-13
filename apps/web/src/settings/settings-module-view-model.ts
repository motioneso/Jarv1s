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

// #986: required modules with an implemented settings destination (legacy CONFIG_IDS,
// CAT_BY_ID, or a contributed surface with hasEntry) still need a modules-list row so
// users can reach that destination; required modules with nowhere to go stay hidden.
export function visibleConfigurableModules(
  modules: readonly SettingsModule[],
  hasImplementedSettings: (module: SettingsModule) => boolean
): readonly SettingsModule[] {
  return modules.filter((module) => !module.required || hasImplementedSettings(module));
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
