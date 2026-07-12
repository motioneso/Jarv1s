export { registerNewsRoutes } from "./routes.js";
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
