import type { DataContextRunner } from "@jarv1s/db";
import { SportsFollowsRepository } from "@jarv1s/sports";

// #1025 "lived-in account": whole-competition follows only. Individual team keys are
// not a static catalog in packages/sports/src (`SPORTS_CATALOG` in source/catalog.ts
// only enumerates competitions) — real team keys come from live ESPN dataset fetches,
// unavailable at seed time, so guessing one (e.g. "nfl-sf-49ers") risks seeding a row
// the real data never resolves. Following whole competitions is real, valid data.
const UAT_SPORTS_FOLLOWS: ReadonlyArray<{ competitionKey: string; teamKey: null }> = [
  { competitionKey: "nfl", teamKey: null },
  { competitionKey: "nba", teamKey: null },
  { competitionKey: "eng.1", teamKey: null }
];

export async function seedSportsChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new SportsFollowsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const follow of UAT_SPORTS_FOLLOWS) {
      await repo.create(scopedDb, follow);
    }
  });
}
