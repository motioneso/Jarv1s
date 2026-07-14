export { registerSportsRoutes } from "./routes.js";
// #1025: re-exported so root-level tests/uat/seed/* can write follows through the real
// repository (same precedent as @jarv1s/auth's hashPassword / @jarv1s/news's NewsPrefsRepository).
export { SportsFollowsRepository } from "./repository.js";
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
