import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import SportsSettings, {
  filterTeams,
  leagueMatches,
  SearchResults,
  CompetitionGroup
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
  it("renders competition labels and marquee tag on the World Cup", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "fifa.world",
          label: "FIFA World Cup",
          kind: "tournament",
          marquee: true,
          standingsShape: "groups",
          teams: [
            {
              teamKey: "team.bra",
              competitionKey: "fifa.world",
              name: "Brazil",
              shortName: "BRA",
              crestUrl: null
            }
          ]
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("FIFA World Cup");
    expect(html).toContain("Marquee");
    // Collapsed-by-default: team grid hidden, but count hint present.
    expect(html).toContain("1<!-- --> team");
    expect(html).not.toContain("sp-teamgrid");
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

  it("shows a whole-league follow button per competition", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [
        {
          competitionKey: "epl",
          label: "Premier League",
          kind: "league",
          marquee: false,
          standingsShape: "table",
          teams: []
        }
      ]
    });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("Follow all of <!-- -->Premier League");
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

  it("collapses browse groups by default — team grid hidden until expanded", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    // Follow-all affordance still present per competition.
    expect(html).toContain("Follow all of <!-- -->NFL");
    // Collapsed header present.
    expect(html).toContain("sp-grouphead");
    // Team buttons NOT rendered in collapsed initial state.
    expect(html).not.toContain("sp-teamgrid");
    expect(html).not.toContain("Dallas Cowboys");
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
    ["epl::team.ars", { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }]
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

  it("marks a followed team is-active in the expanded competition group, unfollowed team not", () => {
    const html = renderToString(
      createElement(CompetitionGroup, {
        competition: epl,
        followsByKey: followed,
        onToggle: () => {},
        pending: false,
        expanded: true,
        onToggleExpand: () => {}
      })
    );
    expect(html).toContain("is-active");
    expect(html).toMatch(/sp-team is-active/);
  });

  it("does not mark an unfollowed team is-active", () => {
    const html = renderToString(
      createElement(CompetitionGroup, {
        competition: epl,
        followsByKey: new Map(),
        onToggle: () => {},
        pending: false,
        expanded: true,
        onToggleExpand: () => {}
      })
    );
    expect(html).not.toContain("is-active");
  });
});
