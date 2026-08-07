declare module "virtual:moss-module-settings" {
  import type { LazyExoticComponent, ComponentType } from "react";
  import type { GeneratedSettingsSurface, ModuleSettingsSurfaceProps } from "@moss/settings-ui";

  export const MODULE_SETTINGS_SURFACES: readonly GeneratedSettingsSurface[];
  export const MODULE_SETTINGS_COMPONENTS: Readonly<
    Record<string, LazyExoticComponent<ComponentType<ModuleSettingsSurfaceProps>>>
  >;
}

declare module "virtual:moss-module-web" {
  import type { ModuleWebContribution } from "@moss/module-web-sdk";

  export interface GeneratedWebRoute {
    readonly moduleId: string;
    readonly moduleName: string;
    readonly id: string;
    readonly label: string;
    readonly path: string;
    readonly icon: string | null;
    readonly order: number | null;
    readonly permissionId: string | null;
  }

  export interface ModuleWebContributionEntry {
    readonly moduleId: string;
    readonly load: () => Promise<{ readonly default: ModuleWebContribution }>;
  }

  export const MODULE_WEB_ROUTES: readonly GeneratedWebRoute[];
  export const MODULE_WEB_CONTRIBUTIONS: readonly ModuleWebContributionEntry[];
}
