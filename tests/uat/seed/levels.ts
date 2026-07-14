import { createAppRuntimeRunner, createMigrationOwnerDb } from "./connections.js";
import { seedSoloAdmin } from "./admin.js";
import { seedAiProviderChunk } from "./chunks/ai.js";
import { seedNewsChunk } from "./chunks/news.js";
import { seedSportsChunk } from "./chunks/sports.js";
import { seedTasksChunk } from "./chunks/tasks.js";
import { seedCalendarChunk } from "./chunks/calendar.js";
import { seedNotesChunk } from "./chunks/notes.js";
import { seedJobSearchChunk } from "./chunks/job-search.js";
import type { SeedOptions, UatSeedChunk } from "./types.js";

// #1025 spec §4.3: the level ladder is additive — this is the single source of
// truth for "which chunks exist at admin+data", so excludeChunks (job-search
// toggle) subtracts from this list rather than needing a fifth hardcoded level.
const ADMIN_DATA_CHUNKS: ReadonlyArray<{
  key: UatSeedChunk;
  run: (runner: ReturnType<typeof createAppRuntimeRunner>, actorUserId: string) => Promise<void>;
}> = [
  { key: "news", run: (runner, actorUserId) => seedNewsChunk(runner, actorUserId) },
  { key: "sports", run: (runner, actorUserId) => seedSportsChunk(runner, actorUserId) },
  { key: "tasks", run: (runner, actorUserId) => seedTasksChunk(runner, actorUserId) },
  { key: "calendar", run: (runner, actorUserId) => seedCalendarChunk(runner, actorUserId) },
  { key: "notes", run: (runner, actorUserId) => seedNotesChunk(runner, actorUserId) },
  { key: "job-search", run: (runner, actorUserId) => seedJobSearchChunk(runner, actorUserId) }
];

export async function seedLevel(options: SeedOptions): Promise<void> {
  if (options.level === "bare") {
    return; // #1024/#1000: bare is the Phase 1 no-op — a migrated DB, nothing more.
  }

  const migrationDb = createMigrationOwnerDb();
  let adminUserId: string;
  try {
    ({ userId: adminUserId } = await seedSoloAdmin(migrationDb));
  } finally {
    await migrationDb.destroy();
  }

  if (options.level === "solo-admin") {
    return;
  }

  // admin+data and multi-user both include every non-excluded chunk.
  const runner = createAppRuntimeRunner();
  const exclude = new Set(options.excludeChunks ?? []);
  // #1025: AI provider/model/binding must land before the news chunk, since
  // news settings check for an active module.news binding — order matters here,
  // it is not a parallelizable Promise.all.
  await seedAiProviderChunk(runner, adminUserId);
  for (const chunk of ADMIN_DATA_CHUNKS) {
    if (exclude.has(chunk.key)) continue;
    await chunk.run(runner, adminUserId);
  }

  if (options.level === "multi-user") {
    // #1025/#1000: multi-user (second user + cross-user share/RLS fixtures) is
    // explicitly deferred to fast-follow issue #1030 per Coordinator ruling
    // 2026-07-13 — this PR ships solo-admin + admin+data + the job-search
    // toggle only. Flagged loudly (not a silent stub) so #1030 has a clear seam.
    throw new Error("seedLevel: multi-user is deferred to #1030 — not implemented in this PR");
  }
}
