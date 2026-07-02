import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type {
  FollowedNextMatch,
  FollowedTeamCard,
  FollowedTeamNews,
  GameSide,
  GameSummary,
  Headline,
  IsoDate,
  LeagueNewsGroup,
  OverviewHero,
  ScoreboardGroup,
  SportsCatalogResponse,
  SportsFollowDto,
  SportsOverviewResponse,
  StandingsGroup,
  StandingsRow
} from "@jarv1s/shared";

import { SPORTS_CATALOG, catalogEntry } from "./source/catalog.js";
import { SportsCache } from "./sports-cache.js";
import type {
  SourceHeadline,
  SourceTeamRef,
  SportsSource,
  StandingsTable
} from "./source/sports-source.js";

/** A compact, non-sensitive today-fact for the daily briefing. */
export type FollowedFact = { competitionKey: string; text: string };

/** The subset of `DataContextRunner` the service needs (injectable for tests). */
export interface SportsDataContext {
  withDataContext<T>(
    accessContext: AccessContext,
    work: (scopedDb: DataContextDb) => Promise<T>
  ): Promise<T>;
}

/** The subset of `SportsFollowsRepository` the service reads (injectable for tests). */
export interface SportsFollowsReader {
  list(scopedDb: DataContextDb): Promise<SportsFollowDto[]>;
}

export interface SportsServiceDependencies {
  readonly source: SportsSource;
  readonly dataContext: SportsDataContext;
  readonly repository: SportsFollowsReader;
  /** Clock seam (default `() => new Date()`); tests inject a fixed instant. */
  readonly now?: () => Date;
}

const SCOREBOARD_TTL_MS = 3 * 60 * 1000;
const STANDINGS_TTL_MS = 10 * 60 * 1000;
const HEADLINES_TTL_MS = 10 * 60 * 1000;
const SCHEDULE_TTL_MS = 10 * 60 * 1000;
const TEAMS_TTL_MS = 24 * 60 * 60 * 1000;
const FORM_LENGTH = 5;
const TOP_STORIES_CAP = 6; // Ben 2026-07-01
const EMPTY_STANDINGS: StandingsTable = { sections: [] };

/** Mutable degraded flag threaded through a single composition pass. */
interface DegradeState {
  degraded: boolean;
}

/**
 * Composes the sports overview page, per-team cards, and briefing facts from the
 * swappable `SportsSource`. Every source call is wrapped so a provider failure
 * degrades to authored empties (`degraded: true`) rather than propagating a 500.
 */
export class SportsService {
  private readonly source: SportsSource;
  private readonly dataContext: SportsDataContext;
  private readonly repository: SportsFollowsReader;
  private readonly now: () => Date;

  private readonly scoreboards = new SportsCache<GameSummary[]>();
  private readonly standings = new SportsCache<StandingsTable>();
  private readonly headlines = new SportsCache<SourceHeadline[]>();
  private readonly schedules = new SportsCache<GameSummary[]>();
  private readonly teams = new SportsCache<SourceTeamRef[]>();

  constructor(deps: SportsServiceDependencies) {
    this.source = deps.source;
    this.dataContext = deps.dataContext;
    this.repository = deps.repository;
    this.now = deps.now ?? (() => new Date());
  }

  /** Competitions + teams for the follow picker. Never throws (empty teams on failure). */
  async getCatalog(): Promise<SportsCatalogResponse> {
    const throwaway: DegradeState = { degraded: false };
    const competitions = [];
    for (const entry of SPORTS_CATALOG) {
      const teams = await this.teamsFor(entry.competitionKey, throwaway);
      competitions.push({
        competitionKey: entry.competitionKey,
        label: entry.label,
        kind: entry.kind,
        marquee: entry.marquee,
        standingsShape: entry.standingsShape,
        teams
      });
    }
    return { competitions };
  }

  /** The composed `/api/sports/overview` payload for the actor. */
  async getOverview(accessContext: AccessContext): Promise<SportsOverviewResponse> {
    const follows = await this.dataContext.withDataContext(accessContext, (db) =>
      this.repository.list(db)
    );
    const state: DegradeState = { degraded: false };
    const today = this.today();
    const competitionKeys = unique(follows.map((f) => f.competitionKey));
    const followedTeams = follows.filter((f): f is SportsFollowDto & { teamKey: string } =>
      Boolean(f.teamKey)
    );

    const scoreboardByComp = new Map<string, GameSummary[]>();
    const standingsByComp = new Map<string, StandingsTable>();
    const headlinesByComp = new Map<string, SourceHeadline[]>();
    const teamsByComp = new Map<string, readonly SourceTeamRef[]>();
    for (const key of competitionKeys) {
      scoreboardByComp.set(
        key,
        await this.cached(
          this.scoreboards,
          `${key}:${today}`,
          SCOREBOARD_TTL_MS,
          () => this.source.getScoreboard(key, today),
          [],
          state
        )
      );
      standingsByComp.set(
        key,
        await this.cached(
          this.standings,
          key,
          STANDINGS_TTL_MS,
          () => this.source.getStandings(key),
          EMPTY_STANDINGS,
          state
        )
      );
      const teams = await this.teamsFor(key, state);
      teamsByComp.set(key, teams);
      headlinesByComp.set(
        key,
        resolveHeadlineTeamKeys(
          await this.cached(
            this.headlines,
            key,
            HEADLINES_TTL_MS,
            () => this.source.getHeadlines(key),
            [],
            state
          ),
          teams
        )
      );
    }

    const cards: FollowedTeamCard[] = [];
    for (const follow of followedTeams) {
      const schedule = await this.cached(
        this.schedules,
        `${follow.competitionKey}:${follow.teamKey}`,
        SCHEDULE_TTL_MS,
        () => this.source.getSchedule(follow.teamKey, follow.competitionKey),
        [],
        state
      );
      cards.push(
        this.buildCard(
          follow,
          scoreboardByComp.get(follow.competitionKey) ?? [],
          (standingsByComp.get(follow.competitionKey)?.sections ?? []).flatMap((s) => s.rows),
          headlinesByComp.get(follow.competitionKey) ?? [],
          schedule,
          teamsByComp.get(follow.competitionKey) ?? []
        )
      );
    }

    const topStories = rankTopStories(headlinesByComp, followedTeams);
    const topStoryIds = new Set(topStories.map((h) => h.id));
    const leagueNews: LeagueNewsGroup[] = competitionKeys
      .map((key) => ({
        competitionKey: key,
        competitionLabel: catalogEntry(key)?.label ?? key,
        headlines: [...(headlinesByComp.get(key) ?? [])]
          .sort(byNewest)
          .filter((h) => !topStoryIds.has(h.id))
      }))
      .filter((group) => group.headlines.length > 0);

    const hero = this.buildHero(followedTeams, scoreboardByComp, topStories);

    const scoreboard: ScoreboardGroup[] = competitionKeys
      .map((key) => ({
        competitionKey: key,
        competitionLabel: catalogEntry(key)?.label ?? key,
        games: scoreboardByComp.get(key) ?? []
      }))
      .filter((group) => group.games.length > 0);

    const standings: StandingsGroup[] = competitionKeys
      .map((key) => ({
        competitionKey: key,
        competitionLabel: catalogEntry(key)?.label ?? key,
        standingsShape: catalogEntry(key)?.standingsShape ?? "table",
        sections: standingsByComp.get(key)?.sections ?? []
      }))
      .filter((group) => group.sections.some((section) => section.rows.length > 0));

    return {
      hero,
      followed: cards,
      scoreboard,
      topStories: topStories.map(toPublicHeadline),
      leagueNews: leagueNews.map((group) => ({
        ...group,
        headlines: group.headlines.map(toPublicHeadline)
      })),
      standings,
      followedTeams: followedTeams.map((f) => ({
        competitionKey: f.competitionKey,
        teamKey: f.teamKey
      })),
      degraded: state.degraded
    };
  }

  /**
   * Compact today-facts for followed competitions/teams, for the daily briefing.
   * `scopedDb` is already opened under `withDataContext` by the caller. Never throws.
   */
  async getFollowedFactsForToday(
    scopedDb: DataContextDb,
    _actorUserId: string
  ): Promise<{ facts: FollowedFact[] }> {
    try {
      const follows = await this.repository.list(scopedDb);
      const today = this.today();
      const state: DegradeState = { degraded: false };
      const boards = new Map<string, GameSummary[]>();
      const facts: FollowedFact[] = [];
      for (const follow of follows) {
        const comp = follow.competitionKey;
        if (!boards.has(comp)) {
          boards.set(
            comp,
            await this.cached(
              this.scoreboards,
              `${comp}:${today}`,
              SCOREBOARD_TTL_MS,
              () => this.source.getScoreboard(comp, today),
              [],
              state
            )
          );
        }
        const games = boards.get(comp) ?? [];
        if (follow.teamKey) {
          const game = findTeamGame(games, follow.teamKey);
          if (game) facts.push({ competitionKey: comp, text: teamFact(game, follow.teamKey) });
        } else if (games.length > 0) {
          const label = catalogEntry(comp)?.label ?? comp;
          facts.push({
            competitionKey: comp,
            text: `${games.length} ${label} game${games.length === 1 ? "" : "s"} play today.`
          });
        }
      }
      return { facts };
    } catch {
      return { facts: [] };
    }
  }

  // --- internals ----------------------------------------------------------

  private today(): IsoDate {
    return this.now().toISOString().slice(0, 10);
  }

  private async cached<T>(
    cache: SportsCache<T>,
    key: string,
    ttlMs: number,
    fetchValue: () => Promise<T>,
    fallback: T,
    state: DegradeState
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    try {
      const value = await fetchValue();
      cache.set(key, value, ttlMs);
      return value;
    } catch {
      state.degraded = true;
      return fallback;
    }
  }

  private async teamsFor(
    competitionKey: string,
    state: DegradeState
  ): Promise<readonly SourceTeamRef[]> {
    return this.cached(
      this.teams,
      competitionKey,
      TEAMS_TTL_MS,
      () => this.source.listTeams(competitionKey),
      [],
      state
    );
  }

  private buildHero(
    followedTeams: readonly (SportsFollowDto & { teamKey: string })[],
    scoreboardByComp: Map<string, GameSummary[]>,
    topStories: readonly SourceHeadline[]
  ): OverviewHero {
    let hero: { game: GameSummary; side: GameSide } | undefined;
    let todayCount = 0;
    for (const follow of followedTeams) {
      const game = findTeamGame(scoreboardByComp.get(follow.competitionKey) ?? [], follow.teamKey);
      if (!game) continue;
      todayCount += 1;
      const teamSide = sideFor(game, follow.teamKey);
      if (!teamSide) continue;
      if (!hero || (game.state === "live" && hero.game.state !== "live")) {
        hero = { game, side: teamSide };
      }
    }
    if (hero) {
      const others = todayCount - 1;
      return {
        mode: "gameday",
        game: hero.game,
        rationale: `You follow ${hero.side.name}.`,
        alsoToday:
          others > 0 ? `${others} more followed game${others === 1 ? "" : "s"} today` : null
      };
    }
    const top = topStories[0];
    return { mode: "story", headline: top ? toPublicHeadline(top) : null };
  }

  private buildCard(
    follow: SportsFollowDto & { teamKey: string },
    games: readonly GameSummary[],
    standings: readonly StandingsRow[],
    headlines: readonly SourceHeadline[],
    schedule: readonly GameSummary[],
    teams: readonly SourceTeamRef[]
  ): FollowedTeamCard {
    const { teamKey } = follow;
    const comp = follow.competitionKey;
    const competitionLabel = catalogEntry(comp)?.label ?? comp;
    const todayGame = findTeamGame(games, teamKey);
    const todaySide = todayGame ? sideFor(todayGame, teamKey) : undefined;
    const catalogTeam = teams.find((t) => t.teamKey === teamKey);
    const scheduleSide = scheduleSideFor(schedule, teamKey);
    // D1: today side → catalog → schedule → last-resort uppercase key (fully degraded only)
    const name =
      todaySide?.name ?? catalogTeam?.name ?? scheduleSide?.name ?? teamKey.toUpperCase();
    // A2: same precedence for the crest
    const crestUrl = todaySide?.crestUrl ?? catalogTeam?.crestUrl ?? scheduleSide?.crestUrl ?? null;

    let status: FollowedTeamCard["status"];
    let primary: string;
    if (todayGame && todayGame.state === "live") {
      status = "live";
      primary = scoreLine(todayGame);
    } else if (todayGame) {
      status = "today";
      primary =
        todayGame.state === "final" ? resultLine(todayGame, teamKey) : matchupLine(todayGame);
    } else {
      status = "news";
      primary = "";
    }

    return {
      teamKey,
      competitionKey: comp,
      competitionLabel,
      name,
      crestUrl,
      status,
      primary,
      news: newestTeamHeadline(headlines, teamKey),
      form: computeForm(schedule, teamKey),
      standing: standingLine(standings, teamKey),
      nextMatch: nextMatchFor(schedule, teamKey, this.now()),
      rationale: `You follow ${name}.`
    };
  }
}

// --- pure helpers ---------------------------------------------------------

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resolveHeadlineTeamKeys(
  headlines: readonly SourceHeadline[],
  teams: readonly SourceTeamRef[]
): SourceHeadline[] {
  const byId = new Map<string, string>();
  for (const team of teams) {
    if (team.sourceTeamId !== null) byId.set(team.sourceTeamId, team.teamKey);
  }
  return headlines.map((headline) => ({
    ...headline,
    teamKeys: headline.sourceTeamIds
      .map((id) => byId.get(id))
      .filter((key): key is string => key !== undefined)
  }));
}

function byNewest(a: SourceHeadline, b: SourceHeadline): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

// `SourceHeadline` carries `sourceTeamIds` (provider ids) for the team-key join; strip it
// before a headline reaches a response boundary — required wherever a single headline sits
// inside a `oneOf` (e.g. `hero.headline`), where fast-json-stringify's schema-matching rejects
// objects with properties outside the matched branch instead of silently dropping them.
function toPublicHeadline(headline: Headline): Headline {
  const { id, competitionKey, title, url, publishedAt, imageUrl, teamKeys } = headline;
  return { id, competitionKey, title, url, publishedAt, imageUrl, teamKeys };
}

// Spec §E ranking: (1) headlines tagged with a followed team, newest first;
// (2) the newest headline of each followed competition not already included; cap 6.
function rankTopStories(
  headlinesByComp: ReadonlyMap<string, readonly SourceHeadline[]>,
  followedTeams: readonly (SportsFollowDto & { teamKey: string })[]
): SourceHeadline[] {
  const pairs = new Set(followedTeams.map((f) => `${f.competitionKey}:${f.teamKey}`));
  const picked: SourceHeadline[] = [];
  const pickedIds = new Set<string>();
  const all = [...headlinesByComp.values()].flat().sort(byNewest);
  for (const headline of all) {
    if (
      headline.teamKeys.some((k) => pairs.has(`${headline.competitionKey}:${k}`)) &&
      !pickedIds.has(headline.id)
    ) {
      picked.push(headline);
      pickedIds.add(headline.id);
    }
  }
  for (const comp of unique(followedTeams.map((f) => f.competitionKey))) {
    const newest = [...(headlinesByComp.get(comp) ?? [])]
      .sort(byNewest)
      .find((h) => !pickedIds.has(h.id));
    if (newest) {
      picked.push(newest);
      pickedIds.add(newest.id);
    }
  }
  return picked.slice(0, TOP_STORIES_CAP);
}

function findTeamGame(games: readonly GameSummary[], teamKey: string): GameSummary | undefined {
  return games.find((g) => g.home.teamKey === teamKey || g.away.teamKey === teamKey);
}

function sideFor(game: GameSummary, teamKey: string): GameSide | undefined {
  if (game.home.teamKey === teamKey) return game.home;
  if (game.away.teamKey === teamKey) return game.away;
  return undefined;
}

function opponentFor(game: GameSummary, teamKey: string): GameSide | undefined {
  if (game.home.teamKey === teamKey) return game.away;
  if (game.away.teamKey === teamKey) return game.home;
  return undefined;
}

function scheduleSideFor(schedule: readonly GameSummary[], teamKey: string): GameSide | undefined {
  for (const game of schedule) {
    const side = sideFor(game, teamKey);
    if (side) return side;
  }
  return undefined;
}

function newestTeamHeadline(
  headlines: readonly SourceHeadline[],
  teamKey: string
): FollowedTeamNews | null {
  const newest = headlines
    .filter((h) => h.teamKeys.includes(teamKey))
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  return newest ? { title: newest.title, url: newest.url } : null;
}

function scoreLine(game: GameSummary): string {
  return `${game.away.shortName} ${game.away.score ?? 0} – ${game.home.score ?? 0} ${game.home.shortName}`;
}

function resultOf(side: GameSide, opponent: GameSide): "W" | "D" | "L" {
  if (side.score !== null && opponent.score !== null && side.score === opponent.score) return "D";
  return side.winner ? "W" : "L";
}

function resultLine(game: GameSummary, teamKey: string): string {
  const side = sideFor(game, teamKey);
  const opponent = opponentFor(game, teamKey);
  if (!side || !opponent) return matchupLine(game);
  const result = resultOf(side, opponent);
  const preposition = game.home.teamKey === teamKey ? "vs" : "at";
  return `${result} ${side.score ?? 0}–${opponent.score ?? 0} ${preposition} ${opponent.shortName}`;
}

function matchupLine(game: GameSummary): string {
  return `${game.away.shortName} @ ${game.home.shortName} · ${game.statusDetail}`;
}

function computeForm(
  schedule: readonly GameSummary[],
  teamKey: string
): readonly ("W" | "D" | "L")[] {
  return schedule
    .filter((g) => g.state === "final" && sideFor(g, teamKey))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(-FORM_LENGTH)
    .map((g) => {
      const side = sideFor(g, teamKey);
      const opponent = opponentFor(g, teamKey);
      return side && opponent ? resultOf(side, opponent) : "L";
    });
}

function standingLine(standings: readonly StandingsRow[], teamKey: string): string | null {
  const row = standings.find((r) => r.teamKey === teamKey);
  if (!row) return null;
  if (row.points !== null) return `#${row.rank} · ${row.points} pts`;
  return `#${row.rank} · ${row.wins}-${row.losses}`;
}

function nextMatchFor(
  schedule: readonly GameSummary[],
  teamKey: string,
  now: Date
): FollowedNextMatch | null {
  const nowIso = now.toISOString();
  const next = schedule
    .filter((g) => g.state !== "final" && g.startsAt > nowIso && sideFor(g, teamKey))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return null;
  const opponent = opponentFor(next, teamKey);
  if (!opponent) return null;
  return {
    opponentName: opponent.name,
    homeAway: next.home.teamKey === teamKey ? "home" : "away",
    startsAt: next.startsAt
  };
}

function teamFact(game: GameSummary, teamKey: string): string {
  const side = sideFor(game, teamKey);
  const opponent = opponentFor(game, teamKey);
  const name = side?.name ?? teamKey;
  if (!side || !opponent) return `${name} play today.`;
  if (game.state === "final") {
    const result = resultOf(side, opponent);
    const verb = result === "W" ? "won" : result === "L" ? "lost" : "tied";
    return `${name} ${verb} ${side.score ?? 0}–${opponent.score ?? 0} vs ${opponent.shortName}.`;
  }
  if (game.state === "live") {
    return `${name} play now: ${scoreLine(game)}.`;
  }
  return `${name} play today at ${game.statusDetail}.`;
}
