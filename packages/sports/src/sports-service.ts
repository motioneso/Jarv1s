import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type {
  FollowedTeamCard,
  GameSide,
  GameSummary,
  IsoDate,
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
  SportsSource
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
  private readonly standings = new SportsCache<StandingsRow[]>();
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
      const teams = await this.cached(
        this.teams,
        entry.competitionKey,
        TEAMS_TTL_MS,
        () => this.source.listTeams(entry.competitionKey),
        [],
        throwaway
      );
      competitions.push({
        competitionKey: entry.competitionKey,
        label: entry.label,
        kind: entry.kind,
        marquee: entry.marquee,
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
    const standingsByComp = new Map<string, StandingsRow[]>();
    const headlinesByComp = new Map<string, SourceHeadline[]>();
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
          [],
          state
        )
      );
      headlinesByComp.set(
        key,
        await this.cached(
          this.headlines,
          key,
          HEADLINES_TTL_MS,
          () => this.source.getHeadlines(key),
          [],
          state
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
          standingsByComp.get(follow.competitionKey) ?? [],
          headlinesByComp.get(follow.competitionKey) ?? [],
          schedule
        )
      );
    }

    const hero = this.buildHero(followedTeams, scoreboardByComp, competitionKeys, headlinesByComp);

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
        rows: standingsByComp.get(key) ?? []
      }))
      .filter((group) => group.rows.length > 0);

    const headlines = competitionKeys.flatMap((key) => headlinesByComp.get(key) ?? []);

    return {
      hero,
      followed: cards,
      scoreboard,
      headlines,
      standings,
      followedTeamKeys: followedTeams.map((f) => f.teamKey),
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

  private buildHero(
    followedTeams: readonly (SportsFollowDto & { teamKey: string })[],
    scoreboardByComp: Map<string, GameSummary[]>,
    competitionKeys: readonly string[],
    headlinesByComp: Map<string, SourceHeadline[]>
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
    const topHeadline = competitionKeys.flatMap((key) => headlinesByComp.get(key) ?? [])[0] ?? null;
    return { mode: "story", headline: topHeadline };
  }

  private buildCard(
    follow: SportsFollowDto & { teamKey: string },
    games: readonly GameSummary[],
    standings: readonly StandingsRow[],
    headlines: readonly SourceHeadline[],
    schedule: readonly GameSummary[]
  ): FollowedTeamCard {
    const { teamKey } = follow;
    const comp = follow.competitionKey;
    const competitionLabel = catalogEntry(comp)?.label ?? comp;
    const todayGame = findTeamGame(games, teamKey);
    const todaySide = todayGame ? sideFor(todayGame, teamKey) : undefined;
    const name = todaySide?.name ?? teamNameFromSchedule(schedule, teamKey) ?? teamKey;
    const crestUrl = todaySide?.crestUrl ?? null;

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
      primary = headlines[0]?.title ?? "No recent news";
    }

    return {
      teamKey,
      competitionKey: comp,
      competitionLabel,
      name,
      crestUrl,
      status,
      primary,
      form: computeForm(schedule, teamKey),
      standing: standingLine(standings, teamKey),
      nextMatch: nextMatchLine(schedule, teamKey, this.now()),
      rationale: `You follow ${name}.`
    };
  }
}

// --- pure helpers ---------------------------------------------------------

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
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

function teamNameFromSchedule(
  schedule: readonly GameSummary[],
  teamKey: string
): string | undefined {
  for (const game of schedule) {
    const side = sideFor(game, teamKey);
    if (side) return side.name;
  }
  return undefined;
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

function nextMatchLine(
  schedule: readonly GameSummary[],
  teamKey: string,
  now: Date
): string | null {
  const nowIso = now.toISOString();
  const next = schedule
    .filter((g) => g.state !== "final" && g.startsAt > nowIso && sideFor(g, teamKey))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return null;
  const opponent = opponentFor(next, teamKey);
  if (!opponent) return null;
  const preposition = next.home.teamKey === teamKey ? "vs" : "at";
  return `${preposition} ${opponent.shortName}`;
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
