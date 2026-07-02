import type { StandingsShape } from "@jarv1s/shared";

export interface CatalogEntry {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly standingsShape: StandingsShape;
  readonly espnSport: string;
  readonly espnLeague: string;
}

export const SPORTS_CATALOG: readonly CatalogEntry[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "football",
    espnLeague: "nfl"
  },
  {
    competitionKey: "nba",
    label: "NBA",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "basketball",
    espnLeague: "nba"
  },
  {
    competitionKey: "nhl",
    label: "NHL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "hockey",
    espnLeague: "nhl"
  },
  {
    competitionKey: "mlb",
    label: "MLB",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "baseball",
    espnLeague: "mlb"
  },
  {
    competitionKey: "eng.1",
    label: "Premier League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.1"
  },
  {
    competitionKey: "usa.1",
    label: "MLS",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "usa.1"
  },
  {
    competitionKey: "uefa.champions",
    label: "Champions League",
    kind: "tournament",
    marquee: false,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "uefa.champions"
  },
  {
    competitionKey: "fifa.world",
    label: "FIFA World Cup",
    kind: "tournament",
    marquee: true,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "fifa.world"
  }
];

const BY_KEY = new Map(SPORTS_CATALOG.map((e) => [e.competitionKey, e]));

export function catalogEntry(competitionKey: string): CatalogEntry | undefined {
  return BY_KEY.get(competitionKey);
}
