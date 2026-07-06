import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type {
  FollowedTeamCard,
  GameSummary,
  Headline,
  SportsOverviewResponse,
  StandingsGroup
} from "@jarv1s/shared";

import { hasLiveGame, SportsPage } from "../../apps/web/src/sports/sports-page.js";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

// Root suite renders @jarv1s/web components with react-dom/server (no jsdom /
// @testing-library — deliberately avoided repo-wide; see settings-appearance-pane.test.tsx).
// useQuery reads primed cache synchronously during renderToString, so the resolved
// state is asserted against the SSR HTML string.

function liveGame(): GameSummary {
  return {
    id: "g-live",
    competitionKey: "nfl",
    startsAt: "2026-07-01T23:20:00Z",
    state: "live",
    statusDetail: "Q3 4:12",
    home: {
      teamKey: "min",
      name: "Minnesota Vikings",
      shortName: "MIN",
      crestUrl: null,
      score: 21,
      record: "10-2",
      winner: true
    },
    away: {
      teamKey: "dal",
      name: "Dallas Cowboys",
      shortName: "DAL",
      crestUrl: null,
      score: 14,
      record: "8-4",
      winner: false
    }
  };
}

function followedCard(overrides: Partial<FollowedTeamCard> = {}): FollowedTeamCard {
  return {
    teamKey: "min",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    name: "Minnesota Vikings",
    crestUrl: null,
    status: "live",
    primary: "MIN 21 – 14 DAL",
    news: null,
    form: ["W", "W", "L"],
    standing: "1st · NFC North",
    nextMatch: {
      opponentName: "Green Bay Packers",
      homeAway: "home",
      startsAt: "2026-07-05T20:00:00.000Z"
    },
    rationale: "Playing right now",
    ...overrides
  };
}

function standingsGroup(): StandingsGroup {
  return {
    competitionKey: "epl",
    competitionLabel: "Premier League",
    standingsShape: "record",
    sections: [
      {
        label: null,
        rows: [
          {
            teamKey: "ars",
            name: "Arsenal",
            rank: 1,
            points: 40,
            wins: 12,
            losses: 2,
            draws: 4,
            winPercent: null,
            qualifies: true
          }
        ]
      }
    ]
  };
}

const TEST_COMPETITION_LABELS: Record<string, string> = {
  nfl: "NFL",
  nba: "NBA",
  epl: "Premier League"
};

function headline(
  id: string,
  competitionKey: string,
  title: string,
  overrides: Partial<Headline> = {}
): Headline {
  return {
    id,
    competitionKey,
    competitionLabel: TEST_COMPETITION_LABELS[competitionKey] ?? competitionKey.toUpperCase(),
    title,
    url: "https://example.test/" + id,
    publishedAt: "2026-07-01T18:00:00Z",
    imageUrl: null,
    teamKeys: [],
    ...overrides
  };
}

function makeOverview(overrides: Partial<SportsOverviewResponse> = {}): SportsOverviewResponse {
  return {
    hero: {
      mode: "gameday",
      game: liveGame(),
      competitionLabel: "NFL",
      rationale: "You follow the Vikings — they are on now",
      alsoToday: "2 other followed games today"
    },
    followed: [followedCard()],
    scoreboard: [
      {
        competitionKey: "nfl",
        competitionLabel: "NFL",
        games: [liveGame()]
      }
    ],
    topStories: [headline("h1", "nfl", "Vikings clinch division on late field goal")],
    leagueNews: [
      {
        competitionKey: "nfl",
        competitionLabel: "NFL",
        headlines: [headline("h2", "nfl", "Cowboys sign veteran lineman")]
      }
    ],
    standings: [standingsGroup()],
    followedTeams: [{ competitionKey: "nfl", teamKey: "min" }],
    followedLeagues: [],
    degraded: false,
    ...overrides
  };
}

function render(overview: SportsOverviewResponse): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.sports.overview, overview);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(SportsPage)));
}

describe("SportsPage", () => {
  it("renders the gameday hero with the rationale, both teams, and scores", () => {
    const html = render(makeOverview());
    expect(html).toContain("You follow the Vikings — they are on now");
    expect(html).toContain("Minnesota Vikings");
    expect(html).toContain("Dallas Cowboys");
    expect(html).toContain("21");
    // live pulse present for a live game
    expect(html).toContain("sp-livedot");
  });

  it("renders the followed-team card with form pips and next match", () => {
    const html = render(makeOverview());
    expect(html).toContain("MIN 21 – 14 DAL");
    expect(html).toContain("sp-formpip");
    expect(html).toContain("vs Green Bay Packers");
  });

  it("renders a news-status card as a link to the story", () => {
    const html = render(
      makeOverview({
        followed: [
          followedCard({
            status: "news",
            primary: "",
            news: { title: "Cowboys clinch the division", url: "https://example.com/h1" }
          })
        ]
      })
    );
    expect(html).toContain('href="https://example.com/h1"');
    expect(html).toContain("Cowboys clinch the division");
  });

  it("marks a followed team in the standings and scoreboard (is-you / is-mine)", () => {
    const html = render(
      makeOverview({
        followedTeams: [
          { competitionKey: "nfl", teamKey: "min" },
          { competitionKey: "epl", teamKey: "ars" }
        ]
      })
    );
    expect(html).toContain("is-you");
    expect(html).toContain("Premier League");
    expect(html).toContain("W-L");
    expect(html).not.toContain(">#<");
  });

  it("does not cross-mark a same-teamKey row in another competition (pair-scoped)", () => {
    const html = render(
      makeOverview({
        standings: [
          standingsGroup(),
          {
            competitionKey: "eng.1",
            competitionLabel: "Championship",
            standingsShape: "table",
            sections: [
              {
                label: null,
                rows: [
                  {
                    teamKey: "min",
                    name: "Minnows FC",
                    rank: 5,
                    points: 30,
                    wins: 8,
                    losses: 6,
                    draws: 4,
                    winPercent: null,
                    qualifies: false
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    expect(html).toContain("is-mine");
    const eng1RowStart = html.indexOf("Minnows FC");
    const eng1RowMarkup = html.slice(Math.max(0, eng1RowStart - 400), eng1RowStart);
    expect(eng1RowMarkup).not.toContain("is-you");
  });

  it("shows one standings section at a time with paging controls", () => {
    const html = render(
      makeOverview({
        standings: [
          {
            ...standingsGroup(),
            competitionKey: "mlb",
            competitionLabel: "MLB",
            standingsShape: "table",
            sections: [
              {
                label: "AL East",
                rows: [
                  {
                    teamKey: "nyy",
                    name: "New York Yankees",
                    rank: 1,
                    points: 52,
                    wins: 52,
                    losses: 31,
                    draws: null,
                    winPercent: null,
                    qualifies: true
                  }
                ]
              },
              {
                label: "AL West",
                rows: [
                  {
                    teamKey: "hou",
                    name: "Houston Astros",
                    rank: 1,
                    points: 49,
                    wins: 49,
                    losses: 34,
                    draws: null,
                    winPercent: null,
                    qualifies: true
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    expect(html).toContain("AL East");
    expect(html).toContain("New York Yankees");
    expect(html).toContain("Select standings league");
    expect(html).toContain("<option");
    expect(html).toContain("sp-standings__count");
    expect(html).toContain("Next standings");
    expect(html).not.toContain("AL West");
    expect(html).not.toContain("Houston Astros");
  });

  it("renders the empty state with a follow CTA when nothing is followed", () => {
    const html = render(
      makeOverview({
        followed: [],
        followedTeams: [],
        hero: {
          mode: "story",
          headline: headline("lead", "epl", "The transfer window is heating up")
        }
      })
    );
    expect(html).toContain("Follow your teams");
    expect(html).toContain("Choose teams to follow");
  });

  // #763: a whole-league follow (no individual team) is a first-class picker option — the
  // page must not treat that user as if they follow nothing.
  it("shows a distinct leagues header (not the empty-state CTA) for a league-only follower", () => {
    const html = render(
      makeOverview({
        followed: [],
        followedTeams: [],
        followedLeagues: [{ competitionKey: "epl", competitionLabel: "Premier League" }],
        hero: {
          mode: "story",
          headline: headline("lead", "epl", "The transfer window is heating up")
        }
      })
    );
    expect(html).not.toContain("Follow your teams");
    expect(html).not.toContain("Choose teams to follow");
    expect(html).toContain("Following");
    expect(html).toContain("1 league");
    expect(html).toContain("Premier League");
    // scoreboard/standings/headlines still render for league-only followers
    expect(html).toContain("Top stories");
  });

  // #764: a genuine zero-follow user (no teams, no leagues) previously saw a blank page because
  // the backend never fetched any competition data. The frontend already had this rendering path
  // (`hasSlate` below) — it just needed the backend to actually populate scoreboard/topStories/
  // leagueNews for a zero-follow user (see SportsService.getOverview's default slate).
  it("renders the follow CTA together with a populated default slate for a zero-follow user", () => {
    const html = render(
      makeOverview({
        followed: [],
        followedTeams: [],
        followedLeagues: [],
        hero: {
          mode: "story",
          headline: headline("lead", "nba", "Celtics roll past Heat")
        }
      })
    );
    expect(html).toContain("Follow your teams");
    expect(html).toContain("Choose teams to follow");
    // the default slate (scoreboard/top stories/league news) renders alongside the CTA, not a
    // blank page (H4/#764)
    expect(html).toContain("Top stories");
    expect(html).toContain("Vikings clinch division on late field goal");
    expect(html).toContain("Cowboys sign veteran lineman");
  });

  it("still renders scores and headlines on a quiet day (story hero)", () => {
    const html = render(
      makeOverview({
        hero: {
          mode: "story",
          headline: headline("lead", "epl", "The transfer window is heating up", {
            imageUrl: "https://a.espncdn.com/photo/2026/story.jpg"
          })
        }
      })
    );
    expect(html).toContain("The transfer window is heating up");
    expect(html).toContain("Vikings clinch division on late field goal");
    expect(html).toContain("NFL");
    expect(html).toContain('src="https://a.espncdn.com/photo/2026/story.jpg"');
    expect(html).toContain('href="https://example.test/lead"'); // hero title links out
  });

  it("renders the top stories rail and league news grid", () => {
    const html = render(makeOverview());
    expect(html).toContain("Top stories");
    expect(html).toContain("League news");
    expect(html).toContain("Cowboys sign veteran lineman");
  });
});

// #762: the overview query's refetchInterval decides whether to keep polling by asking
// hasLiveGame() whether the last-fetched payload actually contains a live game — otherwise a
// LiveDot pulses forever over a score that stopped updating the moment the page mounted.
describe("hasLiveGame (#762)", () => {
  const quietHero = {
    mode: "story" as const,
    headline: headline("lead", "epl", "The transfer window is heating up")
  };

  it("is false when nothing in the payload is live", () => {
    const overview = makeOverview({
      hero: quietHero,
      followed: [followedCard({ status: "news" })],
      scoreboard: [
        {
          competitionKey: "nfl",
          competitionLabel: "NFL",
          games: [{ ...liveGame(), state: "final", statusDetail: "FT" }]
        }
      ]
    });
    expect(hasLiveGame(overview)).toBe(false);
  });

  it("is false for undefined data (query hasn't resolved yet)", () => {
    expect(hasLiveGame(undefined)).toBe(false);
  });

  it("is true when the gameday hero's game is live", () => {
    // makeOverview()'s default hero is a live gameday game.
    expect(hasLiveGame(makeOverview())).toBe(true);
  });

  it("is true when a followed team card is live even with a story hero", () => {
    const overview = makeOverview({
      hero: quietHero,
      followed: [followedCard({ status: "live" })],
      scoreboard: [
        {
          competitionKey: "nfl",
          competitionLabel: "NFL",
          games: [{ ...liveGame(), state: "final", statusDetail: "FT" }]
        }
      ]
    });
    expect(hasLiveGame(overview)).toBe(true);
  });

  it("is true when a scoreboard game is live even with no gameday hero or live followed card", () => {
    const overview = makeOverview({
      hero: quietHero,
      followed: [followedCard({ status: "news" })],
      scoreboard: [
        {
          competitionKey: "nfl",
          competitionLabel: "NFL",
          games: [liveGame()]
        }
      ]
    });
    expect(hasLiveGame(overview)).toBe(true);
  });
});
