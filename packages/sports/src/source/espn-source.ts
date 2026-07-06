import type { GameSide, GameSummary, IsoDate, StandingsRow } from "@jarv1s/shared";
import type { ExternalSourceAdapter, ExternalSourceAdapterContext } from "@jarv1s/module-sdk";

import { catalogEntry } from "./catalog.js";
import type { SourceHeadline, SourceTeamRef, StandingsTable } from "./sports-source.js";

// ESPN's unofficial public JSON (no key). Two base hosts are in play: the `site.api`
// host serves scoreboard/news/teams/schedule; standings lives under a different `/apis/v2`
// path on the same host — both paths resolve to the single `site.api.espn.com` fetchHost
// declared on the sports module's `externalSources` manifest entry. Everything is reached only
// through this adapter (LOADER-SEAM(sports)), and only through the runtime's pinned `fetchFn`.
const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE_BASE = "https://site.api.espn.com/apis/v2/sports";

// Hosts ESPN crest/photo URLs resolve to (team.logos + article images).
export const ESPN_IMAGE_HOSTS: readonly string[] = ["a.espncdn.com", "s.secure.espncdn.com"];

export const ESPN_FETCH_HOSTS: readonly string[] = ["site.api.espn.com"];

// --- Minimal shapes for the fields we read (ESPN payloads carry far more) ------------------

interface EspnCompetitor {
  readonly homeAway?: string;
  readonly winner?: boolean;
  readonly score?: string;
  readonly team?: {
    readonly id?: string;
    readonly abbreviation?: string;
    readonly displayName?: string;
    readonly shortDisplayName?: string;
    readonly logo?: string;
  };
  readonly records?: readonly { readonly summary?: string }[];
}

interface EspnEvent {
  readonly id?: string;
  readonly date?: string;
  readonly competitions?: readonly {
    readonly competitors?: readonly EspnCompetitor[];
    readonly status?: { readonly type?: { readonly state?: string; readonly detail?: string } };
  }[];
}

interface EspnStandingsEntry {
  readonly team?: {
    readonly id?: string;
    readonly abbreviation?: string;
    readonly displayName?: string;
  };
  readonly note?: unknown;
  readonly stats?: readonly { readonly name?: string; readonly value?: number }[];
}

// --- Helpers -------------------------------------------------------------------------------

function resolve(competitionKey: string): { sport: string; league: string } {
  const entry = catalogEntry(competitionKey);
  if (!entry) throw new Error(`unknown competition: ${competitionKey}`);
  return { sport: entry.espnSport, league: entry.espnLeague };
}

async function fetchJson(fetchFn: typeof fetch, url: string, label: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`ESPN ${label} returned ${response.status}`);
  }
  return response.json();
}

function mapState(state: string | undefined): GameSummary["state"] {
  if (state === "in") return "live";
  if (state === "post") return "final";
  return "pre";
}

function toSide(competitor: EspnCompetitor | undefined): GameSide {
  const team = competitor?.team;
  const teamKey = (team?.abbreviation ?? team?.id ?? "").toLowerCase();
  const scoreRaw = competitor?.score;
  const score = scoreRaw === undefined || scoreRaw === "" ? null : Number(scoreRaw);
  return {
    teamKey,
    name: team?.displayName ?? teamKey,
    shortName: team?.shortDisplayName ?? team?.displayName ?? teamKey,
    crestUrl: team?.logo ?? null,
    score: score === null || Number.isNaN(score) ? null : score,
    record: competitor?.records?.[0]?.summary ?? null,
    winner: competitor?.winner === true
  } satisfies GameSide;
}

function toGame(event: EspnEvent, competitionKey: string): GameSummary {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
  const type = competition?.status?.type;
  return {
    id: event.id ?? "",
    competitionKey,
    startsAt: event.date ?? "",
    state: mapState(type?.state),
    statusDetail: type?.detail ?? "",
    home: toSide(home),
    away: toSide(away)
  };
}

function statValue(
  stats: readonly { readonly name?: string; readonly value?: number }[] | undefined,
  name: string
): number | undefined {
  return stats?.find((s) => s.name === name)?.value;
}

function toStandingsRow(entry: EspnStandingsEntry): StandingsRow {
  const teamKey = (entry.team?.abbreviation ?? entry.team?.id ?? "").toLowerCase();
  return {
    teamKey,
    name: entry.team?.displayName ?? teamKey,
    rank: statValue(entry.stats, "rank") ?? 0,
    points: statValue(entry.stats, "points") ?? null,
    wins: statValue(entry.stats, "wins") ?? 0,
    losses: statValue(entry.stats, "losses") ?? 0,
    draws: statValue(entry.stats, "ties") ?? null,
    winPercent: statValue(entry.stats, "winPercent") ?? null,
    qualifies: entry.note != null
  };
}

// --- Per-dataset fetchers --------------------------------------------------------------------
// Params below are validated only by shape (the dataset runtime's params are untyped
// `Record<string, unknown>`, per the connector SDK's `ExternalSourceAdapter` contract); the
// module's own service layer is the trusted caller and always passes the fields declared here.

export interface EspnTeamsParams {
  readonly competitionKey: string;
}

export interface EspnScoreboardParams {
  readonly competitionKey: string;
  readonly day: IsoDate;
}

export interface EspnScheduleParams {
  readonly teamKey: string;
  readonly competitionKey: string;
}

export interface EspnStandingsParams {
  readonly competitionKey: string;
}

export interface EspnHeadlinesParams {
  readonly competitionKey: string;
}

async function listTeams(fetchFn: typeof fetch, params: EspnTeamsParams): Promise<SourceTeamRef[]> {
  const { competitionKey } = params;
  const { sport, league } = resolve(competitionKey);
  const data = (await fetchJson(
    fetchFn,
    `${SITE_BASE}/${sport}/${league}/teams`,
    `${league} teams`
  )) as {
    sports?: readonly {
      leagues?: readonly {
        teams?: readonly {
          team?: {
            id?: string;
            abbreviation?: string;
            displayName?: string;
            shortDisplayName?: string;
            logos?: readonly { href?: string }[];
          };
        }[];
      }[];
    }[];
  };
  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map(({ team }) => {
    const teamKey = (team?.abbreviation ?? team?.id ?? "").toLowerCase();
    return {
      teamKey,
      competitionKey,
      name: team?.displayName ?? teamKey,
      shortName: team?.shortDisplayName ?? team?.displayName ?? teamKey,
      crestUrl: team?.logos?.[0]?.href ?? null,
      sourceTeamId: team?.id ?? null
    } satisfies SourceTeamRef;
  });
}

async function getScoreboard(
  fetchFn: typeof fetch,
  params: EspnScoreboardParams
): Promise<GameSummary[]> {
  const { competitionKey, day } = params;
  const { sport, league } = resolve(competitionKey);
  const dates = day.replace(/-/g, "");
  const data = (await fetchJson(
    fetchFn,
    `${SITE_BASE}/${sport}/${league}/scoreboard?dates=${dates}`,
    `${league} scoreboard`
  )) as { events?: readonly EspnEvent[] };
  return (data.events ?? []).map((event) => toGame(event, competitionKey));
}

async function getSchedule(
  fetchFn: typeof fetch,
  params: EspnScheduleParams
): Promise<GameSummary[]> {
  const { teamKey, competitionKey } = params;
  const { sport, league } = resolve(competitionKey);
  const data = (await fetchJson(
    fetchFn,
    `${SITE_BASE}/${sport}/${league}/teams/${teamKey}/schedule`,
    `${league} schedule`
  )) as { events?: readonly EspnEvent[] };
  return (data.events ?? []).map((event) => toGame(event, competitionKey));
}

async function getStandings(
  fetchFn: typeof fetch,
  params: EspnStandingsParams
): Promise<StandingsTable> {
  const { competitionKey } = params;
  const { sport, league } = resolve(competitionKey);
  const data = (await fetchJson(
    fetchFn,
    `${CORE_BASE}/${sport}/${league}/standings`,
    `${league} standings`
  )) as {
    children?: readonly {
      name?: string;
      abbreviation?: string;
      standings?: { entries?: readonly EspnStandingsEntry[] };
    }[];
    standings?: { entries?: readonly EspnStandingsEntry[] };
  };
  const children = data.children ?? [];
  const sections =
    children.length > 0
      ? children.map((child) => ({
          label: child.name ?? child.abbreviation ?? null,
          rows: (child.standings?.entries ?? []).map(toStandingsRow)
        }))
      : [{ label: null, rows: (data.standings?.entries ?? []).map(toStandingsRow) }];
  return { sections: sections.filter((section) => section.rows.length > 0) };
}

async function getHeadlines(
  fetchFn: typeof fetch,
  params: EspnHeadlinesParams
): Promise<SourceHeadline[]> {
  const { competitionKey } = params;
  const { sport, league } = resolve(competitionKey);
  const data = (await fetchJson(
    fetchFn,
    `${SITE_BASE}/${sport}/${league}/news`,
    `${league} news`
  )) as {
    articles?: readonly {
      id?: number | string;
      headline?: string;
      published?: string;
      links?: { web?: { href?: string } };
      images?: readonly { type?: string; url?: string }[];
      categories?: readonly { type?: string; teamId?: number | string }[];
    }[];
  };
  const competitionLabel = catalogEntry(competitionKey)?.label ?? competitionKey;
  return (data.articles ?? []).map((article, index) => {
    const images = article.images ?? [];
    const image = images.find((i) => i.type === "header" && i.url) ?? images.find((i) => i.url);
    return {
      id: String(article.id ?? index),
      competitionKey,
      competitionLabel,
      title: article.headline ?? "",
      url: article.links?.web?.href ?? "",
      publishedAt: article.published ?? "",
      imageUrl: image?.url ?? null,
      teamKeys: [],
      sourceTeamIds: (article.categories ?? [])
        .filter((c) => c.type === "team" && c.teamId != null)
        .map((c) => String(c.teamId))
    };
  });
}

// --- Adapter (the `ExternalSourceAdapter` implementation the dataset runtime dispatches to) --

const ESPN_DATASET_KEYS = ["teams", "scoreboard", "schedule", "standings", "headlines"] as const;
type EspnDatasetKey = (typeof ESPN_DATASET_KEYS)[number];

function isEspnDatasetKey(value: string): value is EspnDatasetKey {
  return (ESPN_DATASET_KEYS as readonly string[]).includes(value);
}

export function createEspnDatasetAdapter(): ExternalSourceAdapter {
  return {
    async fetchDataset(
      datasetKey: string,
      params: Record<string, unknown>,
      ctx: ExternalSourceAdapterContext
    ): Promise<unknown> {
      if (!isEspnDatasetKey(datasetKey)) {
        throw new Error(`ESPN adapter: unknown dataset "${datasetKey}"`);
      }
      switch (datasetKey) {
        case "teams":
          return listTeams(ctx.fetchFn, params as unknown as EspnTeamsParams);
        case "scoreboard":
          return getScoreboard(ctx.fetchFn, params as unknown as EspnScoreboardParams);
        case "schedule":
          return getSchedule(ctx.fetchFn, params as unknown as EspnScheduleParams);
        case "standings":
          return getStandings(ctx.fetchFn, params as unknown as EspnStandingsParams);
        case "headlines":
          return getHeadlines(ctx.fetchFn, params as unknown as EspnHeadlinesParams);
      }
    }
  };
}
