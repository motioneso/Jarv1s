declare module "virtual:jarvis-module-settings" {
  import type { LazyExoticComponent, ComponentType } from "react";
  import type { GeneratedSettingsSurface, ModuleSettingsSurfaceProps } from "@jarv1s/settings-ui";

  export const MODULE_SETTINGS_SURFACES: readonly GeneratedSettingsSurface[];
  export const MODULE_SETTINGS_COMPONENTS: Readonly<
    Record<string, LazyExoticComponent<ComponentType<ModuleSettingsSurfaceProps>>>
  >;
}

declare module "virtual:jarvis-module-web" {
  import type { ModuleWebContribution } from "@jarv1s/module-web-sdk";

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
