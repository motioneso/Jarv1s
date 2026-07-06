export { registerSportsRoutes } from "./routes.js";
export type { SportsRoutesDependencies, SportsFollowsWriter } from "./routes.js";
export {
  SPORTS_MODULE_ID,
  sportsModuleManifest,
  sportsModuleSqlMigrationDirectory
} from "./manifest.js";
export {
  configureSportsBriefingService,
  sportsFollowedFactsTodayExecute
} from "./briefing-tool.js";
export { createEspnDatasetAdapter } from "./source/espn-source.js";
