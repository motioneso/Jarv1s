import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedJobSearchChunk } from "./job-search.js";

describe("seedJobSearchChunk", () => {
  it("marks the job-search external module enabled", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedJobSearchChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const row = await scopedDb.db
        .selectFrom("app.external_modules")
        .select(["id", "status"])
        .where("id", "=", "job-search")
        .executeTakeFirst();
      expect(row?.status).toBe("enabled");
    });
  });
});
