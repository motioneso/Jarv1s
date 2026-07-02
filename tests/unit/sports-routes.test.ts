import Fastify from "fastify";
import { describe, expect, it } from "vitest";

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
import type { SportsSource } from "../../packages/sports/src/source/sports-source.js";

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

function makeSource(overrides: Partial<SportsSource> = {}): SportsSource {
  return {
    imageHosts: [],
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
    getStandings: async () => [],
    getHeadlines: async () => [],
    ...overrides
  };
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
      { id: "f1", competitionKey: "nfl", teamKey: "dal", createdAt: "2026-06-01T00:00:00.000Z" }
    ]);
  const app = Fastify();
  const deps: SportsRoutesDependencies = {
    source: overrides.source ?? makeSource(),
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
    expect(body.followedTeamKeys).toContain("dal");
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

  it("DELETE /api/sports/follows/:id removes and returns ok", async () => {
    const { app, repo } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "DELETE", url: "/api/sports/follows/f1" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(repo.removed).toEqual(["f1"]);
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
});
