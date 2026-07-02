import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb } from "@jarv1s/db";
import type { GameSide, GameSummary, SportsFollowDto, StandingsRow } from "@jarv1s/shared";

import type {
  SourceHeadline,
  SportsSource
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

const nflStandings: StandingsRow[] = [
  {
    teamKey: "dal",
    name: "Dallas Cowboys",
    rank: 1,
    points: null,
    wins: 10,
    losses: 2,
    draws: null,
    qualifies: true
  }
];

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
    expect(overview.followedTeamKeys).toContain("dal");
    expect(overview.degraded).toBe(false);
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
    expect(card?.nextMatch).toContain("GB");
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
