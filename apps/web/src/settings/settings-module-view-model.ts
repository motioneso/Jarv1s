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
