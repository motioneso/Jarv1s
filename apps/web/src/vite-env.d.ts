declare module "virtual:jarvis-module-settings" {
  import type { LazyExoticComponent, ComponentType } from "react";
  import type { GeneratedSettingsSurface, ModuleSettingsSurfaceProps } from "@jarv1s/settings-ui";

  export const MODULE_SETTINGS_SURFACES: readonly GeneratedSettingsSurface[];
  export const MODULE_SETTINGS_COMPONENTS: Readonly<
    Record<string, LazyExoticComponent<ComponentType<ModuleSettingsSurfaceProps>>>
  >;
}
