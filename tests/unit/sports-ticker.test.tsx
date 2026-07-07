import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { FollowedLeagueRef, FollowedTeamCard } from "@jarv1s/shared";

import { SportsTicker } from "../../packages/sports/src/web/sports-ticker.js";

function card(overrides: Partial<FollowedTeamCard> = {}): FollowedTeamCard {
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
    standing: "2nd · NFC North",
    nextMatch: {
      opponentName: "Green Bay Packers",
      homeAway: "home",
      startsAt: "2026-07-11T20:00:00Z"
    },
    rationale: "You follow the Vikings",
    ...overrides
  };
}

function render(followed: FollowedTeamCard[], leagues: FollowedLeagueRef[] = []): string {
  const client = new QueryClient();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SportsTicker, { followed, leagues })
    )
  );
}

describe("SportsTicker", () => {
  it("renders a live team block with score and header sub-row, footer hidden", () => {
    const html = render([card()]);
    expect(html).toContain("sp-ticker");
    expect(html).toContain("Minnesota Vikings");
    expect(html).toContain("MIN 21 – 14 DAL");
    // standing + form moved into the header sub-row under the team name (mrawlzb7)
    expect(html).toContain("sp-tk__sub");
    expect(html).toContain("sp-formpip");
    expect(html).toContain("2nd · NFC North");
    // the live score owns the card — the next-game footer waits until full time (mrawrk0e)
    expect(html).not.toContain("sp-tk__next");
    // the competition/status eyebrow row was removed (live feedback mratgoq4)
    expect(html).not.toContain("sp-tk__comp");
  });

  // Regression for the standingIsSane guard: the old bare /-\d/ negative-points check also
  // matched every W-L record and hid ALL US-league standings on live data (mraxrdxr, mraz6m43).
  it("shows a W-L record standing but still hides negative-points noise", () => {
    const html = render([card({ standing: "#3 · 10-2" })]);
    expect(html).toContain("#3 · 10-2");
    const noisy = render([card({ standing: "#0 · -7.5 pts" }), card({ standing: "#4 · -2 pts" })]);
    expect(noisy).not.toContain("-7.5 pts");
    expect(noisy).not.toContain("-2 pts");
  });

  it("shows the next-game footer with opponent crest, no visible name (non-live)", () => {
    const html = render([
      card({
        status: "news",
        primary: "",
        news: { title: "Vikings extend their coach", url: "https://example.com/n1" }
      })
    ]);
    expect(html).toContain("sp-tk__next");
    // opponent identity is the crest (initials swatch here — no crestUrl) plus an
    // sr-only name; the visible "vs Green Bay Packers" line is gone (mrawvc48)
    expect(html).toContain("sp-sronly");
    expect(html).toContain("vs Green Bay Packers");
    expect(html).not.toContain("sp-tk__nextlbl");
  });

  it("fills the pre-game today primary with news — footer carries the fixture", () => {
    // mrawrk0e: "Vikings @ Cowboys" duplicated the footer's fixture line pre-game. Hiding the
    // whole slot then left a void (top-area feedback 2026-07-07) — it now shows news instead.
    const html = render([
      card({
        status: "today",
        primary: "Vikings @ Cowboys",
        todayGameState: "pre",
        news: { title: "Vikings name their starter", url: "https://example.com/qb" }
      })
    ]);
    expect(html).not.toContain("Vikings @ Cowboys");
    expect(html).toContain("Vikings name their starter");
    expect(html).toContain("sp-tk__next");
    // no story at all → honest placeholder, still no fixture duplication
    const bare = render([
      card({ status: "today", primary: "Vikings @ Cowboys", todayGameState: "pre" })
    ]);
    expect(bare).not.toContain("Vikings @ Cowboys");
    expect(bare).toContain("No recent news");
    // a finished game's score stays in the primary slot
    const finalHtml = render([
      card({ status: "today", primary: "MIN 24 – 10 DAL", todayGameState: "final" })
    ]);
    expect(finalHtml).toContain("MIN 24 – 10 DAL");
  });

  it("promotes a matched headline into the primary slot instead of 'No recent news'", () => {
    // A storyless news card with matched headlines used to say "No recent news" while linking
    // stories right below it (live feedback mrathm2y) — the first match now leads the card.
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(SportsTicker, {
          followed: [card({ status: "news", primary: "", news: null })],
          headlines: [
            {
              id: "h1",
              title: "Vikings sign a new kicker",
              url: "https://example.com/vikings",
              competitionKey: "nfl",
              competitionLabel: "NFL",
              teamKeys: ["min"],
              imageUrl: null,
              publishedAt: "2026-07-07T12:00:00Z"
            }
          ]
        })
      )
    );
    expect(html).not.toContain("No recent news");
    expect(html).toContain("Vikings sign a new kicker");
  });

  it("renders a news-status team as a link to the story", () => {
    const html = render([
      card({
        status: "news",
        primary: "",
        news: { title: "Cowboys clinch the division", url: "https://example.com/h1" }
      })
    ]);
    expect(html).toContain('href="https://example.com/h1"');
    expect(html).toContain("Cowboys clinch the division");
  });

  it("renders nothing for league-only follows (header redesign pass)", () => {
    // Whole-league follows no longer get a ticker block — the league's content lives in the
    // grouped news/standings sections below, so a league-only follower sees no Followed strip.
    const html = render([], [{ competitionKey: "eng.1", competitionLabel: "Premier League" }]);
    expect(html).toBe("");
  });

  it("is a labeled, keyboard-focusable scroll region with a manage link", () => {
    const html = render([card()]);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Followed teams"');
    expect(html).toContain("/settings?section=modules&amp;module=sports");
  });

  it("renders nothing when there are no follows", () => {
    expect(render([], [])).toBe("");
  });
});
