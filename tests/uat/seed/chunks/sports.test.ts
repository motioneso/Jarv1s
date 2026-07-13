import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedSportsChunk } from "./sports.js";

describe("seedSportsChunk", () => {
  it("follows several competitions", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedSportsChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const follows = await scopedDb.db.selectFrom("app.sports_follows").selectAll().execute();
      expect(follows.length).toBeGreaterThanOrEqual(3);
    });
  });
});
