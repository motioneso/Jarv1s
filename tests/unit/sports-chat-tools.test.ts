// tests/unit/sports-chat-tools.test.ts
import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@jarv1s/db";
import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";
import type { ToolExecute } from "@jarv1s/module-sdk";

import {
  configureSportsChatTools,
  sportsFollowTeamExecute,
  sportsUnfollowTeamExecute
} from "../../packages/sports/src/chat-tools.js";
import type { SportsFollowsWriter } from "../../packages/sports/src/sports-service.js";

const FAKE_DB = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;
const CTX = { actorUserId: "user-a", requestId: "req-1", chatSessionId: "chat-1" };

function makeFakeWriter(): SportsFollowsWriter {
  const rows: SportsFollowDto[] = [];
  return {
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

async function callTool(execute: ToolExecute, input: Record<string, unknown>) {
  return execute(FAKE_DB, input, CTX);
}

describe("sports chat tools (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    configureSportsChatTools({} as never, makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, { competitionKey: "not-a-league" });
    expect((result.data as { error?: string }).error).toMatch(/unknown competition/i);
  });

  it("follow then unfollow via the tools is idempotent", async () => {
    const writer = makeFakeWriter();
    configureSportsChatTools({} as never, writer);

    const followed = await callTool(sportsFollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((followed.data as { follow?: SportsFollowDto }).follow?.teamKey).toBe("dal");

    const unfollowed = await callTool(sportsUnfollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((unfollowed.data as { removed?: boolean }).removed).toBe(true);

    const reunfollowed = await callTool(sportsUnfollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "dal"
    });
    expect((reunfollowed.data as { removed?: boolean }).removed).toBe(false);
  });

  it("rejects a missing competitionKey before any write", async () => {
    configureSportsChatTools({} as never, makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, {});
    expect((result.data as { error?: string }).error).toMatch(/provide a competitionkey/i);
  });
});
