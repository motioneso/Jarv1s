import { describe, expect, it } from "vitest";

import { newsModuleManifest } from "../../packages/news/src/manifest.js";
import { newsQueryKeys } from "../../packages/news/src/web/query-keys.js";
import newsWebContribution from "../../packages/news/src/web/index.js";

// #897: like sports (#799), the news package's `./web` contribution is hand-authored —
// moduleId/route path/icon/order are literals, not imports from `../manifest.js`, because the
// manifest pulls in node:url and backend-only source code that must never reach a browser
// bundle. Nothing statically forces the literals to stay in sync with
// `packages/news/src/manifest.ts`; these assertions are the regression guard.
describe("news web contribution vs manifest consistency (#897)", () => {
  it("moduleId matches the backend manifest id", () => {
    expect(newsWebContribution.moduleId).toBe(newsModuleManifest.id);
  });

  it("route path/icon/order match the manifest's navigation entry", () => {
    const navEntry = newsModuleManifest.navigation[0];
    const route = newsWebContribution.routes?.[0];
    expect(navEntry).toBeDefined();
    expect(route).toBeDefined();
    expect(route?.path).toBe(navEntry?.path);
    expect(route?.icon).toBe(navEntry?.icon);
    expect(route?.order).toBe(navEntry?.order);
  });

  it("contributes a brief today widget (spec: today integration)", () => {
    expect(newsWebContribution.todayWidgets?.[0]?.slot).toBe("brief");
  });
});

// Pin the React Query cache key literals: the settings pane invalidates by these exact values
// after a pref mutation (see packages/news/src/settings/index.tsx onSuccess), so a silent
// rename would leave the front page serving a stale overview after a source toggle.
describe("news query keys stability (#897)", () => {
  it("keeps the exact key literals the settings pane invalidates by", () => {
    expect(newsQueryKeys.overview).toEqual(["news", "overview"]);
    expect(newsQueryKeys.catalog).toEqual(["news", "catalog"]);
    expect(newsQueryKeys.prefs).toEqual(["news", "prefs"]);
  });
});
