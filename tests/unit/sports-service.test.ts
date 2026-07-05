import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type { GameSide, GameSummary, SportsFollowDto } from "@jarv1s/shared";

import type {
  SourceHeadline,
  SportsSource,
  StandingsTable
} from "../../packages/sports/src/source/sports-source.js";
import {
  SportsService,
  type SportsServiceDependencies
} from "../../packages/sports/src/sports-service.js";

const FIXED_NOW = new Date("2026-07-01T18:00:00.000Z");
const TODAY = "2026-07-01";

const userA: AccessContext = {
  actorUserId: "00000000-0000-0000-0000-00000000000a",
  requestId: "req-a"
};

function side(overrides: Partial<GameSide> & { teamKey: string; shortName: string }): GameSide {
  return {
    name: overrides.shortName,
    crestUrl: null,
    score: null,
    record: null,
    winner: false,
    ...overrides
  };
}

const dalLiveGame: GameSummary = {
  id: "g1",
  competitionKey: "nfl",
  startsAt: `${TODAY}T20:00:00.000Z`,
  state: "live",
  statusDetail: "Q3 4:12",
  home: side({ teamKey: "dal", shortName: "DAL", name: "Dallas Cowboys", score: 21 }),
  away: side({ teamKey: "min", shortName: "MIN", name: "Minnesota Vikings", score: 14 })
};

// dal recent form: W, L, D (oldest → newest)
const dalSchedule: GameSummary[] = [
  {
    id: "s1",
    competitionKey: "nfl",
    startsAt: "2026-06-01T20:00:00.000Z",
    state: "final",
    statusDetail: "FT",
    home: side({
      teamKey: "dal",
      shortName: "DAL",
      name: "Dallas Cowboys",
      score: 24,
      winner: true
    }),
    away: side({ teamKey: "nyg", shortName: "NYG", name: "New York Giants", score: 10 })
  },
  {
    id: "s2",
    competitionKey: "nfl",
    startsAt: "2026-06-08T20:00:00.000Z",
    state: "final",
    statusDetail: "FT",
    home: side({
      teamKey: "phi",
      shortName: "PHI",
      name: "Philadelphia Eagles",
      score: 30,
      winner: true
    }),
    away: side({ teamKey: "dal", shortName: "DAL", name: "Dallas Cowboys", score: 17 })
  },
  {
    id: "s3",
    competitionKey: "nfl",
    startsAt: "2026-06-15T20:00:00.000Z",
    state: "final",
    statusDetail: "FT",
    home: side({ teamKey: "dal", shortName: "DAL", name: "Dallas Cowboys", score: 20 }),
    away: side({ teamKey: "was", shortName: "WAS", name: "Washington", score: 20 })
  },
  // an upcoming (non-final) game — used for nextMatch, ignored by form
  {
    id: "s4",
    competitionKey: "nfl",
    startsAt: "2026-07-05T20:00:00.000Z",
    state: "pre",
    statusDetail: "Sat 3:20 PM",
    home: side({ teamKey: "dal", shortName: "DAL", name: "Dallas Cowboys" }),
    away: side({ teamKey: "gb", shortName: "GB", name: "Green Bay Packers" })
  }
];

const nflStandings: StandingsTable = {
  sections: [
    {
      label: "National Football Conference",
      rows: [
        {
          teamKey: "dal",
          name: "Dallas Cowboys",
          rank: 1,
          points: null,
          wins: 10,
          losses: 2,
          draws: null,
          winPercent: 0.833,
          qualifies: true
        }
      ]
    }
  ]
};

const nflHeadlines: SourceHeadline[] = [
  {
    id: "h1",
    competitionKey: "nfl",
    title: "Cowboys clinch the division",
    url: "https://example.com/h1",
    publishedAt: `${TODAY}T12:00:00.000Z`,
    imageUrl: null,
    teamKeys: [],
    sourceTeamIds: ["6"]
  }
];

const dalTeamFollow: SportsFollowDto = {
  id: "f1",
  competitionKey: "nfl",
  teamKey: "dal",
  createdAt: "2026-06-01T00:00:00.000Z"
};

function makeSource(overrides: Partial<SportsSource> = {}): SportsSource {
  return {
    imageHosts: [],
    listTeams: async () => [],
    getScoreboard: async () => [dalLiveGame],
    getSchedule: async () => dalSchedule,
    getStandings: async () => nflStandings,
    getHeadlines: async () => nflHeadlines,
    ...overrides
  };
}

function makeDeps(
  overrides: {
    source?: SportsSource;
    follows?: SportsFollowDto[];
  } = {}
): SportsServiceDependencies {
  const follows = overrides.follows ?? [dalTeamFollow];
  return {
    source: overrides.source ?? makeSource(),
    dataContext: {
      withDataContext: async <T>(_ac: AccessContext, work: (db: DataContextDb) => Promise<T>) =>
        work({} as DataContextDb)
    },
    repository: {
      list: async () => follows
    },
    now: () => FIXED_NOW
  };
}

describe("SportsService.getOverview", () => {
  it("returns a gameday hero when a followed team plays today", async () => {
    const service = new SportsService(makeDeps());
    const overview = await service.getOverview(userA);
    expect(overview.hero.mode).toBe("gameday");
    expect(overview.followedTeams.map((f) => f.teamKey)).toContain("dal");
    expect(overview.degraded).toBe(false);
  });

  it("emits followed teams as competition-scoped pairs", async () => {
    const service = new SportsService(makeDeps());
    const overview = await service.getOverview(userA);
    expect(overview.followedTeams).toEqual([{ competitionKey: "nfl", teamKey: "dal" }]);
  });

  it("joins provider team tags to teamKeys on headlines", async () => {
    const service = new SportsService(
      makeDeps({
        source: makeSource({
          listTeams: async (competitionKey) => [
            {
              teamKey: "dal",
              competitionKey,
              name: "Dallas Cowboys",
              shortName: "Cowboys",
              crestUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
              sourceTeamId: "6"
            }
          ]
        })
      })
    );
    const overview = await service.getOverview(userA);
    expect(overview.topStories[0]?.teamKeys).toEqual(["dal"]);
  });

  it("marks the followed team card live with derived form", async () => {
    const service = new SportsService(makeDeps());
    const overview = await service.getOverview(userA);
    const card = overview.followed.find((c) => c.teamKey === "dal");
    expect(card?.status).toBe("live");
    expect(card?.competitionLabel).toBe("NFL");
    // W (beat NYG), L (lost at PHI), D (tied WAS)
    expect(card?.form).toEqual(["W", "L", "D"]);
    expect(card?.standing).toContain("#1");
    expect(overview.standings[0]?.standingsShape).toBe("record");
    expect(overview.standings[0]?.sections[0]?.label).toBe("National Football Conference");
  });

  it("returns a structured next match with the full opponent name", async () => {
    const service = new SportsService(makeDeps());
    const overview = await service.getOverview(userA);
    const card = overview.followed.find((c) => c.teamKey === "dal");
    expect(card?.nextMatch).toEqual({
      opponentName: "Green Bay Packers",
      homeAway: "home",
      startsAt: "2026-07-05T20:00:00.000Z"
    });
  });

  it("links the newest team-tagged headline on a news-status card", async () => {
    const service = new SportsService(
      makeDeps({
        source: makeSource({
          getScoreboard: async () => [],
          listTeams: async (competitionKey) => [
            {
              teamKey: "dal",
              competitionKey,
              name: "Dallas Cowboys",
              shortName: "Cowboys",
              crestUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
              sourceTeamId: "6"
            }
          ]
        })
      })
    );
    const overview = await service.getOverview(userA);
    const card = overview.followed.find((c) => c.teamKey === "dal");
    expect(card?.status).toBe("news");
    expect(card?.news).toEqual({
      title: "Cowboys clinch the division",
      url: "https://example.com/h1"
    });
    expect(card?.name).toBe("Dallas Cowboys");
    expect(card?.crestUrl).toContain("dal.png");
  });

  it("shows the authored empty-news state instead of an unrelated story", async () => {
    const service = new SportsService(
      makeDeps({
        source: makeSource({
          getScoreboard: async () => [],
          getHeadlines: async () => [{ ...nflHeadlines[0]!, sourceTeamIds: ["17"] }]
        })
      })
    );
    const overview = await service.getOverview(userA);
    const card = overview.followed.find((c) => c.teamKey === "dal");
    expect(card?.status).toBe("news");
    expect(card?.news).toBeNull();
  });

  it("falls back to a story hero on a quiet day", async () => {
    const service = new SportsService(
      makeDeps({ source: makeSource({ getScoreboard: async () => [] }) })
    );
    const overview = await service.getOverview(userA);
    expect(overview.hero.mode).toBe("story");
    if (overview.hero.mode === "story") {
      expect(overview.hero.headline?.title).toBe("Cowboys clinch the division");
    }
  });

  it("degrades (no throw) when the source fails", async () => {
    const badSource = makeSource({
      getScoreboard: async () => {
        throw new Error("ESPN down");
      }
    });
    const service = new SportsService(makeDeps({ source: badSource }));
    const overview = await service.getOverview(userA);
    expect(overview.degraded).toBe(true);
    expect(overview.hero.mode).toBe("story");
  });

  it("ranks team-tagged stories first, caps top stories at six, dedupes league news", async () => {
    // 9 stories, all tagged to dal ("6"), publishedAt ascending → newest is h8
    const manyHeadlines = Array.from({ length: 9 }, (_, i) => ({
      id: `h${i}`,
      competitionKey: "nfl",
      title: `Story ${i}`,
      url: `https://example.com/h${i}`,
      publishedAt: `2026-07-01T0${i}:00:00.000Z`,
      imageUrl: null,
      teamKeys: [],
      sourceTeamIds: ["6"]
    }));
    const service = new SportsService(
      makeDeps({
        source: makeSource({
          getHeadlines: async () => manyHeadlines,
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
    expect(overview.topStories).toHaveLength(6);
    expect(overview.topStories[0]?.id).toBe("h8"); // newest tagged story first
    const topIds = new Set(overview.topStories.map((h) => h.id));
    expect(overview.leagueNews).toHaveLength(1);
    expect(overview.leagueNews[0]?.competitionLabel).toBe("NFL");
    expect(overview.leagueNews[0]?.headlines.map((h) => h.id)).toEqual(["h2", "h1", "h0"]);
    for (const group of overview.leagueNews) {
      for (const h of group.headlines) expect(topIds.has(h.id)).toBe(false);
    }
  });

  // #763: whole-league follows (teamKey: null) are a first-class picker option but produce no
  // FollowedTeamCard — the overview must surface them separately and let their headlines feed
  // the story hero, so a league-only follower isn't treated as following nothing.
  it("surfaces whole-league follows separately and lets them feed the story hero", async () => {
    const nbaFollow: SportsFollowDto = {
      id: "f2",
      competitionKey: "nba",
      teamKey: null,
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    const nbaHeadline: SourceHeadline = {
      id: "hn1",
      competitionKey: "nba",
      title: "NBA free agency shakes up the West",
      url: "https://example.com/hn1",
      publishedAt: `${TODAY}T13:00:00.000Z`,
      imageUrl: null,
      teamKeys: [],
      sourceTeamIds: []
    };
    const service = new SportsService(
      makeDeps({
        follows: [nbaFollow],
        source: makeSource({
          getScoreboard: async () => [],
          getHeadlines: async (competitionKey) => (competitionKey === "nba" ? [nbaHeadline] : [])
        })
      })
    );
    const overview = await service.getOverview(userA);
    expect(overview.followed).toEqual([]);
    expect(overview.followedTeams).toEqual([]);
    expect(overview.followedLeagues).toEqual([{ competitionKey: "nba", competitionLabel: "NBA" }]);
    expect(overview.topStories.map((h) => h.id)).toContain("hn1");
    expect(overview.hero.mode).toBe("story");
    if (overview.hero.mode === "story") {
      expect(overview.hero.headline?.title).toBe("NBA free agency shakes up the West");
    }
  });

  it("uses the top-ranked story for the story hero", async () => {
    const service = new SportsService(
      makeDeps({ source: makeSource({ getScoreboard: async () => [] }) })
    );
    const overview = await service.getOverview(userA);
    expect(overview.hero.mode).toBe("story");
    if (overview.hero.mode === "story") {
      expect(overview.hero.headline?.id).toBe(overview.topStories[0]?.id);
    }
  });
});

describe("SportsService.getFollowedFactsForToday", () => {
  it("returns compact non-sensitive strings", async () => {
    const service = new SportsService(makeDeps());
    const { facts } = await service.getFollowedFactsForToday(
      {} as DataContextDb,
      userA.actorUserId
    );
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]?.text).toMatch(/play|won|lost|tied/i);
    expect(facts[0]?.competitionKey).toBe("nfl");
  });

  it("returns no facts (no throw) when the source fails", async () => {
    const badSource = makeSource({
      getScoreboard: async () => {
        throw new Error("ESPN down");
      }
    });
    const service = new SportsService(makeDeps({ source: badSource }));
    const { facts } = await service.getFollowedFactsForToday(
      {} as DataContextDb,
      userA.actorUserId
    );
    expect(facts).toEqual([]);
  });
});

describe("SportsService.today() timezone handling (#761)", () => {
  // 2026-07-05T01:30:00Z is 9:30pm on July 4 in US Eastern (EDT, UTC-4) — the UTC calendar
  // date has already rolled over to July 5, but ESPN's `dates=` param (and tonight's game)
  // is still July 4 in Eastern. A UTC-based `today()` would ask ESPN for the wrong day.
  const LATE_EVENING_ET = new Date("2026-07-05T01:30:00.000Z");
  const ET_DATE = "2026-07-04";
  const UTC_DATE = "2026-07-05";

  it("requests the Eastern calendar date (not the UTC date) from the scoreboard source", async () => {
    const seenDates: string[] = [];
    const source = makeSource({
      getScoreboard: async (_competitionKey, day) => {
        seenDates.push(day);
        return [];
      }
    });
    const service = new SportsService({ ...makeDeps({ source }), now: () => LATE_EVENING_ET });
    await service.getOverview(userA);
    expect(seenDates).toEqual([ET_DATE]);
    expect(seenDates).not.toContain(UTC_DATE);
  });

  it("uses the Eastern calendar date for the briefing's followed-facts lookup too", async () => {
    const seenDates: string[] = [];
    const source = makeSource({
      getScoreboard: async (_competitionKey, day) => {
        seenDates.push(day);
        return [dalLiveGame];
      }
    });
    const service = new SportsService({ ...makeDeps({ source }), now: () => LATE_EVENING_ET });
    const { facts } = await service.getFollowedFactsForToday(
      {} as DataContextDb,
      userA.actorUserId
    );
    expect(seenDates).toEqual([ET_DATE]);
    expect(facts.length).toBeGreaterThan(0);
  });

  it("still resolves the same-day Eastern date at a UTC instant that's also same-day (control)", async () => {
    // 2026-07-01T18:00:00Z (the shared FIXED_NOW) is 2pm ET the same day — no rollover in play.
    const seenDates: string[] = [];
    const source = makeSource({
      getScoreboard: async (_competitionKey, day) => {
        seenDates.push(day);
        return [];
      }
    });
    const service = new SportsService(makeDeps({ source }));
    await service.getOverview(userA);
    expect(seenDates).toEqual([TODAY]);
  });
});

describe("SportsService.getCatalog", () => {
  it("lists the approved competitions with fetched teams", async () => {
    const service = new SportsService(
      makeDeps({
        source: makeSource({
          listTeams: async (competitionKey) => [
            {
              teamKey: "dal",
              competitionKey,
              name: "Dallas Cowboys",
              shortName: "DAL",
              crestUrl: null,
              sourceTeamId: "6"
            }
          ]
        })
      })
    );
    const catalog = await service.getCatalog();
    expect(catalog.competitions.map((c) => c.competitionKey)).toContain("nfl");
    const nfl = catalog.competitions.find((c) => c.competitionKey === "nfl");
    expect(nfl?.teams[0]?.teamKey).toBe("dal");
  });
});
