import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { SportsFollowsRepository } from "./repository.js";
import { createEspnSportsSource } from "./source/espn-source.js";
import { SportsService } from "./sports-service.js";

/**
 * Sole intended consumer is the daily briefing (spec §4.7). It is mechanically visible to the
 * chat tool-registry because the platform has no briefing-only flag today; its output is kept to
 * compact today-facts only (never the rich `sports.scores`/`sports.schedule` chat surface §2 bars).
 *
 * The service reads followed facts directly from the gateway-scoped db passed to `execute`; the
 * `dataContext` runner seam is unused on this path, so a throwing stub satisfies the type without
 * ever opening a second, unscoped connection.
 */
const service = new SportsService({
  source: createEspnSportsSource(),
  dataContext: {
    withDataContext() {
      throw new Error("sports briefing tool reads the gateway-scoped db directly");
    }
  },
  repository: new SportsFollowsRepository()
});

export const sportsFollowedFactsTodayExecute: ToolExecute = async (
  scopedDb,
  _input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { facts } = await service.getFollowedFactsForToday(scopedDb, ctx.actorUserId);
  return { data: { facts } };
};
