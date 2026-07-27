// tests/unit/sports-service-follows.test.ts
import { describe, expect, it } from "vitest";

import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";
import type { DataContextDb } from "@jarv1s/db";

import {
  SportsService,
  type SportsFollowsWriter
} from "../../packages/sports/src/sports-service.js";

function makeFakeWriter(initial: SportsFollowDto[] = []): SportsFollowsWriter & {
  readonly rows: SportsFollowDto[];
} {
  const rows = [...initial];
  return {
    rows,
    async list() {
      return rows;
    },
    async create(_db: DataContextDb, input: CreateSportsFollowRequest) {
      const teamKey = input.teamKey ?? null;
      const existing = rows.find(
        (r) => r.competitionKey === input.competitionKey && r.teamKey === teamKey
      );
      if (existing) return existing;
      const created: SportsFollowDto = {
        id: `f-${rows.length + 1}`,
        competitionKey: input.competitionKey,
        teamKey,
        createdAt: "2026-07-27T00:00:00.000Z"
      };
      rows.push(created);
      return created;
    },
    async remove(_db: DataContextDb, id: string) {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }
  };
}

function makeService(writer: SportsFollowsWriter) {
  return new SportsService({
    datasetClient: {} as never,
    dataContext: {
      withDataContext() {
        throw new Error("not used by followTeam/unfollowTeam");
      }
    },
    repository: writer
  });
}

describe("SportsService.followTeam / unfollowTeam (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);
    const result = await service.followTeam({} as DataContextDb, {
      competitionKey: "not-a-league"
    });
    expect(result.ok).toBe(false);
    expect(writer.rows).toHaveLength(0);
  });

  it("follows a catalog team and unfollow fully restores state (idempotent)", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);

    const followed = await service.followTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(followed.ok).toBe(true);
    expect(writer.rows).toHaveLength(1);

    const unfollowed = await service.unfollowTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(unfollowed.ok).toBe(true);
    if (unfollowed.ok) expect(unfollowed.removed).toBe(true);
    expect(writer.rows).toHaveLength(0);

    const refollowed = await service.followTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(refollowed.ok).toBe(true);
    expect(writer.rows).toHaveLength(1);
  });

  it("unfollowing something never followed is a no-op, not an error", async () => {
    const writer = makeFakeWriter();
    const service = makeService(writer);
    const result = await service.unfollowTeam({} as DataContextDb, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.removed).toBe(false);
  });
});
