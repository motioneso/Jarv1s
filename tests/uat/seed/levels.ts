import { SharesRepository } from "@jarv1s/db";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "./connections.js";
import { seedSecondOwner, seedSoloAdmin } from "./admin.js";
import { seedOnboardingChunk } from "./chunks/onboarding.js";
import { seedAiProviderChunk } from "./chunks/ai.js";
import { seedNewsChunk } from "./chunks/news.js";
import { seedSportsChunk } from "./chunks/sports.js";
import { seedTasksChunk } from "./chunks/tasks.js";
import { seedCalendarChunk } from "./chunks/calendar.js";
import { seedNotesChunk } from "./chunks/notes.js";
import { seedJobSearchChunk } from "./chunks/job-search.js";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";
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

async function seedDataChunks(
  runner: ReturnType<typeof createAppRuntimeRunner>,
  actorUserId: string,
  exclude: ReadonlySet<UatSeedChunk>
): Promise<void> {
  for (const chunk of ADMIN_DATA_CHUNKS) {
    if (exclude.has(chunk.key)) continue;
    await chunk.run(runner, actorUserId);
  }
}

export async function seedLevel(options: SeedOptions): Promise<void> {
  if (options.level === "bare") {
    return; // #1024/#1000: bare is the Phase 1 no-op — a migrated DB, nothing more.
  }

  const migrationDb = createMigrationOwnerDb();
  let adminUserId: string;
  let secondOwnerUserId: string | undefined;
  try {
    ({ userId: adminUserId } = await seedSoloAdmin(migrationDb));
    if (options.level === "multi-user") {
      ({ userId: secondOwnerUserId } = await seedSecondOwner(migrationDb));
    }
  } finally {
    await migrationDb.destroy();
  }

  if (options.level === "solo-admin") {
    return;
  }

  // admin+data and multi-user both include every non-excluded chunk.
  const runner = createAppRuntimeRunner();
  try {
    const exclude = new Set(options.excludeChunks ?? []);
    // #1026: not excludable — every admin+data/multi-user instance must land on
    // AppShell, not the onboarding wizard, for any UI-driving spec to work at all.
    await seedOnboardingChunk(runner, adminUserId);
    // #1025: AI provider/model/binding must land before the news chunk, since
    // news settings check for an active module.news binding — order matters here,
    // it is not a parallelizable Promise.all.
    await seedAiProviderChunk(runner, adminUserId);
    await seedDataChunks(runner, adminUserId, exclude);

    if (options.level === "multi-user") {
      if (secondOwnerUserId === undefined) {
        throw new Error("seedLevel: multi-user owner bootstrap did not return an id");
      }

      // job-search is instance-level admin configuration, not per-owner data.
      const secondOwnerExclude = new Set(exclude);
      secondOwnerExclude.add("job-search");
      await seedDataChunks(runner, secondOwnerUserId, secondOwnerExclude);

      // SECURITY: grant under the resource owner's own context. The shares INSERT
      // policy rejects forged owner_user_id values; owner2 receives only this task.
      await runner.withDataContext({ actorUserId: adminUserId }, async (scopedDb) => {
        const sharedTask = await scopedDb.db
          .selectFrom("app.tasks")
          .select("id")
          .where("owner_user_id", "=", adminUserId)
          .where("source", "=", "uat-seed")
          .where("external_key", "=", "Draft Q1 planning doc")
          .executeTakeFirstOrThrow();

        await new SharesRepository().grant(scopedDb, {
          resourceType: "task",
          resourceId: sharedTask.id,
          ownerUserId: adminUserId,
          granteeUserId: secondOwnerUserId,
          level: "view",
          now: UAT_SEED_BASE_TIMESTAMP
        });
      });
    }
  } finally {
    await runner.destroy();
  }
}
