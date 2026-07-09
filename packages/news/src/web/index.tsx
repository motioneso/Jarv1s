import type { ModuleWebContribution } from "@jarv1s/module-web-sdk";

import { NewsPage } from "./news-page.js";
import { NewsTodayWidget } from "./today-widget.js";

/**
 * News module web contribution (module-web-registry seam, same shape as sports'). `moduleId`/
 * `path`/`icon`/`order` below are literals mirroring `packages/news/src/manifest.ts`'s
 * `id`/`navigation[].path/icon/order` (asserted by `tests/unit/module-web-scanner.test.ts`)
 * rather than an import from `../manifest.js` — that file pulls in `node:url` and backend-only
 * tooling (briefing/dataset source code), which must never be reachable from a browser-bundled
 * `./web` entry (see `tests/unit/module-web-browser-safety.test.ts`).
 */
const newsWebContribution: ModuleWebContribution = {
  moduleId: "news",
  routes: [
    {
      path: "/news",
      title: "News",
      icon: "newspaper",
      order: 34,
      element: <NewsPage />
    }
  ],
  todayWidgets: [{ slot: "brief", element: <NewsTodayWidget /> }]
};

export default newsWebContribution;
