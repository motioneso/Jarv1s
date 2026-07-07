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

import { hasLiveGame, SportsPage } from "../../packages/sports/src/web/sports-page.js";
import { sportsQueryKeys } from "../../packages/sports/src/web/query-keys.js";

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
    stories: [],
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
            qualifies: true,
            qualificationNote: null,
            qualificationColor: null
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
    summary: "",
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
  client.setQueryData(sportsQueryKeys.overview, overview);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(SportsPage)));
}

describe("SportsPage", () => {
  it("renders the broadsheet masthead", () => {
    const html = render(makeOverview());
    // Header redesign pass: folio strip (date + nameplate) replaced the old sp-masthead block.
    expect(html).toContain("sp-mast");
    expect(html).toContain("sp-mast__brand");
    expect(html).toContain("The Sports Desk");
  });

  it("renders the gameday hero without rationale text, with both teams and scores", () => {
    const html = render(makeOverview());
    expect(html).not.toContain("You follow the Vikings — they are on now");
    expect(html).toContain("Minnesota Vikings");
    expect(html).toContain("Dallas Cowboys");
    expect(html).toContain("21");
    // live pulse present for a live game
    expect(html).toContain("sp-livedot");
    // live score is a scoped aria-live region so screen readers hear updates
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    // competitionLabel must render on every game surface, including the featured score bar
    // (must-not-regress: live badge does not replace the competition label)
    expect(html).toContain('<span class="sp-scorebar__comp">NFL</span>');
  });

  it("does not announce the hero score via aria-live when the game is not live", () => {
    const html = render(
      makeOverview({
        hero: {
          mode: "gameday",
          game: { ...liveGame(), state: "final", statusDetail: "Final" },
          competitionLabel: "NFL",
          rationale: "You follow the Vikings — they are on now",
          alsoToday: "2 other followed games today"
        }
      })
    );
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("aria-atomic");
  });

  it("renders pre-game match times in a clock format, not the raw source status", () => {
    const preGame: GameSummary = {
      ...liveGame(),
      id: "g-pre",
      state: "pre",
      statusDetail: "SOURCE_PREGAME_STRING",
      startsAt: "2026-07-01T23:20:00Z",
      home: { ...liveGame().home, score: null },
      away: { ...liveGame().away, score: null }
    };
    const html = render(
      makeOverview({
        hero: {
          mode: "gameday",
          game: preGame,
          competitionLabel: "NFL",
          rationale: "You follow the Vikings — they play today",
          alsoToday: null
        },
        scoreboard: [{ competitionKey: "nfl", competitionLabel: "NFL", games: [preGame] }]
      })
    );

    expect(html).not.toContain("SOURCE_PREGAME_STRING");
    expect(html).toContain('<span class="sp-scorebar__clock">16:20</span>');
  });

  it("renders the followed-team ticker block with form pips in the header sub-row", () => {
    const html = render(makeOverview());
    expect(html).toContain("sp-ticker");
    expect(html).toContain("MIN 21 – 14 DAL");
    expect(html).toContain("sp-formpip");
    // the fixture card is live — the next-game footer stays hidden until full time
    // (live feedback mrawrk0e); the ticker's own suite covers the non-live footer
    expect(html).not.toContain("sp-tk__next");
  });

  it("renders the 2-up Latest column without the RANKED eyebrow or explainer dek", () => {
    const html = render(makeOverview());
    expect(html).toContain("sp-grid");
    expect(html).toContain("sp-latest");
    expect(html).toContain("Latest");
    expect(html).not.toContain("RANKED");
  });

  it("renders a news-status ticker block as a link to the story", () => {
    const html = render(
      makeOverview({
        followed: [
          followedCard({
            status: "news",
            primary: "",
            stories: [
              {
                title: "Cowboys clinch the division",
                url: "https://example.com/h1",
                publishedAt: "2026-07-01T12:00:00Z",
                imageUrl: null
              }
            ]
          })
        ]
      })
    );
    expect(html).toContain('href="https://example.com/h1"');
    expect(html).toContain("Cowboys clinch the division");
  });

  it("renders the around-the-leagues scores strip with one label per league group", () => {
    const html = render(
      makeOverview({
        scoreboard: [
          { competitionKey: "nfl", competitionLabel: "NFL", games: [liveGame()] },
          {
            competitionKey: "nba",
            competitionLabel: "NBA",
            games: [
              {
                ...liveGame(),
                id: "g2",
                competitionKey: "nba",
                state: "final",
                statusDetail: "Final"
              }
            ]
          }
        ]
      })
    );
    expect(html).toContain("sp-around");
    expect(html).toContain("sp-around__league"); // league label rendered once per group
    // the "Around the leagues" nameplate was cut (live feedback mrav84vx) — league plates only
    expect(html).not.toContain("sp-around__label");
    expect(html).toContain("Scroll left");
    expect(html).toContain("Scroll right");
    // #841 fix: live and final games surface the source statusDetail (clock/period, "Final"),
    // not just the raw score — a bare score alone can't tell a live game from a final one.
    expect(html).toContain("Q3 4:12");
    expect(html).toContain("Final");
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
                    qualifies: false,
                    qualificationNote: null,
                    qualificationColor: null
                  }
                ]
              }
            ]
          },
          standingsGroup()
        ]
      })
    );
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
                    qualifies: true,
                    qualificationNote: null,
                    qualificationColor: null
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
                    qualifies: true,
                    qualificationNote: null,
                    qualificationColor: null
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    // Non-tournament leagues open on "All": one merged league-wide table, best to worst,
    // renumbered so per-section ranks can't collide (live feedback mra33whr + mra50mfr).
    // The old one-section-at-a-time pager (sp-standings__count / Next standings) is gone;
    // sections are reachable through the view <select> instead.
    expect(html).toContain("New York Yankees");
    expect(html).toContain("Houston Astros");
    expect(html).toContain("Select standings league");
    expect(html).toContain("Select standings view");
    expect(html).toContain('<option value="all" selected');
    expect(html).toContain("AL East");
    expect(html).toContain("AL West");
    expect(html).toContain('<td class="pos">2</td>');
    expect(html).not.toContain("sp-standings__count");
    expect(html).not.toContain("Next standings");
  });

  it("offers all catalog leagues in the standings selector, not only ones with data", () => {
    const html = render(makeOverview()); // overview has only one standings group
    expect(html).toContain(">NBA<");
    expect(html).toContain(">Premier League<");
  });

  it("renders a qualification legend from the row note (#841)", () => {
    const html = render(
      makeOverview({
        standings: [
          {
            competitionKey: "eng.1",
            competitionLabel: "Premier League",
            standingsShape: "table",
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
                    qualifies: true,
                    qualificationNote: "UEFA Champions League",
                    qualificationColor: "#2a66d1"
                  }
                ]
              }
            ]
          }
        ],
        followedTeams: [{ competitionKey: "eng.1", teamKey: "ars" }]
      })
    );
    expect(html).toContain("sp-legend");
    expect(html).toContain("UEFA Champions League");
  });

  it("differentiates relegation from qualification structurally, not by color (#841)", () => {
    const html = render(
      makeOverview({
        standings: [
          {
            competitionKey: "eng.1",
            competitionLabel: "Premier League",
            standingsShape: "table",
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
                    qualifies: true,
                    qualificationNote: "UEFA Champions League",
                    qualificationColor: "#2a66d1"
                  },
                  {
                    teamKey: "shf",
                    name: "Sheffield Town",
                    rank: 20,
                    points: 22,
                    wins: 5,
                    losses: 20,
                    draws: 3,
                    winPercent: null,
                    qualifies: true,
                    qualificationNote: "Relegation",
                    qualificationColor: "#c1272d"
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    // Both notes get their own legend entry; the marker is a miniature-row swatch painted
    // with ESPN's per-note color (PL-site-style tint + edge bar — the color pass shipped in
    // the broadsheet redesign, superseding the numeral markers).
    expect(html).toContain("UEFA Champions League");
    expect(html).toContain("Relegation");
    const markerCount = [...html.matchAll(/sp-legend__marker/g)].length;
    expect(markerCount).toBe(2);
    expect(html).toContain("#2a66d1");
    expect(html).toContain("#c1272d");
  });

  it("tiers a news-band league group: lead + shorts with art, tail as headline-only briefs", () => {
    // Supersedes the #841 "one thumbnail per group" rule: Ben asked for MORE photos plus
    // bigger lead stories and headline-only clusters (live feedback mrb0wd68 + mrb0xwwg).
    // Sections now tier by story weight (art +2, dek +1, followed team +2 — mrb47x3h), ties
    // keeping feed order: nb1 (art+dek) leads, nb2/nb3 (art) are shorts, nb4 (art, tied but
    // last) lands in "In brief" where even its art is suppressed.
    const html = render(
      makeOverview({
        leagueNews: [
          {
            competitionKey: "nfl",
            competitionLabel: "NFL",
            headlines: [
              headline("nb1", "nfl", "Cowboys sign veteran lineman", {
                imageUrl: "https://a.espncdn.com/photo/nb1.jpg",
                summary: "A five-year deal shores up the right side."
              }),
              headline("nb2", "nfl", "Giants extend head coach", {
                imageUrl: "https://a.espncdn.com/photo/nb2.jpg"
              }),
              headline("nb3", "nfl", "Bears trade up in the draft", {
                imageUrl: "https://a.espncdn.com/photo/nb3.jpg"
              }),
              headline("nb4", "nfl", "Injury report roundup", {
                imageUrl: "https://a.espncdn.com/photo/nb4.jpg"
              })
            ]
          }
        ]
      })
    );
    expect(html).toContain("sp-newsband__art--lead");
    expect(html).toContain('src="https://a.espncdn.com/photo/nb1.jpg"');
    expect(html).toContain('src="https://a.espncdn.com/photo/nb2.jpg"');
    expect(html).toContain('src="https://a.espncdn.com/photo/nb3.jpg"');
    expect(html).toContain("In brief");
    expect(html).toContain("Injury report roundup");
    expect(html).not.toContain('src="https://a.espncdn.com/photo/nb4.jpg"');
  });

  it("promotes the heaviest story to the feature slot and sizes up heavy leads (mrb47x3h)", () => {
    // Weight = art (+2) + dek (+1) + followed team (+2); the fixture follows nfl/min.
    // nbf2 (5) wins the full-width feature even though the feed buried it last; it leaves its
    // column so it renders exactly once. nbf3 (4, followed + art) clears the big threshold and
    // leads the column a size up; plain nbf1 (0) trails it despite arriving first.
    const html = render(
      makeOverview({
        leagueNews: [
          {
            competitionKey: "nfl",
            competitionLabel: "NFL",
            headlines: [
              headline("nbf1", "nfl", "League schedule notes"),
              headline("nbf3", "nfl", "Vikings lock up their left tackle", {
                imageUrl: "https://a.espncdn.com/photo/nbf3.jpg",
                teamKeys: ["min"]
              }),
              headline("nbf2", "nfl", "Vikings stun Cowboys at the horn", {
                imageUrl: "https://a.espncdn.com/photo/nbf2.jpg",
                summary: "A 60-yard walk-off field goal flips the division race.",
                teamKeys: ["min"]
              })
            ]
          }
        ]
      })
    );
    expect(html).toContain("sp-newsband__feature");
    expect(html).toContain("sp-newsband__title--feature");
    expect(html.split("Vikings stun Cowboys at the horn").length - 1).toBe(1);
    expect(html).toContain("sp-newsband__art--big");
    expect(html).toContain("Vikings lock up their left tackle");
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
    // Header redesign pass: whole-league follows no longer get a ticker block — the league's
    // content lives in the grouped news/standings sections, so no Followed strip renders at all.
    expect(html).not.toContain('aria-label="Followed"');
    expect(html).not.toContain("sp-tk--league");
    expect(html).toContain("Premier League");
    // standings/headlines still render for league-only followers
    expect(html).toContain("Latest");
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
    // the default slate (latest/standings/league news) renders alongside the CTA, not a
    // blank page (H4/#764)
    expect(html).toContain("Latest");
    expect(html).toContain("Vikings clinch division on late field goal");
    expect(html).toContain("Cowboys sign veteran lineman");
  });

  it("still renders the story hero and headlines on a quiet day", () => {
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
    expect(html).not.toContain("No followed team is playing right now");
  });

  it("renders the latest column and league news grid", () => {
    const html = render(makeOverview());
    expect(html).toContain("Latest");
    expect(html).toContain("League news");
    expect(html).toContain("Cowboys sign veteran lineman");
  });

  it("renders the news band with a blurb, continue-reading link, and league filter", () => {
    const html = render(
      makeOverview({
        leagueNews: [
          {
            competitionKey: "nfl",
            competitionLabel: "NFL",
            headlines: [
              headline("nb1", "nfl", "Cowboys sign veteran lineman", {
                summary: "The move shores up a thin offensive line ahead of the playoffs.",
                url: "https://example.test/nb1"
              })
            ]
          }
        ]
      })
    );
    expect(html).toContain("sp-newsband");
    expect(html).toContain("The move shores up a thin offensive line ahead of the playoffs.");
    expect(html).toContain("Continue reading");
    expect(html).toContain('href="https://example.test/nb1"');
    expect(html).toContain("sp-newsband__filter");
  });

  it("renders a ticker-shaped skeleton row while loading", () => {
    const client = new QueryClient(); // nothing primed → loading branch
    const html = renderToString(
      createElement(QueryClientProvider, { client }, createElement(SportsPage))
    );
    expect(html).toContain("sp-skel--ticker");
    expect(html).toContain("sp-skel--hero");
  });

  it("renders a skeleton matching the new composition (two tickers + grid)", () => {
    const client = new QueryClient(); // nothing primed → loading branch
    const html = renderToString(
      createElement(QueryClientProvider, { client }, createElement(SportsPage))
    );
    expect(html).toContain("sp-skel--ticker");
    expect(html).toContain("sp-skel--around");
    expect(html).toContain("sp-skel--hero");
    expect(html).toContain("sp-skel--grid");
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
