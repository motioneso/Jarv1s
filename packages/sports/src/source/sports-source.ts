import type { GameSummary, Headline, IsoDate, StandingsRow, TeamRef } from "@jarv1s/shared";

// LOADER-SEAM(sports): the swappable data-source contract (D3). ESPN today; a keyed
// provider later is a one-file change. No route/service/manifest may bypass this.
export interface SportsSource {
  /**
   * LOADER-SEAM(sports) 7: https hosts that crest/photo URLs returned by this source
   * resolve to. The composition root folds these into the web CSP img-src allowlist,
   * so swapping the source updates the CSP with it.
   */
  readonly imageHosts: readonly string[];
  listTeams(competitionKey: string): Promise<TeamRef[]>;
  getScoreboard(competitionKey: string, day: IsoDate): Promise<GameSummary[]>;
  getSchedule(teamKey: string, competitionKey: string): Promise<GameSummary[]>;
  getStandings(competitionKey: string): Promise<StandingsRow[]>;
  getHeadlines(competitionKey: string): Promise<Headline[]>;
}
