import { describe, expect, it } from "vitest";
import { SPORTS_MODULE_ID } from "@jarv1s/sports";
import type { SportsOverviewResponse } from "@jarv1s/shared";

describe("sports scaffold", () => {
  it("exposes the module id", () => {
    expect(SPORTS_MODULE_ID).toBe("sports");
  });

  it("shared overview type is importable", () => {
    const empty: SportsOverviewResponse = {
      hero: { mode: "story", headline: null },
      followed: [],
      scoreboard: [],
      topStories: [],
      leagueNews: [],
      standings: [],
      followedTeams: [],
      followedLeagues: [],
      followedLeagueCards: [],
      degraded: false
    };
    expect(empty.degraded).toBe(false);
  });
});
