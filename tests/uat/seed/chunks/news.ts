import type { DataContextRunner } from "@jarv1s/db";
import { NewsPrefsRepository } from "@jarv1s/news";

// #1025 "lived-in account" (Ben, 2026-07-13): a realistic topic/source spread,
// not a single token row — proves the UI against real-feeling volume.
const UAT_NEWS_TOPICS: readonly string[] = [
  "artificial intelligence",
  "climate policy",
  "space exploration",
  "open source software",
  "renewable energy",
  "electric vehicles",
  "quantum computing",
  "public health policy"
];

export async function seedNewsChunk(runner: DataContextRunner, actorUserId: string): Promise<void> {
  const repo = new NewsPrefsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const topic of UAT_NEWS_TOPICS) {
      await repo.create(scopedDb, { kind: "topic", key: topic });
    }
  });
}
