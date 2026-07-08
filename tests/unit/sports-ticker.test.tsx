import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { FollowedTeamCard, FollowedTeamNews } from "@jarv1s/shared";

import { SportsTicker } from "../../packages/sports/src/web/sports-ticker.js";

// Stories arrive fully-formed on the card now (mrb0pk1n) — no client-side headline matching.
function story(overrides: Partial<FollowedTeamNews> = {}): FollowedTeamNews {
  return {
    title: "Vikings extend their coach",
    url: "https://example.com/n1",
    publishedAt: "2026-07-07T12:00:00Z",
    imageUrl: null,
    ...overrides
  };
}

function card(overrides: Partial<FollowedTeamCard> = {}): FollowedTeamCard {
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
    standing: "2nd · NFC North",
    nextMatch: {
      opponentName: "Green Bay Packers",
      homeAway: "home",
      startsAt: "2026-07-11T20:00:00Z"
    },
    lastMatchAt: null,
    rationale: "You follow the Vikings",
    ...overrides
  };
}

function render(followed: FollowedTeamCard[]): string {
  const client = new QueryClient();
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(SportsTicker, { followed }))
  );
}

describe("SportsTicker", () => {
  it("renders a live team block with score and header sub-row, footer hidden", () => {
    const html = render([card()]);
    expect(html).toContain("sp-ticker");
    expect(html).toContain("Minnesota Vikings");
    expect(html).toContain("MIN 21 – 14 DAL");
    // standing + form moved into the header sub-row under the team name (mrawlzb7)
    expect(html).toContain("sp-feat__sub");
    expect(html).toContain("sp-formpip");
    expect(html).toContain("2nd · NFC North");
    // the live score owns the card — the next-game footer waits until full time (mrawrk0e).
    // FeaturedTeamCard uses the sp-feat prefix (this strip renders it, not TickerTeam).
    expect(html).not.toContain("sp-feat__next");
    // the competition/status eyebrow row was removed (live feedback mratgoq4)
    expect(html).not.toContain("sp-feat__comp");
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
    const html = render([card({ status: "news", primary: "", stories: [story()] })]);
    expect(html).toContain("sp-feat__next");
    // opponent identity is the crest (initials swatch here — no crestUrl) plus an
    // sr-only name; the visible "vs Green Bay Packers" line is gone (mrawvc48)
    expect(html).toContain("sp-sronly");
    expect(html).toContain("vs Green Bay Packers");
    expect(html).not.toContain("sp-feat__nextlbl");
  });

  it("fills the pre-game today primary with news — footer carries the fixture", () => {
    // mrawrk0e: "Vikings @ Cowboys" duplicated the footer's fixture line pre-game. Hiding the
    // whole slot then left a void (top-area feedback 2026-07-07) — it now shows news instead.
    const html = render([
      card({
        status: "today",
        primary: "Vikings @ Cowboys",
        todayGameState: "pre",
        stories: [story({ title: "Vikings name their starter", url: "https://example.com/qb" })]
      })
    ]);
    expect(html).not.toContain("Vikings @ Cowboys");
    expect(html).toContain("Vikings name their starter");
    expect(html).toContain("sp-feat__next");
    // no story at all → honest placeholder, still no fixture duplication
    const bare = render([
      card({ status: "today", primary: "Vikings @ Cowboys", todayGameState: "pre" })
    ]);
    expect(bare).not.toContain("Vikings @ Cowboys");
    expect(bare).toContain("No recent news");
    // a finished game's score stays in the primary slot when no structured resultMatch is present
    const finalHtml = render([
      card({ status: "today", primary: "MIN 24 – 10 DAL", todayGameState: "final" })
    ]);
    expect(finalHtml).toContain("MIN 24 – 10 DAL");
  });

  it("renders a finished game as opponent crest + result, dropping the 'vs' text (annotation #2)", () => {
    // Ben 2026-07-08 /sports #2: when resultMatch is present the score slot leads with the
    // opponent crest and shows just "L 3–9" — the crest carries the identity, so the cheap
    // "L 3–9 vs Blue Jays" text no longer appears. sr-only keeps the opponent name reachable.
    const html = render([
      card({
        status: "today",
        todayGameState: "final",
        primary: "L 3–9 vs Blue Jays",
        resultMatch: {
          opponentName: "Toronto Blue Jays",
          opponentCrestUrl: null,
          scoreText: "L 3–9"
        }
      })
    ]);
    expect(html).toContain("sp-feat__result");
    expect(html).toContain("L 3–9");
    expect(html).toContain("sp-sronly");
    expect(html).toContain("Toronto Blue Jays"); // sr-only opponent name (SSR splits the "vs " prefix)
    // the cheap combined text tail is gone
    expect(html).not.toContain("L 3–9 vs Blue Jays");
  });

  it("leads with the first story and links the rest — up to three per club (mrb0pk1n)", () => {
    // stories[0] takes the primary slot (thumb + title); the remainder render as the small
    // text links. "No recent news" only appears when the club truly has no stories (mrathm2y).
    const html = render([
      card({
        status: "news",
        primary: "",
        stories: [
          story({ title: "Vikings sign a new kicker", url: "https://example.com/vikings" }),
          story({ title: "Camp battle at corner", url: "https://example.com/corner" }),
          story({ title: "Schedule quirks explained", url: "https://example.com/sched" })
        ]
      })
    ]);
    expect(html).not.toContain("No recent news");
    expect(html).toContain("Vikings sign a new kicker");
    expect(html).toContain("sp-feat__stories");
    expect(html).toContain("Camp battle at corner");
    expect(html).toContain("Schedule quirks explained");
  });

  it("renders a news-status team as a link to the story", () => {
    const html = render([
      card({
        status: "news",
        primary: "",
        stories: [story({ title: "Cowboys clinch the division", url: "https://example.com/h1" })]
      })
    ]);
    expect(html).toContain('href="https://example.com/h1"');
    expect(html).toContain("Cowboys clinch the division");
  });

  it("is a labeled, keyboard-focusable scroll region with a manage link", () => {
    const html = render([card()]);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Followed teams"');
    expect(html).toContain("/settings?section=modules&amp;module=sports");
  });

  it("renders nothing when there are no follows", () => {
    // Whole-league follows also render no block here — the league-grouped sections below
    // carry them, so a league-only follower sees no Followed strip (header redesign pass).
    expect(render([])).toBe("");
  });
});
