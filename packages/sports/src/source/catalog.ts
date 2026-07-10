import type { Confederation, StandingsShape } from "@jarv1s/shared";

export interface CatalogEntry {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly standingsShape: StandingsShape;
  readonly espnSport: string;
  readonly espnLeague: string;
  // FIFA confederation grouping for the follow picker's browse mode (#907).
  readonly confederation: Confederation;
}

export const SPORTS_CATALOG: readonly CatalogEntry[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "football",
    espnLeague: "nfl",
    confederation: "INTL"
  },
  {
    competitionKey: "nba",
    label: "NBA",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "basketball",
    espnLeague: "nba",
    confederation: "INTL"
  },
  {
    competitionKey: "nhl",
    label: "NHL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "hockey",
    espnLeague: "nhl",
    confederation: "INTL"
  },
  {
    competitionKey: "mlb",
    label: "MLB",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "baseball",
    espnLeague: "mlb",
    confederation: "INTL"
  },
  {
    competitionKey: "eng.1",
    label: "Premier League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.1",
    confederation: "UEFA"
  },
  // English pyramid tiers 2-5, below the Premier League — all UEFA, all standard tables
  // (#907 slice 2). IDs/team counts verified live via scripts/probe-espn-leagues.mjs.
  {
    competitionKey: "eng.2",
    label: "EFL Championship",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.2",
    confederation: "UEFA"
  },
  {
    competitionKey: "eng.3",
    label: "EFL League One",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.3",
    confederation: "UEFA"
  },
  {
    competitionKey: "eng.4",
    label: "EFL League Two",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.4",
    confederation: "UEFA"
  },
  {
    competitionKey: "eng.5",
    label: "National League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.5",
    confederation: "UEFA"
  },
  {
    competitionKey: "usa.1",
    label: "MLS",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "usa.1",
    confederation: "CONCACAF"
  },
  // Remaining UEFA top flights, plus Americas (#907 slice 3). All live-probed via
  // scripts/probe-espn-leagues.mjs (see task-9 report for the full run) before landing here.
  {
    competitionKey: "esp.1",
    label: "LaLiga",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "esp.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "ger.1",
    label: "Bundesliga",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "ger.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "ita.1",
    label: "Serie A",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "ita.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "fra.1",
    label: "Ligue 1",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "fra.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "ned.1",
    label: "Eredivisie",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "ned.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "por.1",
    label: "Primeira Liga",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "por.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "sco.1",
    label: "Scottish Premiership",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "sco.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "tur.1",
    label: "Süper Lig",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "tur.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "bel.1",
    label: "Belgian Pro League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "bel.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "gre.1",
    label: "Super League Greece",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "gre.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "sui.1",
    label: "Swiss Super League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "sui.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "aut.1",
    label: "Austrian Bundesliga",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "aut.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "den.1",
    label: "Danish Superliga",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "den.1",
    confederation: "UEFA"
  },
  {
    competitionKey: "mex.1",
    label: "Liga MX",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "mex.1",
    confederation: "CONCACAF"
  },
  {
    competitionKey: "crc.1",
    label: "Primera División de Costa Rica",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "crc.1",
    confederation: "CONCACAF"
  },
  {
    competitionKey: "bra.1",
    label: "Brasileirão",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "bra.1",
    confederation: "CONMEBOL"
  },
  {
    competitionKey: "arg.1",
    label: "Liga Profesional de Fútbol",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "arg.1",
    confederation: "CONMEBOL"
  },
  {
    competitionKey: "col.1",
    label: "Primera A",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "col.1",
    confederation: "CONMEBOL"
  },
  {
    competitionKey: "chi.1",
    label: "Primera División de Chile",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "chi.1",
    confederation: "CONMEBOL"
  },
  {
    competitionKey: "uru.1",
    label: "Liga AUF Uruguaya",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "uru.1",
    confederation: "CONMEBOL"
  },
  {
    competitionKey: "uefa.champions",
    label: "Champions League",
    kind: "tournament",
    marquee: false,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "uefa.champions",
    // The CL is unambiguously UEFA-run despite fielding clubs from multiple domestic leagues
    // within Europe — spec §4.1 (#907).
    confederation: "UEFA"
  },
  {
    competitionKey: "fifa.world",
    label: "FIFA World Cup",
    kind: "tournament",
    marquee: true,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "fifa.world",
    // Cross-confederation tournament — no single confederation runs it (#907).
    confederation: "INTL"
  }
];

const BY_KEY = new Map(SPORTS_CATALOG.map((e) => [e.competitionKey, e]));

export function catalogEntry(competitionKey: string): CatalogEntry | undefined {
  return BY_KEY.get(competitionKey);
}
