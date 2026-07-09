import type { DatasetClient } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb } from "@jarv1s/db";
import {
  localDay,
  type FollowedLeagueRef,
  type FollowedNextMatch,
  type FollowedResultMatch,
  type FollowedTeamCard,
  type FollowedTeamNews,
  type GameSide,
  type GameSummary,
  type Headline,
  type IsoDate,
  type LeagueNewsGroup,
  type OverviewHero,
  type ScoreboardGroup,
  type SportsCatalogResponse,
  type SportsFollowDto,
  type SportsOverviewResponse,
  type StandingsGroup
} from "@jarv1s/shared";

import { SPORTS_CATALOG, catalogEntry } from "./source/catalog.js";
import { selectFeature } from "./news-ranking.js";
import type { SourceHeadline, SourceTeamRef, StandingsTable } from "./source/sports-source.js";

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
  /**
   * The dataset-connector-SDK runtime client bound to the sports module's `espn` external
   * source (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md). Replaces the
   * former directly-injected `SportsSource` + in-service `SportsCache` — TTL, staleness policy,
   * and host pinning now live in the manifest declaration + `@jarv1s/datasets` runtime, not here.
   */
  readonly datasetClient: DatasetClient;
  readonly dataContext: SportsDataContext;
  readonly repository: SportsFollowsReader;
  /** Clock seam (default `() => new Date()`); tests inject a fixed instant. */
  readonly now?: () => Date;
}

// ESPN's `scoreboard?dates=YYYYMMDD` param is interpreted in US Eastern time, not UTC — the
// calendar day sent to the source (and cached under) must match that boundary or evening
// games fall on the wrong side of the UTC/Eastern midnight gap (#761).
const ESPN_TIMEZONE = "America/New_York";

const DAY_MS = 86_400_000;

// The overview scoreboard is fetched as yesterday..today (Eastern): a Pacific user's evening
// crosses ESPN's midnight at 9 PM local, after which "today" alone returns tomorrow's slate
// while tonight's live/final games sit under the previous ESPN day (#761's other edge). The
// wider window then needs a "near now" cut so last night's finals and tomorrow's matchups
// don't read as today's game — live always qualifies; anything else must start within this
// distance of now.
const NEAR_GAME_WINDOW_MS = 12 * 60 * 60 * 1000;

const FORM_LENGTH = 5;
const TOP_STORIES_CAP = 6; // Ben 2026-07-01
const EMPTY_STANDINGS: StandingsTable = { sections: [] };

// A brand-new user with zero follows (no teams, no whole-league follows) would otherwise drive
// `competitionKeys` to `[]`, so `getOverview` never fetches any scoreboard/headline data and the
// page renders as a lone empty-state CTA — the opposite of spec §4.6a's "useful any day" promise
// (#764). Fall back to this small fixed slate so the populated-empty-state branch the frontend
// already ships (`hasSlate` in sports-page.tsx) has something to show alongside the "follow your
// teams" CTA. Deliberately the major year-round domestic leagues (not `marquee`, which flags only
// the World Cup for the follow picker) so at least one is in season on any given day: NFL
// (fall/winter), NBA/NHL (fall-spring), MLB (spring-fall), Premier League (fall-spring).
const DEFAULT_SLATE_COMPETITION_KEYS: readonly string[] = ["nfl", "nba", "nhl", "mlb", "eng.1"];

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
  private readonly datasetClient: DatasetClient;
  private readonly dataContext: SportsDataContext;
  private readonly repository: SportsFollowsReader;
  private readonly now: () => Date;

  constructor(deps: SportsServiceDependencies) {
    this.datasetClient = deps.datasetClient;
    this.dataContext = deps.dataContext;
    this.repository = deps.repository;
    this.now = deps.now ?? (() => new Date());
  }

  /** Competitions + teams for the follow picker. Never throws (empty teams on failure). */
  async getCatalog(): Promise<SportsCatalogResponse> {
    const state: DegradeState = { degraded: false };
    // Fetched independently per competition — a slow/failing one shouldn't hold up the rest
    // of the catalog (#765 M2).
    const competitions = await Promise.all(
      SPORTS_CATALOG.map(async (entry) => {
        const teams = await this.teamsFor(entry.competitionKey, state);
        return {
          competitionKey: entry.competitionKey,
          label: entry.label,
          kind: entry.kind,
          marquee: entry.marquee,
          standingsShape: entry.standingsShape,
          teams
        };
      })
    );
    // Surface partial failure to the client instead of silently returning "0 teams" with no
    // explanation (#765 M1); the frontend shows a retry affordance when this is true.
    return { competitions, degraded: state.degraded };
  }

  /** The composed `/api/sports/overview` payload for the actor. */
  async getOverview(accessContext: AccessContext): Promise<SportsOverviewResponse> {
    const rawFollows = await this.dataContext.withDataContext(accessContext, (db) =>
      this.repository.list(db)
    );
    // Skip any follow row whose competitionKey isn't in the catalog (e.g. a retired entry)
    // instead of letting it permanently degrade every load with no explanation — the picker
    // flags these to the user separately as unrecognized (#765 M3).
    const follows = rawFollows.filter((f) => catalogEntry(f.competitionKey) !== undefined);
    const state: DegradeState = { degraded: false };
    const today = this.today();
    // Scoreboard window start — see NEAR_GAME_WINDOW_MS for why one Eastern day isn't enough.
    // ESPN accepts `dates=YYYYMMDD-YYYYMMDD`, so yesterday..today is a single fetch (and a
    // single cache entry) rather than two.
    const dayBefore = localDay(new Date(this.now().getTime() - DAY_MS), ESPN_TIMEZONE);
    // Zero follows (team or whole-league) → fetch the default slate instead of nothing (#764).
    const competitionKeys =
      follows.length > 0
        ? unique(follows.map((f) => f.competitionKey))
        : [...DEFAULT_SLATE_COMPETITION_KEYS];
    const followedTeams = follows.filter((f): f is SportsFollowDto & { teamKey: string } =>
      Boolean(f.teamKey)
    );
    // Whole-league follows (teamKey: null) are first-class in the picker but produce no
    // FollowedTeamCard — surface them separately so the client can tell "follows nothing"
    // apart from "follows leagues, not teams" (#763).
    const followedLeagues: FollowedLeagueRef[] = follows
      .filter((f) => !f.teamKey)
      .map((f) => ({
        competitionKey: f.competitionKey,
        competitionLabel: catalogEntry(f.competitionKey)?.label ?? f.competitionKey
      }));

    // Every competition is fetched independently and in parallel (scoreboard/standings/teams
    // together, then headlines once teams resolves for the team-key join) instead of a serial
    // crawl across all competitions — a cold load no longer pays N sequential round-trips
    // (#765 M2).
    const perComp = await Promise.all(
      competitionKeys.map(async (key) => {
        const [scoreboard, standingsTable, teams] = await Promise.all([
          this.cached<GameSummary[]>(
            "scoreboard",
            { competitionKey: key, day: dayBefore, endDay: today },
            [],
            state
          ),
          this.cached<StandingsTable>("standings", { competitionKey: key }, EMPTY_STANDINGS, state),
          this.teamsFor(key, state)
        ]);
        const headlines = resolveHeadlineTeamKeys(
          await this.cached<SourceHeadline[]>("headlines", { competitionKey: key }, [], state),
          teams
        );
        return { key, scoreboard, standingsTable, teams, headlines };
      })
    );
    const scoreboardByComp = new Map(perComp.map((p) => [p.key, p.scoreboard]));
    const standingsByComp = new Map(perComp.map((p) => [p.key, p.standingsTable]));
    const headlinesByComp = new Map(perComp.map((p) => [p.key, p.headlines]));
    const teamsByComp = new Map(perComp.map((p) => [p.key, p.teams]));

    // One schedule fetch per followed team, also parallelized; `Promise.all` preserves
    // input order so `cards` still lines up with `followedTeams` (#765 M2).
    const cards: FollowedTeamCard[] = await Promise.all(
      followedTeams.map(async (follow) => {
        // Resolve the provider's numeric team id from the catalog: ESPN's soccer schedule
        // endpoint returns an empty payload for abbreviation slugs, which silently zeroed
        // form/next-match on every soccer card (live feedback mrawhx9c). Null falls back to
        // the abbreviation inside the source, which the US leagues accept.
        const sourceTeamId =
          (teamsByComp.get(follow.competitionKey) ?? []).find(
            (team) => team.teamKey === follow.teamKey
          )?.sourceTeamId ?? null;
        // The league-wide feed rarely files a story under a specific team, so most followed
        // cards showed "No recent news" while ESPN's per-team feed had plenty (live feedback
        // mraxssnf). Pull each followed team's own feed — same pattern as the gameday hero
        // block below — and merge it in for this card only; leagueNews stays league-scoped.
        const [schedule, teamFeed] = await Promise.all([
          this.cached<GameSummary[]>(
            "schedule",
            { teamKey: follow.teamKey, competitionKey: follow.competitionKey, sourceTeamId },
            [],
            state
          ),
          this.cached<SourceHeadline[]>(
            "headlines",
            { competitionKey: follow.competitionKey, teamKey: follow.teamKey },
            [],
            state
          )
        ]);
        const compTeams = teamsByComp.get(follow.competitionKey) ?? [];
        const leagueHeadlines = headlinesByComp.get(follow.competitionKey) ?? [];
        const seen = new Set(leagueHeadlines.map((h) => h.id));
        const headlines = [...leagueHeadlines];
        for (const headline of resolveHeadlineTeamKeys(teamFeed, compTeams)) {
          if (seen.has(headline.id)) continue;
          seen.add(headline.id);
          headlines.push(headline);
        }
        return this.buildCard(
          follow,
          scoreboardByComp.get(follow.competitionKey) ?? [],
          // Sections travel whole (not flatMapped) so standingLine can tell a division/group
          // placing from an overall table position (live feedback mraxrdxr, mraz6m43).
          standingsByComp.get(follow.competitionKey)?.sections ?? [],
          headlines,
          schedule,
          compTeams
        );
      })
    );

    // Rank across every followed competition (team or whole-league), not just team-followed
    // ones — otherwise a league-only follower's competition never contributes a top story and
    // the story hero has nothing personalized to fall back to (#763).
    const rankedTopStories = rankTopStories(headlinesByComp, followedTeams, competitionKeys);

    // The hero must not echo what the followed strip already shows (mrb8ahf7). rankTopStories'
    // first tier IS followed-team stories — the same pool teamStories draws each card's ≤3
    // stories from — so the hero's lead routinely duplicated a card's lead. Drop any top story
    // whose url is already on a followed card: the strip owns a followed team's news, and the
    // hero then surfaces that team's deeper stories plus each league's editorial lead instead.
    // Match on url, not id — the same story arrives from the league and per-team feeds under
    // different ids (the same reason teamStories dedups by url).
    const followedStoryUrls = new Set(cards.flatMap((card) => card.stories.map((s) => s.url)));
    const topStories = rankedTopStories.filter((h) => !followedStoryUrls.has(h.url));

    // Band exclusion keys off the FULL ranked set, not the deduped one: a story we pulled from
    // the hero for already being on a card must not resurface in the league news band either, so
    // a followed-team story stays shown exactly once — in its card.
    const topStoryIds = new Set(rankedTopStories.map((h) => h.id));

    const hero = this.buildHero(followedTeams, scoreboardByComp, topStories, this.now());

    // On a gameday, the league-wide news feed rarely covers the featured matchup itself, so
    // the scorebar's photo+blurb band (findFeaturedStory on the client) usually comes up
    // empty. Pull each hero team's own ESPN feed into the pool so a real story about the
    // matchup is available — still honest data, just fetched where ESPN actually files it.
    if (hero.mode === "gameday") {
      const { game } = hero;
      const heroTeams = teamsByComp.get(game.competitionKey) ?? [];
      const teamFeeds = await Promise.all(
        [game.home.teamKey, game.away.teamKey].map((teamKey) =>
          this.cached<SourceHeadline[]>(
            "headlines",
            { competitionKey: game.competitionKey, teamKey },
            [],
            state
          )
        )
      );
      const existing = headlinesByComp.get(game.competitionKey) ?? [];
      // Dedup by url, not id: the same story arrives from the league feed and a hero team's own
      // feed under DIFFERENT ids (ESPN ids are feed-scoped — see the teamStories/followedStoryUrls
      // dedup, which key on url for the same reason). Keying on id here let a matchup story render
      // twice in the NewsBand (Fable M1). url is the story's stable cross-feed identity.
      const seen = new Set(existing.map((h) => h.url));
      const merged = [...existing];
      for (const headline of resolveHeadlineTeamKeys(teamFeeds.flat(), heroTeams)) {
        if (seen.has(headline.url)) continue;
        seen.add(headline.url);
        merged.push(headline);
      }
      headlinesByComp.set(game.competitionKey, merged);
    }

    const leagueNews: LeagueNewsGroup[] = competitionKeys
      .map((key) => ({
        competitionKey: key,
        competitionLabel: catalogEntry(key)?.label ?? key,
        // Feed order preserved deliberately — it's ESPN's editorial prominence ranking, which
        // the news band's tiering leans on (mrb51pnq; see rankTopStories). No byNewest here.
        headlines: (headlinesByComp.get(key) ?? []).filter((h) => !topStoryIds.has(h.id))
      }))
      .filter((group) => group.headlines.length > 0);

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

    // Fill the NewsBand hero with real article body (#857). The featured story is picked
    // CLIENT-side by NewsBand; we recompute the IDENTICAL pick here with the shared ranking
    // (selectFeature over all groups = the client's default "all" filter), fetch just that one
    // article's ESPN body (sanitized to plaintext in the source layer), and splice it onto the
    // matching headline. Body isn't a ranking input, so the pick is stable. Any failure returns
    // "" → we leave `body` off → the client falls back to the one-paragraph dek. Only ONE extra
    // request per overview, cached by article id (immutable post-publish).
    const publicLeagueNews: LeagueNewsGroup[] = leagueNews.map((group) => ({
      ...group,
      headlines: group.headlines.map(toPublicHeadline)
    }));
    const followedPairs = new Set(followedTeams.map((f) => `${f.competitionKey}:${f.teamKey}`));
    const feature = selectFeature(publicLeagueNews, followedPairs);
    const featureBody = feature
      ? await this.cached<string>("articleBody", { articleId: feature.id }, "", state)
      : "";
    const leagueNewsWithBody =
      feature && featureBody
        ? publicLeagueNews.map((group) => ({
            ...group,
            headlines: group.headlines.map((h) =>
              h.id === feature.id ? { ...h, body: featureBody } : h
            )
          }))
        : publicLeagueNews;

    return {
      hero,
      followed: cards,
      scoreboard,
      topStories: topStories.map(toPublicHeadline),
      leagueNews: leagueNewsWithBody,
      standings,
      followedTeams: followedTeams.map((f) => ({
        competitionKey: f.competitionKey,
        teamKey: f.teamKey
      })),
      followedLeagues,
      degraded: state.degraded
    };
  }

  /**
   * One league's standings, fetched on demand (#842). Never throws; degrades to empty sections.
   * For a tournament whose group stage is complete, also returns the current round's fixtures
   * (a ±window of the scoreboard) so the client can show the bracket instead of a stale group
   * table (#839 follow-up); `fixtures` is empty for every other case.
   */
  async getStandings(
    competitionKey: string
  ): Promise<{ group: StandingsGroup; fixtures: GameSummary[] }> {
    const state: DegradeState = { degraded: false };
    const table = await this.cached<StandingsTable>(
      "standings",
      { competitionKey },
      EMPTY_STANDINGS,
      state
    );
    const entry = catalogEntry(competitionKey);
    const group: StandingsGroup = {
      competitionKey,
      competitionLabel: entry?.label ?? competitionKey,
      standingsShape: entry?.standingsShape ?? "table",
      sections: table.sections
    };
    const fixtures =
      entry?.kind === "tournament" && groupStageComplete(table.sections)
        ? await this.currentRoundFixtures(competitionKey, state)
        : [];
    return { group, fixtures };
  }

  /** Scoreboard over a ±window around today, flattened and sorted ascending. Never throws. */
  private async currentRoundFixtures(
    competitionKey: string,
    state: DegradeState
  ): Promise<GameSummary[]> {
    const now = this.now();
    const day = localDay(new Date(now.getTime() - 3 * DAY_MS), ESPN_TIMEZONE);
    const endDay = localDay(new Date(now.getTime() + 4 * DAY_MS), ESPN_TIMEZONE);
    const games = await this.cached<GameSummary[]>(
      "scoreboard",
      { competitionKey, day, endDay },
      [],
      state
    );
    return [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
      const rawFollows = await this.repository.list(scopedDb);
      const follows = rawFollows.filter((f) => catalogEntry(f.competitionKey) !== undefined);
      const today = this.today();
      const state: DegradeState = { degraded: false };
      const boards = new Map<string, GameSummary[]>();
      const facts: FollowedFact[] = [];
      for (const follow of follows) {
        const comp = follow.competitionKey;
        if (!boards.has(comp)) {
          boards.set(
            comp,
            await this.cached<GameSummary[]>(
              "scoreboard",
              { competitionKey: comp, day: today },
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
    return localDay(this.now(), ESPN_TIMEZONE);
  }

  private async cached<T>(
    datasetKey: string,
    params: Record<string, unknown>,
    fallback: T,
    state: DegradeState
  ): Promise<T> {
    const result = await this.datasetClient.getDataset<T>(datasetKey, params, { fallback });
    if (result.degraded) state.degraded = true;
    return result.data;
  }

  private async teamsFor(
    competitionKey: string,
    state: DegradeState
  ): Promise<readonly SourceTeamRef[]> {
    return this.cached<SourceTeamRef[]>("teams", { competitionKey }, [], state);
  }

  private buildHero(
    followedTeams: readonly (SportsFollowDto & { teamKey: string })[],
    scoreboardByComp: Map<string, GameSummary[]>,
    topStories: readonly SourceHeadline[],
    now: Date
  ): OverviewHero {
    let hero: { game: GameSummary; side: GameSide; competitionKey: string } | undefined;
    let todayCount = 0;
    for (const follow of followedTeams) {
      // currentTeamGame (not findTeamGame): the two-day scoreboard also holds last night's
      // final and, past Eastern midnight, tomorrow's matchup — neither may count toward
      // "N more followed games today" nor be offered to the gameday window below.
      const game = currentTeamGame(
        scoreboardByComp.get(follow.competitionKey) ?? [],
        follow.teamKey,
        now
      );
      if (!game) continue;
      todayCount += 1;
      const teamSide = sideFor(game, follow.teamKey);
      if (!teamSide) continue;
      // The gameday masthead+scorebar only leads the page from T−15min through the final
      // whistle; a morning "Today: X at Y" all day pushes real news below the fold (live
      // feedback mra4kqpf). Outside the window the top story leads instead.
      if (!inGamedayWindow(game, now)) continue;
      if (!hero || (game.state === "live" && hero.game.state !== "live")) {
        hero = { game, side: teamSide, competitionKey: follow.competitionKey };
      }
    }
    if (hero) {
      const others = todayCount - 1;
      return {
        mode: "gameday",
        game: hero.game,
        // Editorial UI shows the human label, never the raw key (#765 M4).
        competitionLabel: catalogEntry(hero.competitionKey)?.label ?? hero.competitionKey,
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
    standings: StandingsTable["sections"],
    headlines: readonly SourceHeadline[],
    schedule: readonly GameSummary[],
    teams: readonly SourceTeamRef[]
  ): FollowedTeamCard {
    const { teamKey } = follow;
    const comp = follow.competitionKey;
    const competitionLabel = catalogEntry(comp)?.label ?? comp;
    const todayGame = currentTeamGame(games, teamKey, this.now());
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
    // Distinguishes a finished today game (score worth keeping in the primary slot) from a
    // pre-game one (the ticker's Next footer already carries the fixture, so the matchup line
    // is duplication — live feedback mrawrk0e). Today-widget consumers still get primary as-is.
    let todayGameState: FollowedTeamCard["todayGameState"];
    if (todayGame && todayGame.state === "live") {
      status = "live";
      primary = scoreLine(todayGame);
    } else if (todayGame) {
      status = "today";
      todayGameState = todayGame.state === "final" ? "final" : "pre";
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
      todayGameState,
      stories: teamStories(headlines, teamKey),
      form: computeForm(schedule, teamKey),
      standing: standingLine(standings, teamKey),
      nextMatch: nextMatchFor(schedule, teamKey, this.now()),
      // Crest-led result for the featured strip's score slot (Ben 2026-07-08 /sports #2). Only
      // a finished today game qualifies — a live game keeps its two-abbrev scoreLine, a pre-game
      // has no result yet. The opponent crest replaces the "vs <team>" text `resultLine` appends.
      resultMatch:
        todayGame && todayGame.state === "final" ? resultMatchFor(todayGame, teamKey) : null,
      lastMatchAt: lastMatchFor(schedule, teamKey),
      rationale: `You follow ${name}.`
    };
  }
}

// --- pure helpers ---------------------------------------------------------

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// A tournament group stage is complete once every group is fully played — each section has rows
// and every team in it has played at least (group size − 1) games (a round-robin). Used to switch
// the standings response over to current-round fixtures (#839 follow-up).
function groupStageComplete(sections: StandingsTable["sections"]): boolean {
  if (sections.length === 0) return false;
  return sections.every(
    (section) =>
      section.rows.length > 0 &&
      section.rows.every(
        (row) => row.wins + row.losses + (row.draws ?? 0) >= section.rows.length - 1
      )
  );
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
// Defense-in-depth for #857's "don't trust the feed" threat model: a source href becomes an
// <a href> the reader clicks. TLS + host-pinning protect the FETCH, but a poisoned or editorially
// mangled ESPN payload could still carry a `javascript:`/`data:` href that executes on click (React
// renders such a URL with only a console warning — Fable M2). Allow only http(s) navigations; any
// other scheme, or an unparseable/relative value, collapses to "" (an inert same-page href) rather
// than a script URL. Host is intentionally unrestricted — these are outbound links to the source.
function safeHref(url: string): string {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}

function toPublicHeadline(headline: Headline): Headline {
  const {
    id,
    competitionKey,
    competitionLabel,
    title,
    url,
    publishedAt,
    imageUrl,
    summary,
    teamKeys,
    body
  } = headline;
  return {
    id,
    competitionKey,
    competitionLabel,
    title,
    url: safeHref(url),
    publishedAt,
    imageUrl,
    summary,
    teamKeys,
    // Pass through the sanitized featured-article body (#857) when present. Usually undefined —
    // the service attaches it to the one featured headline AFTER this call — but honoring it here
    // keeps the boundary correct if a source ever supplies it directly. Optional in headlineSchema,
    // so an undefined value is simply omitted from the serialized payload.
    ...(body === undefined ? {} : { body })
  };
}

// Spec §E ranking: (1) headlines tagged with a followed team, newest first;
// (2) the newest headline of each followed competition not already included; cap 6.
// `followedCompetitionKeys` covers every followed competition — team-followed or
// whole-league-followed — so a league-only follower's competition still contributes a
// top story and the story hero has something personalized to fall back to (#763).
// ESPN's league news feed is EDITORIALLY ordered, not chronological (verified live
// 2026-07-07: published timestamps are non-monotonic — the feed is their front-page
// headline block). Feed position is therefore the only real "how big is this story"
// signal we have, and the old byNewest re-sort was destroying it: the hero slot showed
// whichever followed story was filed most recently, not the one ESPN led with (live
// feedback mrb51pnq). Rank by feed position first — recency only breaks ties between
// different leagues' equally-placed stories.
function rankTopStories(
  headlinesByComp: ReadonlyMap<string, readonly SourceHeadline[]>,
  followedTeams: readonly (SportsFollowDto & { teamKey: string })[],
  followedCompetitionKeys: readonly string[]
): SourceHeadline[] {
  const pairs = new Set(followedTeams.map((f) => `${f.competitionKey}:${f.teamKey}`));
  const picked: SourceHeadline[] = [];
  const pickedIds = new Set<string>();

  // Tier 1 — the BIG story. Each followed competition's EDITORIAL lead (front of feed = what the
  // source itself led with), whether or not one of the user's teams is in it. Ben's steer
  // (2026-07-07): "the hero doesn't HAVE to be followed teams — if there's a BIG story we should
  // be showing that." So the league's headline story leads the hero pool ahead of followed-team
  // minutiae; the strip (teamStories) is where a followed team's own news lives. Front-of-feed,
  // not newest, is the editorial lead — same mrb51pnq reasoning as the news band.
  for (const comp of followedCompetitionKeys) {
    const lead = (headlinesByComp.get(comp) ?? [])[0];
    if (lead && !pickedIds.has(lead.id)) {
      picked.push(lead);
      pickedIds.add(lead.id);
    }
  }

  // Tier 2 — personalization. Remaining followed-team stories, feed-rank ordered, fill the pool
  // behind the big leads. The caller then drops any of these already shown on a followed card
  // (mrb8ahf7), so between the two the hero surfaces big + non-duplicated stories.
  const all = [...headlinesByComp.values()]
    .flatMap((list) => list.map((headline, feedRank) => ({ headline, feedRank })))
    .sort((a, b) => a.feedRank - b.feedRank || byNewest(a.headline, b.headline));
  for (const { headline } of all) {
    if (
      headline.teamKeys.some((k) => pairs.has(`${headline.competitionKey}:${k}`)) &&
      !pickedIds.has(headline.id)
    ) {
      picked.push(headline);
      pickedIds.add(headline.id);
    }
  }
  return picked.slice(0, TOP_STORIES_CAP);
}

function findTeamGame(games: readonly GameSummary[], teamKey: string): GameSummary | undefined {
  return games.find((g) => g.home.teamKey === teamKey || g.away.teamKey === teamKey);
}

// "The team's game right now" over the two-day scoreboard window, which can hold two entries
// for one team: last night's final plus today's (or, past Eastern midnight, tomorrow's) game,
// or both ends of a doubleheader. A live game always wins — it is by definition now. Otherwise
// take the game whose start is nearest to now, and only if that start is within
// NEAR_GAME_WINDOW_MS: a 7 PM final at 10 PM qualifies (2h), tomorrow's 4 PM matchup at 10 PM
// does not (18h) — the card then falls back to news status and the Next row (from the schedule
// dataset) still carries the upcoming game. findTeamGame stays for the single-day briefing
// path, where "any game on today's board" is the right question.
function currentTeamGame(
  games: readonly GameSummary[],
  teamKey: string,
  now: Date
): GameSummary | undefined {
  const mine = games.filter((g) => sideFor(g, teamKey) !== undefined);
  const live = mine.find((g) => g.state === "live");
  if (live) return live;
  const distance = (g: GameSummary): number =>
    Math.abs(new Date(g.startsAt).getTime() - now.getTime());
  const nearest = [...mine].sort((a, b) => distance(a) - distance(b))[0];
  return nearest && distance(nearest) <= NEAR_GAME_WINDOW_MS ? nearest : undefined;
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

// Up to three of the club's stories, newest first, from the already-merged league + per-team
// feeds (live feedback mrb0pk1n — "three stories per team… real news for their clubs"). Replaces
// the single newest-headline pick AND the old client-side title-matching in the ticker: the
// service's teamKeys tagging (per-team ESPN feed + resolveHeadlineTeamKeys) is the one source of
// truth for "about this club". Dedup by url — the same story can arrive from both feeds under
// different ids. Split into filter + toTeamStories (#855) so a merged club's card can pool each
// member competition's own-filtered headlines before the shared sort/dedup/cap/map pipeline.
const TEAM_STORY_LIMIT = 3;

function filterTeamHeadlines(
  headlines: readonly SourceHeadline[],
  teamKey: string
): SourceHeadline[] {
  return headlines.filter((h) => h.teamKeys.includes(teamKey));
}

function toTeamStories(headlines: readonly SourceHeadline[]): FollowedTeamNews[] {
  const seen = new Set<string>();
  return headlines
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
    .slice(0, TEAM_STORY_LIMIT)
    .map((h) => ({
      // publishedAt rides along so the ticker can rank idle teams by news freshness (mra54n4h);
      // imageUrl feeds the small thumbnail on the lead story (mra5xnt2).
      title: h.title,
      url: safeHref(h.url), // same javascript:/data: href guard as toPublicHeadline (#857 M2)
      publishedAt: h.publishedAt,
      imageUrl: h.imageUrl
    }));
}

function teamStories(headlines: readonly SourceHeadline[], teamKey: string): FollowedTeamNews[] {
  return toTeamStories(filterTeamHeadlines(headlines, teamKey));
}

// Start time of the team's most recent completed game, from the same season schedule that feeds
// the form pips. The ticker treats "played within the last ten days" as in-season and ranks those
// teams ahead of idle ones (live feedback mra54n4h). Null when the schedule holds no finals yet.
// Generalized to `*Across(games: ResolvedGame[])` (#855) so a merged club's card can pool each
// member competition's own schedule under its own literal teamKey; the single-team functions
// below are thin wrappers over the pooled primitive.
interface ResolvedGame {
  readonly game: GameSummary;
  readonly teamKey: string;
}

function toResolvedGames(schedule: readonly GameSummary[], teamKey: string): ResolvedGame[] {
  return schedule.map((game) => ({ game, teamKey }));
}

function lastMatchAcross(games: readonly ResolvedGame[]): string | null {
  let latest: string | null = null;
  for (const { game, teamKey } of games) {
    if (game.state !== "final" || !sideFor(game, teamKey)) continue;
    if (latest === null || game.startsAt > latest) latest = game.startsAt;
  }
  return latest;
}

function lastMatchFor(schedule: readonly GameSummary[], teamKey: string): string | null {
  return lastMatchAcross(toResolvedGames(schedule, teamKey));
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

function computeFormAcross(games: readonly ResolvedGame[]): readonly ("W" | "D" | "L")[] {
  return games
    .filter(({ game, teamKey }) => game.state === "final" && sideFor(game, teamKey))
    .slice()
    .sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
    .slice(-FORM_LENGTH)
    .map(({ game, teamKey }) => {
      const side = sideFor(game, teamKey);
      const opponent = opponentFor(game, teamKey);
      return side && opponent ? resultOf(side, opponent) : "L";
    });
}

function computeForm(
  schedule: readonly GameSummary[],
  teamKey: string
): readonly ("W" | "D" | "L")[] {
  return computeFormAcross(toResolvedGames(schedule, teamKey));
}

// Gameday hero window (live feedback mra4kqpf): live games always qualify; upcoming games only
// inside the final 15 minutes before kickoff. Finished games don't — the recap is a story.
const GAMEDAY_HERO_LEAD_MS = 15 * 60 * 1000;

function inGamedayWindow(game: GameSummary, now: Date): boolean {
  if (game.state === "live") return true;
  if (game.state !== "pre") return false;
  return new Date(game.startsAt).getTime() - now.getTime() <= GAMEDAY_HERO_LEAD_MS;
}

// The sub-row standing is sport-aware (live feedback mraxrdxr, mraz6m43): leagues whose
// standings arrive in labelled sections (NFL/NBA divisions, tournament groups) show the
// place WITHIN that section ("2nd · NFC East") because that's how those sports are read;
// flat single-table leagues (soccer) keep the overall line ("#4 · 40 pts").
function standingLine(sections: StandingsTable["sections"], teamKey: string): string | null {
  for (const section of sections) {
    const index = section.rows.findIndex((r) => r.teamKey === teamKey);
    if (index === -1) continue;
    const row = section.rows[index]!;
    // Zero games played = the league isn't in progress; its "rank" is carry-over noise like
    // "#14 · 0 pts" and the card is better off without the line (live feedback mra39rlv).
    if (row.wins + row.losses + (row.draws ?? 0) === 0) return null;
    // rank ≤ 0 = the provider omitted the stat and the source's positional fallback didn't
    // apply (hand-built fixtures, older cache entries) — the section order is still the rank.
    const place = row.rank > 0 ? row.rank : index + 1;
    if (section.label) return `${ordinal(place)} · ${shortSectionLabel(section.label)}`;
    if (row.points !== null) return `#${place} · ${row.points} pts`;
    return `#${place} · ${row.wins}-${row.losses}`;
  }
  return null;
}

// Display-only compression for the card sub-row: ESPN division labels like "National League
// West" / "Pacific Division" crowd the pips out of the narrow ticker sub-row (mraxrdxr).
// Kept server-side but OUT of the standings payload — the standings rail wants the full label,
// and adding a field to StandingsSection means response-schema churn (see the fast-json-
// stringify oneOf trap that 500'd the overview this morning). NFL needs no entry: ESPN already
// names its divisions short ("NFC East").
function shortSectionLabel(label: string): string {
  return label
    .replace(/^American League /, "AL ")
    .replace(/^National League /, "NL ")
    .replace(/ Division$/, "");
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function nextMatchAcross(games: readonly ResolvedGame[], now: Date): FollowedNextMatch | null {
  const nowIso = now.toISOString();
  const next = games
    .filter(({ game, teamKey }) => game.state !== "final" && game.startsAt > nowIso && sideFor(game, teamKey))
    .slice()
    .sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))[0];
  if (!next) return null;
  const opponent = opponentFor(next.game, next.teamKey);
  if (!opponent) return null;
  return {
    opponentName: opponent.name,
    homeAway: next.game.home.teamKey === next.teamKey ? "home" : "away",
    startsAt: next.game.startsAt,
    // Footer identifies the opponent by crest, not name (live feedback mrawvc48)
    opponentCrestUrl: opponent.crestUrl
  };
}

function nextMatchFor(
  schedule: readonly GameSummary[],
  teamKey: string,
  now: Date
): FollowedNextMatch | null {
  return nextMatchAcross(toResolvedGames(schedule, teamKey), now);
}

// Result payload for the featured strip's score slot (Ben 2026-07-08 /sports #2). scoreText is
// resultLine() WITHOUT its "vs <opponent>" tail — the opponent crest carries that identity, the
// same crest-leads treatment nextMatchFor uses for the fixture footer. Returns null when the game
// has no resolvable two sides (fully degraded source), so the card falls back to the text slot.
function resultMatchFor(game: GameSummary, teamKey: string): FollowedResultMatch | null {
  const side = sideFor(game, teamKey);
  const opponent = opponentFor(game, teamKey);
  if (!side || !opponent) return null;
  const result = resultOf(side, opponent);
  return {
    opponentName: opponent.name,
    opponentCrestUrl: opponent.crestUrl,
    scoreText: `${result} ${side.score ?? 0}–${opponent.score ?? 0}`
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
