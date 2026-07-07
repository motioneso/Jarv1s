import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { DatasetClient, DatasetEnvelope } from "@jarv1s/datasets";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import type {
  CreateSportsFollowRequest,
  GameSide,
  GameSummary,
  SportsFollowDto
} from "@jarv1s/shared";

import {
  registerSportsRoutes,
  type SportsRoutesDependencies
} from "../../packages/sports/src/routes.js";
import type {
  SourceHeadline,
  SourceTeamRef,
  StandingsTable
} from "../../packages/sports/src/source/sports-source.js";

/**
 * A fake `DatasetClient` dispatching by dataset key, mirroring the shape the retired
 * directly-injected `SportsSource` fixture used (`listTeams`/`getScoreboard`/etc), so the
 * per-test overrides below stay close to their pre-migration form. Errors thrown by a handler
 * are caught here (as the real `createDatasetClient` does) and reported as `degraded: true`
 * with the caller-supplied fallback.
 */
interface FakeSourceHandlers {
  listTeams?: (competitionKey: string) => Promise<SourceTeamRef[]>;
  getScoreboard?: (competitionKey: string, day: string) => Promise<GameSummary[]>;
  getSchedule?: (teamKey: string, competitionKey: string) => Promise<GameSummary[]>;
  getStandings?: (competitionKey: string) => Promise<StandingsTable>;
  getHeadlines?: (competitionKey: string) => Promise<SourceHeadline[]>;
}

function makeDatasetClient(handlers: FakeSourceHandlers = {}): DatasetClient {
  return {
    async getDataset<T>(
      datasetKey: string,
      params: Record<string, unknown>,
      options: { fallback: T }
    ): Promise<DatasetEnvelope<T>> {
      try {
        let data: unknown;
        switch (datasetKey) {
          case "teams":
            data = await (handlers.listTeams ?? (async () => []))(params.competitionKey as string);
            break;
          case "scoreboard":
            data = await (handlers.getScoreboard ?? (async () => []))(
              params.competitionKey as string,
              params.day as string
            );
            break;
          case "schedule":
            data = await (handlers.getSchedule ?? (async () => []))(
              params.teamKey as string,
              params.competitionKey as string
            );
            break;
          case "standings":
            data = await (handlers.getStandings ?? (async () => ({ sections: [] })))(
              params.competitionKey as string
            );
            break;
          case "headlines":
            data = await (handlers.getHeadlines ?? (async () => []))(
              params.competitionKey as string
            );
            break;
          default:
            throw new Error(`unknown dataset "${datasetKey}"`);
        }
        return { data: data as T, degraded: false, fetchedAt: new Date().toISOString() };
      } catch {
        return { data: options.fallback, degraded: true, fetchedAt: new Date().toISOString() };
      }
    }
  };
}

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
  startsAt: "2026-07-01T20:00:00.000Z",
  state: "live",
  statusDetail: "Q3 4:12",
  home: side({ teamKey: "dal", shortName: "DAL", name: "Dallas Cowboys", score: 21 }),
  away: side({ teamKey: "min", shortName: "MIN", name: "Minnesota Vikings", score: 14 })
};

function makeSource(overrides: FakeSourceHandlers = {}): DatasetClient {
  return makeDatasetClient({
    listTeams: async (competitionKey) => [
      {
        teamKey: "dal",
        competitionKey,
        name: "Dallas Cowboys",
        shortName: "DAL",
        crestUrl: null,
        sourceTeamId: "6"
      }
    ],
    getScoreboard: async () => [dalLiveGame],
    getSchedule: async () => [],
    getStandings: async () => ({ sections: [] }),
    getHeadlines: async () => [],
    ...overrides
  });
}

interface FakeRepo {
  list(scopedDb: DataContextDb): Promise<SportsFollowDto[]>;
  create(scopedDb: DataContextDb, input: CreateSportsFollowRequest): Promise<SportsFollowDto>;
  remove(scopedDb: DataContextDb, id: string): Promise<boolean>;
  created: CreateSportsFollowRequest[];
  removed: string[];
}

function makeRepo(initial: SportsFollowDto[]): FakeRepo {
  const created: CreateSportsFollowRequest[] = [];
  const removed: string[] = [];
  return {
    created,
    removed,
    list: async () => initial,
    create: async (_db, input) => {
      created.push(input);
      return {
        id: "new-follow",
        competitionKey: input.competitionKey,
        teamKey: input.teamKey ?? null,
        createdAt: "2026-07-01T00:00:00.000Z"
      };
    },
    remove: async (_db, id) => {
      removed.push(id);
      return true;
    }
  };
}

function buildApp(overrides: Partial<SportsRoutesDependencies> & { repo?: FakeRepo } = {}) {
  const repo =
    overrides.repo ??
    makeRepo([
      {
        id: "11111111-1111-1111-1111-111111111111",
        competitionKey: "nfl",
        teamKey: "dal",
        createdAt: "2026-06-01T00:00:00.000Z"
      }
    ]);
  const app = Fastify();
  const deps: SportsRoutesDependencies = {
    datasetClient: overrides.datasetClient ?? makeSource(),
    dataContext: {
      withDataContext: async <T>(_ac: AccessContext, work: (db: DataContextDb) => Promise<T>) =>
        work({} as DataContextDb)
    } as unknown as DataContextRunner,
    resolveAccessContext: overrides.resolveAccessContext ?? (async () => userA),
    repository: repo,
    now: () => new Date("2026-07-01T18:00:00.000Z")
  };
  registerSportsRoutes(app, deps);
  return { app, repo };
}

describe("sports routes", () => {
  it("GET /api/sports/overview returns a composed 200 body", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/overview" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.hero.mode).toBe("gameday");
    expect(
      body.followedTeams.map((f: { competitionKey: string; teamKey: string }) => f.teamKey)
    ).toContain("dal");
    expect(body.degraded).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sourceTeamIds");
    expect(JSON.stringify(body)).not.toContain("sourceTeamId");
    await app.close();
  });

  it("GET /api/sports/catalog returns competitions with teams", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/catalog" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.competitions.map((c: { competitionKey: string }) => c.competitionKey)).toContain(
      "nfl"
    );
    expect(JSON.stringify(body)).not.toContain("sourceTeamIds");
    expect(JSON.stringify(body)).not.toContain("sourceTeamId");
    await app.close();
  });

  it("GET /api/sports/follows returns the actor's follows", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/follows" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.follows).toHaveLength(1);
    expect(body.follows[0].competitionKey).toBe("nfl");
    await app.close();
  });

  it("POST /api/sports/follows persists via the repository", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/sports/follows",
      payload: { competitionKey: "nba" }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.follow.competitionKey).toBe("nba");
    expect(repo.created).toEqual([{ competitionKey: "nba" }]);
    await app.close();
  });

  it("POST /api/sports/follows rejects an unknown competitionKey with 400", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/sports/follows",
      payload: { competitionKey: "xyz.made-up" }
    });
    expect(res.statusCode).toBe(400);
    expect(repo.created).toEqual([]);
    await app.close();
  });

  it("DELETE /api/sports/follows/:id removes and returns ok", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/sports/follows/11111111-1111-1111-1111-111111111111"
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(repo.removed).toEqual(["11111111-1111-1111-1111-111111111111"]);
    await app.close();
  });

  it("DELETE /api/sports/follows/:id rejects a non-uuid id with 400", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/api/sports/follows/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(repo.removed).toEqual([]);
    await app.close();
  });

  it("maps an auth failure to 401", async () => {
    const { app } = buildApp({
      resolveAccessContext: async () => {
        throw new HttpError(401, "Session is missing or expired");
      }
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/overview" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("carries Headline.summary through the overview response (#840)", async () => {
    const { app } = buildApp({
      datasetClient: makeSource({
        getHeadlines: async () => [
          {
            id: "n1",
            competitionKey: "nfl",
            competitionLabel: "NFL",
            title: "Vikings clinch division",
            url: "https://example.test/n1",
            publishedAt: "2026-07-01T18:00:00Z",
            imageUrl: null,
            summary: "A late field goal sealed the NFC North.",
            teamKeys: [],
            sourceTeamIds: []
          }
        ]
      })
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("A late field goal sealed the NFC North.");
    await app.close();
  });

  it("carries standings qualification note + color through the overview (#841)", async () => {
    const { app } = buildApp({
      datasetClient: makeDatasetClient({
        getStandings: async () => ({
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
        })
      }),
      repo: makeRepo([
        {
          id: "f1",
          competitionKey: "eng.1",
          teamKey: null,
          createdAt: "2026-06-01T00:00:00.000Z"
        }
      ])
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/sports/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("UEFA Champions League");
    expect(res.body).toContain("#2a66d1");
    await app.close();
  });

  it("GET /api/sports/standings returns one league's group (#842)", async () => {
    const { app } = buildApp({
      datasetClient: makeDatasetClient({
        getStandings: async () => ({
          sections: [
            {
              label: "AFC East",
              rows: [
                {
                  teamKey: "buf",
                  name: "Buffalo Bills",
                  rank: 1,
                  points: null,
                  wins: 11,
                  losses: 3,
                  draws: null,
                  winPercent: 0.786,
                  qualifies: true,
                  qualificationNote: null,
                  qualificationColor: null
                }
              ]
            }
          ]
        })
      })
    });
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/sports/standings?competitionKey=nfl"
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.group.competitionKey).toBe("nfl");
    expect(body.group.competitionLabel).toBe("NFL");
    expect(body.group.sections[0].label).toBe("AFC East");
    await app.close();
  });

  it("GET /api/sports/standings rejects an unknown competitionKey with 400 (#842)", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/sports/standings?competitionKey=xyz.nope"
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
