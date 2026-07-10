import type { StandingsShape } from "@jarv1s/shared";

export interface CatalogEntry {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly standingsShape: StandingsShape;
  readonly espnSport: string;
  readonly espnLeague: string;
  // Official competition logo URL (Ben 2026-07-09 /today: "I'd prefer to have the logo to be clear",
  // then "pull the official logos from somewhere else if needed for World Cup, Champions League etc").
  // Explicit per-entry rather than built from a slug because ESPN serves logos under TWO unrelated
  // schemes: US leagues at /i/teamlogos/leagues/500/{slug}.png, but soccer competitions only under
  // /i/leaguelogos/soccer/500/{numericId}.png (the slug path 404s for eng.1/usa.1/uefa.champions/
  // fifa.world). Keeping it a literal field also lets any single competition point at a non-ESPN
  // source later without touching the resolver. null → <Crest> renders the initials swatch.
  readonly logoUrl: string | null;
}

// Base paths for the two ESPN logo schemes, factored out so the entries below read as data.
const ESPN_LEAGUE = "https://a.espncdn.com/i/teamlogos/leagues/500"; // US leagues, keyed by slug
const ESPN_SOCCER = "https://a.espncdn.com/i/leaguelogos/soccer/500"; // soccer, keyed by numeric id

export const SPORTS_CATALOG: readonly CatalogEntry[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "football",
    espnLeague: "nfl",
    logoUrl: `${ESPN_LEAGUE}/nfl.png`
  },
  {
    competitionKey: "nba",
    label: "NBA",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "basketball",
    espnLeague: "nba",
    logoUrl: `${ESPN_LEAGUE}/nba.png`
  },
  {
    competitionKey: "nhl",
    label: "NHL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "hockey",
    espnLeague: "nhl",
    logoUrl: `${ESPN_LEAGUE}/nhl.png`
  },
  {
    competitionKey: "mlb",
    label: "MLB",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    espnSport: "baseball",
    espnLeague: "mlb",
    logoUrl: `${ESPN_LEAGUE}/mlb.png`
  },
  {
    competitionKey: "eng.1",
    label: "Premier League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "eng.1",
    logoUrl: `${ESPN_SOCCER}/23.png` // ESPN soccer id 23 = Premier League
  },
  {
    competitionKey: "usa.1",
    label: "MLS",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: "usa.1",
    logoUrl: `${ESPN_SOCCER}/19.png` // ESPN soccer id 19 = MLS
  },
  {
    competitionKey: "uefa.champions",
    label: "Champions League",
    kind: "tournament",
    marquee: false,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "uefa.champions",
    logoUrl: `${ESPN_SOCCER}/2.png` // ESPN soccer id 2 = UEFA Champions League
  },
  {
    competitionKey: "fifa.world",
    label: "FIFA World Cup",
    kind: "tournament",
    marquee: true,
    standingsShape: "groups",
    espnSport: "soccer",
    espnLeague: "fifa.world",
    logoUrl: `${ESPN_SOCCER}/4.png` // ESPN soccer id 4 = FIFA World Cup
  }
];

const BY_KEY = new Map(SPORTS_CATALOG.map((e) => [e.competitionKey, e]));

export function catalogEntry(competitionKey: string): CatalogEntry | undefined {
  return BY_KEY.get(competitionKey);
}

// Official competition logo (Ben 2026-07-09 /today). Now a direct read of the per-entry `logoUrl`
// (see CatalogEntry) — the old slug-built path 404'd for every soccer competition. Returns null for
// unknown keys or entries without a logo; the <Crest> falls back to the initials swatch on null/404.
export function competitionLogoUrl(competitionKey: string): string | null {
  return BY_KEY.get(competitionKey)?.logoUrl ?? null;
}
