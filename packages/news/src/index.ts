export { registerNewsRoutes } from "./routes.js";
export type { NewsRoutesDependencies, NewsPrefsWriter } from "./routes.js";
export { NEWS_QUEUE_DEFINITIONS, NEWS_REFRESH_QUEUE, enqueueNewsRefresh } from "./jobs.js";
export type { NewsRefreshPayload } from "./jobs.js";
export type { NewsAiPort, NewsSafeFetchPort, NewsWebSearchPort } from "./discovery/ports.js";
export { NEWS_MODULE_ID, newsModuleManifest, newsModuleSqlMigrationDirectory } from "./manifest.js";
export { configureNewsBriefingService, newsTopHeadlinesTodayExecute } from "./briefing-tool.js";
export { createRssDatasetAdapter } from "./source/rss-source.js";
