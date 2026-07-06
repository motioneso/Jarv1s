import type { ModuleWebContribution } from "@jarv1s/module-web-sdk";

/**
 * Test-only stand-in for the Vite-generated `virtual:jarvis-module-web` module
 * (#799 module-web-registry Phase A). Aliased in `vitest.config.ts` so the many files that
 * transitively import `apps/web/src/app-route-metadata.ts` (page-context, command-palette,
 * section-tour, today-page, etc.) resolve the virtual module the same way the real Vite build
 * does, without every consuming test needing its own `vi.mock("virtual:jarvis-module-web", ...)`.
 *
 * Mirrors exactly what `packages/settings-ui/src/scanner.ts`'s `scanModuleWeb` would emit for the
 * current Phase A migration (sports is the only module with a `./web` export) — keep this in sync
 * if a future phase docks another module's `./web` contribution.
 */
export const MODULE_WEB_ROUTES = [
  {
    moduleId: "sports",
    moduleName: "Sports",
    id: "sports",
    label: "Sports",
    path: "/sports",
    icon: "trophy",
    order: 35,
    permissionId: "sports.view"
  }
];

export const MODULE_WEB_CONTRIBUTIONS: ReadonlyArray<{
  readonly moduleId: string;
  readonly load: () => Promise<{ readonly default: ModuleWebContribution }>;
}> = [{ moduleId: "sports", load: () => import("@jarv1s/sports/web") }];
