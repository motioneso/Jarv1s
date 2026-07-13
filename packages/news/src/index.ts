export { registerNewsRoutes } from "./routes.js";
// #1025: re-exported so root-level tests/uat/seed/* can write prefs through the real
// repository (same precedent as @jarv1s/auth's hashPassword re-export for admin.ts).
export { NewsPrefsRepository } from "./repository.js";
export type { NewsRoutesDependencies, NewsPrefsWriter } from "./routes.js";
export {
  NEWS_QUEUE_DEFINITIONS,
  NEWS_REFRESH_QUEUE,
  NEWS_REVALIDATE_QUEUE,
  enqueueNewsRefresh,
  enqueueNewsRevalidation,
  registerNewsJobWorkers
} from "./jobs.js";
export type { NewsRefreshPayload, NewsRevalidatePayload } from "./jobs.js";
export type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./discovery/ports.js";
export { NEWS_MODULE_ID, newsModuleManifest, newsModuleSqlMigrationDirectory } from "./manifest.js";
export { configureNewsBriefingService, newsTopHeadlinesTodayExecute } from "./briefing-tool.js";
export { configureNewsChatTools } from "./chat-tools.js";
export type { NewsChatToolDependencies } from "./chat-tools.js";
export { createRssDatasetAdapter } from "./source/rss-source.js";
