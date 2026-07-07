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
  it("renders a team block with score, form pips, standing, and next match", () => {
    const html = render([card()]);
    expect(html).toContain("sp-ticker");
    expect(html).toContain("Minnesota Vikings");
    expect(html).toContain("MIN 21 – 14 DAL");
    expect(html).toContain("sp-formpip");
    expect(html).toContain("2nd · NFC North");
    expect(html).toContain("vs Green Bay Packers");
    expect(html).toContain("NFL");
    expect(html).toContain("sp-tk__comp");
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
