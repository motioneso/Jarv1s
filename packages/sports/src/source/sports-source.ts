import type { GameSummary, Headline, IsoDate, StandingsRow, TeamRef } from "@jarv1s/shared";

// LOADER-SEAM(sports): the swappable data-source contract (D3). ESPN today; a keyed
// provider later is a one-file change. No route/service/manifest may bypass this.
export interface SportsSource {
  listTeams(competitionKey: string): Promise<TeamRef[]>;
  getScoreboard(competitionKey: string, day: IsoDate): Promise<GameSummary[]>;
  getSchedule(teamKey: string, competitionKey: string): Promise<GameSummary[]>;
  getStandings(competitionKey: string): Promise<StandingsRow[]>;
  getHeadlines(competitionKey: string): Promise<Headline[]>;
}
