import { describe, expect, it } from "vitest";

import type { SportsFollowDto } from "@jarv1s/shared";

import type { SourceHeadline } from "../../packages/sports/src/source/sports-source.js";
import { SportsService } from "../../packages/sports/src/sports-service.js";
import { makeDeps, makeSource, TODAY, userA } from "./sports-service.test.js";

// Split out of sports-service.test.ts (#858) to stay under the check:file-size 1000-line cap —
// these tests share that file's makeDeps/makeSource/userA/TODAY fixtures rather than duplicating
// them.
describe("id→url story keying (#858)", () => {
  it("does not drop a distinct same-id story from leagueNews just because a different story with the same id became a top story", async () => {
    const nflLeagueFollow: SportsFollowDto = {
      id: "f1",
      competitionKey: "nfl",
      teamKey: null,
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    const h0: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Editorial lead (becomes the top story)",
      url: "https://example.com/dup-a",
      publishedAt: `${TODAY}T10:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const h1: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Distinct story, colliding id",
      url: "https://example.com/dup-b",
      publishedAt: `${TODAY}T11:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const service = new SportsService(
      makeDeps({
        follows: [nflLeagueFollow],
        source: makeSource({
          getHeadlines: async (competitionKey) => (competitionKey === "nfl" ? [h0, h1] : [])
        })
      })
    );
    const overview = await service.getOverview(userA);
    expect(overview.topStories.map((h) => h.url)).toContain("https://example.com/dup-a");
    const nflGroup = overview.leagueNews.find((g) => g.competitionKey === "nfl");
    expect(nflGroup?.headlines.map((h) => h.title)).toEqual(["Distinct story, colliding id"]);
  });

  it("does not splice the featured article's body onto an unrelated headline that happens to share its id", async () => {
    const nflFollow: SportsFollowDto = {
      id: "f1",
      competitionKey: "nfl",
      teamKey: null,
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    const nbaFollow: SportsFollowDto = {
      id: "f2",
      competitionKey: "nba",
      teamKey: null,
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    // nfl feed: an editorial lead (tier-1 top story, excluded from leagueNews) followed by the
    // heavy story that will become the feature — image + summary + first-in-its-(filtered)-group
    // bonus clears BIG_STORY_WEIGHT (4): 2 + 1 + 2 = 5.
    const nflLead: SourceHeadline = {
      id: "nfl-lead",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "NFL editorial lead",
      url: "https://example.com/nfl-lead",
      publishedAt: `${TODAY}T09:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const nflFeature: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "NFL feature story",
      url: "https://example.com/nfl-dup",
      publishedAt: `${TODAY}T10:00:00.000Z`,
      imageUrl: "https://img.example.com/nfl.jpg",
      summary: "NFL summary text",
      teamKeys: [],
      sourceTeamIds: []
    };
    // nba feed: its own editorial lead (tier-1 top story, excluded), then a second, unrelated
    // story that happens to share `nflFeature`'s id "dup" but has a completely different url.
    const nbaLead: SourceHeadline = {
      id: "nba-lead",
      competitionKey: "nba",
      competitionLabel: "NBA",
      title: "NBA editorial lead",
      url: "https://example.com/nba-lead",
      publishedAt: `${TODAY}T08:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const nbaOther: SourceHeadline = {
      id: "dup",
      competitionKey: "nba",
      competitionLabel: "NBA",
      title: "NBA distinct story (colliding id)",
      url: "https://example.com/nba-other",
      publishedAt: `${TODAY}T07:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const service = new SportsService(
      makeDeps({
        follows: [nflFollow, nbaFollow],
        source: makeSource({
          getHeadlines: async (competitionKey) => {
            if (competitionKey === "nfl") return [nflLead, nflFeature];
            if (competitionKey === "nba") return [nbaLead, nbaOther];
            return [];
          },
          getArticleBody: async () => "Fetched real article body."
        })
      })
    );
    const overview = await service.getOverview(userA);
    const nflGroup = overview.leagueNews.find((g) => g.competitionKey === "nfl");
    expect(nflGroup?.headlines.find((h) => h.title === "NFL feature story")?.body).toBe(
      "Fetched real article body."
    );
    const nbaGroup = overview.leagueNews.find((g) => g.competitionKey === "nba");
    expect(
      nbaGroup?.headlines.find((h) => h.title === "NBA distinct story (colliding id)")?.body
    ).toBeUndefined();
  });

  it("does not let a tier-1 lead's id block a distinct, team-matched story from tier 2 just because the ids collide", async () => {
    // Regression for rankTopStories' OWN dedup set (pickedIds -> pickedUrls), isolated from the
    // separate, correct followedStoryUrls exclusion (L293-296) that drops a top story already
    // shown on a followed-team card: h1 is tier-2-eligible (feed-rank order, dal-tagged) but aged
    // off the card's newest-3 cap (toTeamStories, followed-card.ts) by h2/h3/h4 below, so it can
    // only reach `overview.topStories` via rankTopStories tier 2 — never via the card path.
    const dalFollow: SportsFollowDto = {
      id: "f1",
      competitionKey: "nfl",
      teamKey: "dal",
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    // h0 is the tier-1 pick (front of feed, unconditional) — not tagged to any team.
    const h0: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Editorial lead",
      url: "https://example.com/a",
      publishedAt: `${TODAY}T06:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    // h1 shares h0's id ("dup") but is a distinct story (different url) tagged to the followed
    // team (sourceTeamIds "6" -> resolves to "dal" via the listTeams override below) — tier 2
    // should pick it up. Oldest of the dal-tagged stories, so the card (newest-first, cap 3)
    // crops it once h2/h3/h4 exist.
    const h1: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Distinct dal story, colliding id",
      url: "https://example.com/b",
      publishedAt: `${TODAY}T07:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: ["6"]
    };
    const dalFiller = (n: number): SourceHeadline => ({
      id: `filler-${n}`,
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: `Dal filler story ${n}`,
      url: `https://example.com/filler-${n}`,
      publishedAt: `${TODAY}T${10 + n}:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: ["6"]
    });
    const h2 = dalFiller(1);
    const h3 = dalFiller(2);
    const h4 = dalFiller(3);
    const service = new SportsService(
      makeDeps({
        follows: [dalFollow],
        source: makeSource({
          getHeadlines: async (competitionKey, teamKey) => {
            if (competitionKey !== "nfl") return [];
            if (teamKey) return []; // isolate: no per-team feed noise for this test
            return [h0, h1, h2, h3, h4];
          },
          listTeams: async (competitionKey) => [
            {
              teamKey: "dal",
              competitionKey,
              name: "Dallas Cowboys",
              shortName: "Cowboys",
              crestUrl: null,
              sourceTeamId: "6"
            }
          ]
        })
      })
    );
    const overview = await service.getOverview(userA);
    const dalCard = overview.followed.find((c) => c.teamKey === "dal");
    expect(dalCard?.stories.map((s) => s.url)).not.toContain("https://example.com/b");
    expect(overview.topStories.map((h) => h.url)).toContain("https://example.com/b");
  });
});
