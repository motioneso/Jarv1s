import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import SportsSettings, {
  filterTeams,
  leagueMatches,
  searchLeagues,
  SearchResults
} from "../../packages/sports/src/settings/index.js";

const CATALOG_KEY = ["sports", "catalog"] as const;
const FOLLOWS_KEY = ["sports", "follows"] as const;

function renderWithQuery(client: QueryClient): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(SportsSettings))
  );
}

type TeamRefLite = {
  readonly teamKey: string;
  readonly competitionKey: string;
  readonly name: string;
  readonly shortName: string;
  readonly crestUrl: string | null;
};
type CompetitionLite = {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly standingsShape: "table" | "groups" | "record";
  readonly teams: readonly TeamRefLite[];
};

const TWO_LEAGUES: readonly CompetitionLite[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    teams: [
      {
        teamKey: "dal",
        competitionKey: "nfl",
        name: "Dallas Cowboys",
        shortName: "DAL",
        crestUrl: null
      }
    ]
  },
  {
    competitionKey: "epl",
    label: "Premier League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    teams: [
      {
        teamKey: "team.ars",
        competitionKey: "epl",
        name: "Arsenal",
        shortName: "ARS",
        crestUrl: null
      }
    ]
  }
];

describe("SportsSettings", () => {
  it("renders search input and hint, no browse groups, when query is empty", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-search__input");
    expect(html).toContain("Search above to find teams or leagues to follow.");
    // Browse sections are gone: no group headers, follow-all rows, or team buttons.
    expect(html).not.toContain("sp-grouphead");
    expect(html).not.toContain("Follow all of");
    expect(html).not.toContain("sp-teamgrid");
    expect(html).not.toContain("Dallas Cowboys");
  });

  it("marks a followed team active", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          standingsShape: "table",
          teams: [
            {
              teamKey: "team.ars",
              competitionKey: "epl",
              name: "Arsenal",
              shortName: "ARS",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    // Followed team renders as a removable chip in the summary row.
    expect(html).toContain("sp-chip");
    expect(html).toContain("ARS");
  });

  it("renders a followed team's crest image in the summary chip when crestUrl exists", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          standingsShape: "table",
          teams: [
            {
              teamKey: "team.ars",
              competitionKey: "epl",
              name: "Arsenal",
              shortName: "ARS",
              crestUrl: "https://example.com/crests/ars.png"
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-chip");
    expect(html).toContain('src="https://example.com/crests/ars.png"');
  });

  it("renders followed-team summary chips when follows exist", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-summary");
    expect(html).toContain("sp-chip");
    expect(html).toContain("ARS");
    // removable affordance present
    expect(html).toContain("sp-chip__remove");
  });

  it("renders a whole-league follow as an All-league chip", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "fl", competitionKey: "nfl", teamKey: null, createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("All NFL");
  });

  it("searchLeagues includes the parent league of matching teams, deduped by competitionKey", () => {
    // Direct label match.
    expect(searchLeagues("prem", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["epl"]);
    // Team match surfaces its parent league even though the label doesn't match.
    expect(searchLeagues("cowboys", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["nfl"]);
    // Label match + team match on the same league dedupes to one row.
    expect(searchLeagues("nfl", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["nfl"]);
    expect(searchLeagues("zzz", TWO_LEAGUES)).toHaveLength(0);
    expect(searchLeagues("", TWO_LEAGUES)).toHaveLength(0);
  });

  it("filterTeams matches team name/shortName and competition label, case-insensitive", () => {
    expect(filterTeams("ars", TWO_LEAGUES)).toHaveLength(1);
    expect(filterTeams("ars", TWO_LEAGUES)[0].team.teamKey).toBe("team.ars");
    expect(filterTeams("cowboys", TWO_LEAGUES)).toHaveLength(1);
    expect(filterTeams("cowboys", TWO_LEAGUES)[0].team.teamKey).toBe("dal");
    // competition label match surfaces that league's teams
    expect(filterTeams("premier", TWO_LEAGUES)[0].team.teamKey).toBe("team.ars");
    // no false positives
    expect(filterTeams("zzz", TWO_LEAGUES)).toHaveLength(0);
    // empty query returns nothing (browse mode owns the empty state)
    expect(filterTeams("", TWO_LEAGUES)).toHaveLength(0);
  });

  it("leagueMatches returns competitions whose label matches the query", () => {
    expect(leagueMatches("prem", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["epl"]);
    expect(leagueMatches("nfl", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["nfl"]);
    expect(leagueMatches("zzz", TWO_LEAGUES)).toHaveLength(0);
    expect(leagueMatches("", TWO_LEAGUES)).toHaveLength(0);
  });
});

describe("is-active styling coverage (#691)", () => {
  const epl = TWO_LEAGUES.find((c) => c.competitionKey === "epl")!;
  const followed = new Map([
    [
      "epl::team.ars",
      { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
    ]
  ]);

  it("marks a followed team is-active in search results, unfollowed team not", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "premier",
        competitions: [epl],
        followsByKey: followed,
        onToggle: () => {},
        pending: false
      })
    );
    expect(html).toContain("is-active");
    expect(html).toMatch(/sp-team is-active/);
  });

  it("does not mark an unfollowed team is-active", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "premier",
        competitions: [epl],
        followsByKey: new Map(),
        onToggle: () => {},
        pending: false
      })
    );
    expect(html).not.toContain("is-active");
  });
});
