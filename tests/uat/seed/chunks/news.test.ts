import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedAiProviderChunk } from "./ai.js";
import { seedNewsChunk } from "./news.js";

describe("seedNewsChunk", () => {
  it("creates realistic followed-topic volume, not one token row", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedAiProviderChunk(runner, userId);
    await seedNewsChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const prefs = await scopedDb.db.selectFrom("app.news_prefs").selectAll().execute();
      expect(prefs.length).toBeGreaterThanOrEqual(8); // #1025: "lived-in", not one row
    });
  });
});
