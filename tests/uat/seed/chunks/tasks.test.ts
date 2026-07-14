import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedTasksChunk } from "./tasks.js";

describe("seedTasksChunk", () => {
  it("does not duplicate task fixtures when re-seeded", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    try {
      await seedTasksChunk(runner, userId);
      await seedTasksChunk(runner, userId);

      await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const tasks = await scopedDb.db
          .selectFrom("app.tasks")
          .selectAll()
          .where("source", "=", "uat-seed")
          .execute();
        expect(tasks).toHaveLength(12);
      });
    } finally {
      await runner.destroy();
    }
  });
});
