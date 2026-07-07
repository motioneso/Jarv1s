import { describe, expect, it } from "vitest";

import { SHELL_RESERVED_WEB_PATHS } from "../../packages/settings-ui/src/vite.js";
import { webRoutes } from "../../apps/web/src/app-route-metadata.js";
import { MODULE_WEB_ROUTES } from "virtual:jarvis-module-web";

describe("module web scanner reserved paths", () => {
  it("keeps the scanner's shell-reserved denylist in sync with the shell's own route table", () => {
    const moduleRouteIds = new Set(MODULE_WEB_ROUTES.map((route) => route.moduleId));
    const shellOwnedPaths = webRoutes
      .filter((route) => !moduleRouteIds.has(route.id))
      .map((route) => route.path)
      .sort();

    expect([...SHELL_RESERVED_WEB_PATHS].sort()).toEqual(shellOwnedPaths);
  });
});
