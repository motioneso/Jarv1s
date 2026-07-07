import { describe, expect, it } from "vitest";

import { sportsModuleManifest } from "../../packages/sports/src/manifest.js";
import { sportsQueryKeys } from "../../packages/sports/src/web/query-keys.js";
import sportsWebContribution from "../../packages/sports/src/web/index.js";

// #799 module-web-registry Phase A: the sports package's `./web` contribution is hand-authored
// (moduleId/route path/icon/order are literals, not imports from `../manifest.js` — see that
// file's docstring for why), so nothing statically forces them to stay in sync with
// `packages/sports/src/manifest.ts`. These assertions are the regression guard.
describe("sports web contribution vs manifest consistency", () => {
  it("moduleId matches the backend manifest id", () => {
    expect(sportsWebContribution.moduleId).toBe(sportsModuleManifest.id);
  });

  it("route path/icon/order match the manifest's navigation entry", () => {
    const navEntry = sportsModuleManifest.navigation[0];
    const route = sportsWebContribution.routes?.[0];
    expect(navEntry).toBeDefined();
    expect(route).toBeDefined();
    expect(route?.path).toBe(navEntry?.path);
    expect(route?.icon).toBe(navEntry?.icon);
    expect(route?.order).toBe(navEntry?.order);
  });
});

// Byte-stability guard: the sports React Query cache keys must not change value across the
// module-web-registry migration (old central `apps/web/src/api/query-keys.ts` -> new
// `packages/sports/src/web/query-keys.ts`), or every client silently drops its cached sports data
// on upgrade (queries keyed on the old literal never invalidate/refetch under the new key).
describe("sports query keys byte-stability (#799)", () => {
  it("keeps the exact same key literals as the pre-migration apps/web/src/api/query-keys.ts", () => {
    expect(sportsQueryKeys.overview).toEqual(["sports", "overview"]);
    expect(sportsQueryKeys.catalog).toEqual(["sports", "catalog"]);
    expect(sportsQueryKeys.follows).toEqual(["sports", "follows"]);
  });
});
