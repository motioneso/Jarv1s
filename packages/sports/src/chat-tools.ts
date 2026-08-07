import type { DatasetClient } from "@moss/datasets";
import { assertDataContextDb } from "@moss/db";
import type { ToolExecute, ToolResult, ToolSummarize } from "@moss/module-sdk";

import { SportsFollowsRepository } from "./repository.js";
import { SportsService, type SportsFollowsWriter } from "./sports-service.js";

/**
 * Content-write counterpart to `briefing-tool.ts`'s read-only singleton — same composition-root
 * timing constraint (constructed once at boot, before any request reaches `execute`), kept in its
 * own file because these are write tools with their own action family (Spec 2), not the briefing
 * read path. `writer` is injectable so tests don't need a real Postgres-backed repository.
 */
let service: SportsService | undefined;

export function configureSportsChatTools(
  datasetClient: DatasetClient,
  writer: SportsFollowsWriter = new SportsFollowsRepository()
): void {
  service = new SportsService({
    datasetClient,
    dataContext: {
      withDataContext() {
        throw new Error("sports chat tools read/write the gateway-scoped db directly");
      }
    },
    repository: writer
  });
}

/**
 * Test-only: restores the module-wide singleton to its unconfigured state (same convention as
 * @moss/web-research's setWebFetchForTests et al). A test that calls configureSportsChatTools
 * must call this in an afterEach, or the fake writer/dataset client it installed leaks into
 * whatever test runs next in the same worker.
 */
export function resetSportsChatToolsForTests(): void {
  service = undefined;
}

function stringField(input: unknown, key: string): string | undefined {
  const value = (input as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireService(): SportsService {
  if (!service) {
    throw new Error(
      "sports chat tools used before configureSportsChatTools ran (composition-root bug)"
    );
  }
  return service;
}

export const sportsFollowTeamExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const competitionKey = stringField(input, "competitionKey");
  if (!competitionKey) return { data: { error: "Provide a competitionKey to follow." } };
  const teamKey = stringField(input, "teamKey") ?? null;
  const result = await requireService().followTeam(scopedDb, { competitionKey, teamKey });
  if (!result.ok) return { data: { error: result.error } };
  return { data: { follow: result.follow } };
};

export const summarizeSportsFollowTeam: ToolSummarize = (input) => {
  const competitionKey = stringField(input, "competitionKey") ?? "unknown competition";
  const teamKey = stringField(input, "teamKey");
  return teamKey ? `Follow ${teamKey} (${competitionKey})` : `Follow all of ${competitionKey}`;
};

export const sportsUnfollowTeamExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const competitionKey = stringField(input, "competitionKey");
  if (!competitionKey) return { data: { error: "Provide a competitionKey to unfollow." } };
  const teamKey = stringField(input, "teamKey") ?? null;
  const result = await requireService().unfollowTeam(scopedDb, { competitionKey, teamKey });
  if (!result.ok) return { data: { error: result.error } };
  return { data: { removed: result.removed } };
};

export const summarizeSportsUnfollowTeam: ToolSummarize = (input) => {
  const competitionKey = stringField(input, "competitionKey") ?? "unknown competition";
  const teamKey = stringField(input, "teamKey");
  return teamKey ? `Unfollow ${teamKey} (${competitionKey})` : `Unfollow all of ${competitionKey}`;
};
