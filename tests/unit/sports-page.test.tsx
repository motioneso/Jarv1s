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

import { SportsPage } from "../../apps/web/src/sports/sports-page.js";
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
    form: ["W", "W", "L"],
    standing: "1st · NFC North",
    nextMatch: "vs Green Bay · Sun 1:00 PM",
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

function headline(id: string, competitionKey: string, title: string): Headline {
  return {
    id,
    competitionKey,
    title,
    url: "https://example.test/" + id,
    publishedAt: "2026-07-01T18:00:00Z",
    imageUrl: null,
    teamKeys: []
  };
}

function makeOverview(overrides: Partial<SportsOverviewResponse> = {}): SportsOverviewResponse {
  return {
    hero: {
      mode: "gameday",
      game: liveGame(),
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
    headlines: [headline("h1", "nfl", "Vikings clinch division on late field goal")],
    standings: [standingsGroup()],
    followedTeamKeys: ["min"],
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
    expect(html).toContain("vs Green Bay · Sun 1:00 PM");
  });

  it("marks a followed team in the standings and scoreboard (is-you / is-mine)", () => {
    const html = render(
      makeOverview({
        followedTeamKeys: ["min", "ars"]
      })
    );
    expect(html).toContain("is-you");
    expect(html).toContain("Premier League");
    expect(html).toContain("W-L");
    expect(html).not.toContain(">#<");
  });

  it("renders the empty state with a follow CTA when nothing is followed", () => {
    const html = render(
      makeOverview({
        followed: [],
        followedTeamKeys: [],
        hero: {
          mode: "story",
          headline: headline("lead", "epl", "The transfer window is heating up")
        }
      })
    );
    expect(html).toContain("Follow your teams");
    expect(html).toContain("Choose teams to follow");
  });

  it("still renders scores and headlines on a quiet day (story hero)", () => {
    const html = render(
      makeOverview({
        hero: {
          mode: "story",
          headline: headline("lead", "epl", "The transfer window is heating up")
        }
      })
    );
    expect(html).toContain("The transfer window is heating up");
    expect(html).toContain("Vikings clinch division on late field goal");
    expect(html).toContain("NFL");
  });
});
