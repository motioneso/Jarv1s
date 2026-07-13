import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import SportsSettings, {
  BrowseGroups,
  followControlState,
  leagueMatches,
  searchLeagueRows,
  SearchResults
} from "../../packages/sports/src/settings/index.js";
import { sportsQueryKeys } from "../../packages/sports/src/web/query-keys.js";

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
// Mirrors the static catalog contract (#907 Task 6): no `teams` field — the pane resolves
// rosters via the lazy leagueTeams query instead, seeded per-test below where needed.
type CompetitionLite = {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly standingsShape: "table" | "groups" | "record";
  readonly confederation: "INTL" | "UEFA" | "CONCACAF" | "CONMEBOL" | "AFC" | "CAF" | "OFC";
};

const DAL: TeamRefLite = {
  teamKey: "dal",
  competitionKey: "nfl",
  name: "Dallas Cowboys",
  shortName: "DAL",
  crestUrl: null
};
const ARS: TeamRefLite = {
  teamKey: "team.ars",
  competitionKey: "epl",
  name: "Arsenal",
  shortName: "ARS",
  crestUrl: null
};

const TWO_LEAGUES: readonly CompetitionLite[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    standingsShape: "record",
    confederation: "INTL"
  },
  {
    competitionKey: "epl",
    label: "Premier League",
    kind: "league",
    marquee: false,
    standingsShape: "table",
    confederation: "UEFA"
  }
];

describe("SportsSettings", () => {
  it("renders search input and browse groups (grouped by confederation) when query is empty", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-search__input");
    // Browse mode now owns the empty-query state: confederation groups render...
    // React escapes "&" to "&amp;" in the SSR string output.
    expect(html).toContain("US majors &amp; global");
    expect(html).toContain("Europe · UEFA");
    expect(html).toContain("NFL");
    expect(html).toContain("Premier League");
    // ...and the old flat search hint is gone.
    expect(html).not.toContain("Search above to find teams or leagues to follow.");
  });

  it("shows a target-named retry note (not the generic pane banner) after a failed follow", async () => {
    // Exercise via toggle() directly is not possible from SSR string tests (no interactivity);
    // this test asserts the OLD generic banner string is gone from source-level review instead —
    // covered by the E2E spec (Task 4) for the interactive path. Here we only assert the static
    // SSR render (no follows, no error) never contains the old banner text.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
    client.setQueryData(FOLLOWS_KEY, { follows: [] });
    const html = renderWithQuery(client);
    expect(html).not.toContain("Could not load or save sports follows. Try again.");
  });

  it("marks a followed team active", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, {
      competitions: [TWO_LEAGUES[1]],
      degraded: false
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    // Followed-chip roster resolution fetches the league's teams via the shared leagueTeams key
    // (#907 spec §4.3) — seed it so the chip can resolve "ARS" instead of falling back to the key.
    client.setQueryData(sportsQueryKeys.leagueTeams("epl"), { teams: [ARS], degraded: false });
    const html = renderWithQuery(client);
    // Followed team renders as a removable chip in the summary row.
    expect(html).toContain("sp-chip");
    expect(html).toContain("ARS");
  });

  it("renders a followed team's crest image in the summary chip when crestUrl exists", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const arsWithCrest = { ...ARS, crestUrl: "https://example.com/crests/ars.png" };
    client.setQueryData(CATALOG_KEY, {
      competitions: [TWO_LEAGUES[1]],
      degraded: false
    });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    client.setQueryData(sportsQueryKeys.leagueTeams("epl"), {
      teams: [arsWithCrest],
      degraded: false
    });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-chip");
    expect(html).toContain('src="https://example.com/crests/ars.png"');
  });

  it("renders followed-team summary chips when follows exist", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    client.setQueryData(sportsQueryKeys.leagueTeams("epl"), { teams: [ARS], degraded: false });
    const html = renderWithQuery(client);
    expect(html).toContain("sp-summary");
    expect(html).toContain("sp-chip");
    expect(html).toContain("ARS");
    // removable affordance present
    expect(html).toContain("sp-chip__remove");
  });

  it("renders a whole-league follow as an All-league chip", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        { id: "fl", competitionKey: "nfl", teamKey: null, createdAt: "2026-01-01T00:00:00Z" }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("All NFL");
  });

  it("renders an orphan follow (unknown competitionKey) with a notice instead of a raw key", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
    client.setQueryData(FOLLOWS_KEY, {
      follows: [
        {
          id: "orphan1",
          competitionKey: "xyz.retired",
          teamKey: null,
          createdAt: "2026-01-01T00:00:00Z"
        }
      ]
    });
    const html = renderWithQuery(client);
    expect(html).toContain("Unrecognized league (xyz.retired)");
    // still removable
    expect(html).toContain("sp-chip__remove");
  });

  it("leagueMatches returns competitions whose label matches the query", () => {
    expect(leagueMatches("prem", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["epl"]);
    expect(leagueMatches("nfl", TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["nfl"]);
    expect(leagueMatches("zzz", TWO_LEAGUES)).toHaveLength(0);
    expect(leagueMatches("", TWO_LEAGUES)).toHaveLength(0);
  });

  it("searchLeagueRows: label match, parent-league derivation from server results, and dedupe", () => {
    // Direct label match, no server results.
    expect(searchLeagueRows("prem", [], TWO_LEAGUES).map((c) => c.competitionKey)).toEqual(["epl"]);
    // A server team result surfaces its parent league even when the label doesn't match.
    expect(searchLeagueRows("cowboys", [DAL], TWO_LEAGUES).map((c) => c.competitionKey)).toEqual([
      "nfl"
    ]);
    // Label match + a same-league team result dedupes to one row.
    expect(searchLeagueRows("nfl", [DAL], TWO_LEAGUES).map((c) => c.competitionKey)).toEqual([
      "nfl"
    ]);
    // No label match and no results.
    expect(searchLeagueRows("zzz", [], TWO_LEAGUES)).toHaveLength(0);
    // A result team whose competitionKey isn't in the catalog is skipped, not crashed on.
    const orphanTeam = { ...DAL, competitionKey: "xyz.retired" };
    expect(searchLeagueRows("zzz", [orphanTeam], TWO_LEAGUES)).toHaveLength(0);
  });
});

describe("is-active styling coverage (#691)", () => {
  const followed = new Map([
    [
      "epl::team.ars",
      { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
    ]
  ]);

  it("marks a followed team is-active in search results, unfollowed team not", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "ars",
        results: [ARS],
        partial: false,
        isError: false,
        competitions: TWO_LEAGUES,
        followsByKey: followed,
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).toContain("is-active");
    expect(html).toMatch(/sp-team is-active/);
  });

  it("does not mark an unfollowed team is-active", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "ars",
        results: [ARS],
        partial: false,
        isError: false,
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).not.toContain("is-active");
  });

  it("SearchResults shows a partial-coverage note without swallowing existing results", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "ars",
        results: [ARS],
        partial: true,
        isError: false,
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).toContain("ARS");
    expect(html).toContain("Still covering more leagues");
  });

  it("SearchResults shows the still-warming note when partial and nothing has matched yet", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "zzz",
        results: [],
        partial: true,
        isError: false,
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).toContain("No matches yet");
  });

  it("SearchResults shows the plain no-match note when not partial and nothing matched", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "zzz",
        results: [],
        partial: false,
        isError: false,
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).toContain("No teams or leagues match your search.");
  });

  // #907 IMPORTANT (final-review finding 1): a failed search request must render as a retry
  // note, never as the same "no matches" copy a real empty result gets — that's a false
  // negative a user can't tell apart from "this team isn't in our catalog".
  it("SearchResults shows a retry note (not the false 'no matches' copy) when the search request failed", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "ars",
        results: [],
        partial: false,
        isError: true,
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        onToggle: () => {},
        onRetry: () => {},
        actionState: null
      })
    );
    expect(html).not.toContain("No teams or leagues match your search.");
    expect(html).toContain("Retry");
  });
});

describe("BrowseGroups", () => {
  it("renders an expanded league's teams from expandedTeams", () => {
    const html = renderToString(
      createElement(BrowseGroups, {
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        expandedKey: "epl",
        onExpand: () => {},
        expandedTeams: [ARS],
        expandedLoading: false,
        expandedDegraded: false,
        onRetryExpanded: () => {},
        onToggle: () => {},
        actionState: null
      })
    );
    expect(html).toContain("sp-teamgrid");
    expect(html).toContain("ARS");
    expect(html).toContain('aria-expanded="true"');
  });

  it("renders a retry note when the expanded league's roster fetch is degraded", () => {
    const html = renderToString(
      createElement(BrowseGroups, {
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        expandedKey: "epl",
        onExpand: () => {},
        expandedTeams: [],
        expandedLoading: false,
        expandedDegraded: true,
        onRetryExpanded: () => {},
        onToggle: () => {},
        actionState: null
      })
    );
    expect(html).toContain("Retry");
  });

  it("skips confederation groups with no leagues", () => {
    const html = renderToString(
      createElement(BrowseGroups, {
        competitions: TWO_LEAGUES,
        followsByKey: new Map(),
        expandedKey: null,
        onExpand: () => {},
        expandedTeams: [],
        expandedLoading: false,
        expandedDegraded: false,
        onRetryExpanded: () => {},
        onToggle: () => {},
        actionState: null
      })
    );
    // TWO_LEAGUES only populates INTL and UEFA — the other five confederation headings must not
    // appear (#907: empty groups are skipped entirely, not rendered with a "no leagues" state).
    expect(html).not.toContain("North & Central America");
    expect(html).not.toContain("South America");
    expect(html).not.toContain("Asia · AFC");
    expect(html).not.toContain("Africa · CAF");
    expect(html).not.toContain("Oceania · OFC");
  });
});

describe("followControlState", () => {
  it("inactive team: visible and aria-label both read 'Follow {team}'", () => {
    expect(followControlState("team", "Arsenal", false, null)).toEqual({
      visible: "Follow Arsenal",
      ariaLabel: "Follow Arsenal"
    });
  });
  it("active team: visible reads 'Following', aria-label reads 'Unfollow {team}'", () => {
    expect(followControlState("team", "Arsenal", true, null)).toEqual({
      visible: "Following",
      ariaLabel: "Unfollow Arsenal"
    });
  });
  it("inactive league: visible and aria-label both read 'Follow all of {league}'", () => {
    expect(followControlState("league", "Premier League", false, null)).toEqual({
      visible: "Follow all of Premier League",
      ariaLabel: "Follow all of Premier League"
    });
  });
  it("active league: visible reads 'Following all of {league}', aria-label reads 'Unfollow all of {league}'", () => {
    expect(followControlState("league", "Premier League", true, null)).toEqual({
      visible: "Following all of Premier League",
      ariaLabel: "Unfollow all of Premier League"
    });
  });
  it("pending follow (any variant): both read 'Following…'", () => {
    expect(followControlState("team", "Arsenal", false, "follow")).toEqual({
      visible: "Following…",
      ariaLabel: "Following…"
    });
  });
  it("pending unfollow (any variant): both read 'Unfollowing…'", () => {
    expect(followControlState("league", "Premier League", true, "unfollow")).toEqual({
      visible: "Unfollowing…",
      ariaLabel: "Unfollowing…"
    });
  });
});

describe("sportsQueryKeys.teamSearch", () => {
  // #907 MINOR (final-review finding 4): the server matches search case-insensitively (see
  // sports-service.ts's `.toLowerCase()`), but the React Query cache key didn't normalize case —
  // "Arsenal" and "arsenal" landed in separate cache entries and re-fetched needlessly.
  it("normalizes case so differently-cased queries share one cache entry", () => {
    expect(sportsQueryKeys.teamSearch("Arsenal")).toEqual(sportsQueryKeys.teamSearch("arsenal"));
    expect(sportsQueryKeys.teamSearch("ARSENAL")).toEqual(sportsQueryKeys.teamSearch("arsenal"));
  });
});
