import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedTasksChunk } from "./tasks.js";

describe("seedTasksChunk", () => {
  it("creates a realistic spread of tasks across statuses and due dates", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedTasksChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const tasks = await scopedDb.db.selectFrom("app.tasks").selectAll().execute();
      expect(tasks.length).toBeGreaterThanOrEqual(10);
    });
  });
});
