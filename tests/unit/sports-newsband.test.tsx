import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Headline, LeagueNewsGroup } from "@jarv1s/shared";
import { NewsBand } from "../../packages/sports/src/web/sports-news.js";

// A first-of-league headline with art (+2) + dek (+1) clears BIG_STORY_WEIGHT (4) on the
// first-of-league bonus (+2) → it becomes the FeatureArticle, which is where the #857 body renders.
function headline(over: Partial<Headline> = {}): Headline {
  return {
    id: "4567",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    title: "Cowboys clinch the NFC East",
    url: "https://www.espn.com/nfl/story/_/id/4567",
    publishedAt: "2026-07-07T12:00:00.000Z",
    imageUrl: "https://a.espncdn.com/photo/cowboys.jpg",
    summary: "Dallas wrapped up the division on Sunday.",
    teamKeys: [],
    ...over
  };
}

function group(h: Headline): LeagueNewsGroup {
  return { competitionKey: "nfl", competitionLabel: "NFL", headlines: [h] };
}

describe("NewsBand featured-article body (#857)", () => {
  it("renders the fetched body as multiple paragraphs when present", () => {
    const html = renderToString(
      createElement(NewsBand, {
        groups: [group(headline({ body: "First paragraph.\n\nSecond paragraph." }))],
        followedPairs: new Set<string>()
      })
    );
    expect(html).toContain("sp-newsband__feature");
    // Body split on blank lines → two feature blurb paragraphs, not the one-line dek.
    expect(html).toContain("First paragraph.");
    expect(html).toContain("Second paragraph.");
    const blurbCount = html.split("sp-newsband__blurb--feature").length - 1;
    expect(blurbCount).toBe(2);
    // The dek is superseded by the body, so it must not also render.
    expect(html).not.toContain("Dallas wrapped up the division on Sunday.");
  });

  it("falls back to the one-paragraph dek when no body came through", () => {
    const html = renderToString(
      createElement(NewsBand, {
        groups: [group(headline())], // no body
        followedPairs: new Set<string>()
      })
    );
    expect(html).toContain("sp-newsband__feature");
    expect(html).toContain("Dallas wrapped up the division on Sunday.");
    const blurbCount = html.split("sp-newsband__blurb--feature").length - 1;
    expect(blurbCount).toBe(1);
  });
});
