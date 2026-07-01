export { registerSportsRoutes } from "./routes.js";
export type { SportsRoutesDependencies, SportsFollowsWriter } from "./routes.js";
export {
  SPORTS_MODULE_ID,
  sportsModuleManifest,
  sportsModuleSqlMigrationDirectory
} from "./manifest.js";
export { sportsFollowedFactsTodayExecute } from "./briefing-tool.js";
export { createEspnSportsSource } from "./source/espn-source.js";
export type { SportsSource } from "./source/sports-source.js";
