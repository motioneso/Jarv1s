// tests/unit/sports-chat-tools.test.ts
import { describe, expect, it } from "vitest";

import { dataContextBrand, type DataContextDb } from "@moss/db";
import type { CreateSportsFollowRequest, SportsFollowDto } from "@moss/shared";
import type { ToolExecute } from "@moss/module-sdk";

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

/** Roster stand-in for the league-teams lookup `followTeam` performs to close an
 *  assistant-supplied teamKey against the catalog (#1265 QA BLOCKING-1a). */
function makeFakeDatasetClient(rosters: Record<string, readonly string[]> = { nfl: ["dal"] }) {
  return {
    async getDataset(_key: string, params: Record<string, unknown>) {
      const competitionKey = String(params.competitionKey ?? "");
      return {
        data: (rosters[competitionKey] ?? []).map((teamKey) => ({
          teamKey,
          competitionKey,
          name: teamKey.toUpperCase(),
          shortName: teamKey.toUpperCase(),
          crestUrl: null,
          sourceTeamId: null
        })),
        degraded: false,
        cacheMiss: false
      };
    }
  } as never;
}

async function callTool(execute: ToolExecute, input: Record<string, unknown>) {
  return execute(FAKE_DB, input, CTX);
}

describe("sports chat tools (#1265)", () => {
  it("rejects a competitionKey outside the catalog before any write", async () => {
    configureSportsChatTools(makeFakeDatasetClient(), makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, { competitionKey: "not-a-league" });
    expect((result.data as { error?: string }).error).toMatch(/unknown competition/i);
  });

  it("follow then unfollow via the tools is idempotent", async () => {
    const writer = makeFakeWriter();
    configureSportsChatTools(makeFakeDatasetClient(), writer);

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

  // #1265 QA BLOCKING-1(a) at the tool surface: this tool auto-runs under a
  // `granted_at_install` grant, so a model-supplied teamKey never faces a confirmation card.
  // An off-roster key must come back as a tool error, not a persisted follow.
  it("rejects an off-roster teamKey before any write", async () => {
    const writer = makeFakeWriter();
    configureSportsChatTools(makeFakeDatasetClient(), writer);
    const result = await callTool(sportsFollowTeamExecute, {
      competitionKey: "nfl",
      teamKey: "../../../evil"
    });
    expect((result.data as { error?: string }).error).toMatch(/unknown team/i);
    expect((result.data as { follow?: SportsFollowDto }).follow).toBeUndefined();
    expect(await writer.list(FAKE_DB)).toHaveLength(0);
  });

  it("rejects a missing competitionKey before any write", async () => {
    configureSportsChatTools(makeFakeDatasetClient(), makeFakeWriter());
    const result = await callTool(sportsFollowTeamExecute, {});
    expect((result.data as { error?: string }).error).toMatch(/provide a competitionkey/i);
  });
});
