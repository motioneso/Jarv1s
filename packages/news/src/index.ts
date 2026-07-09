export { registerNewsRoutes } from "./routes.js";
export type { NewsRoutesDependencies, NewsPrefsWriter } from "./routes.js";
export { NEWS_MODULE_ID, newsModuleManifest, newsModuleSqlMigrationDirectory } from "./manifest.js";
export { configureNewsBriefingService, newsTopHeadlinesTodayExecute } from "./briefing-tool.js";
export { createRssDatasetAdapter } from "./source/rss-source.js";
