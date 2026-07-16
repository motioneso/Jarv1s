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
    try {
      await seedJobSearchChunk(runner, userId);

      await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const row = await scopedDb.db
          .selectFrom("app.external_modules")
          .select(["id", "status"])
          .where("id", "=", "job-search")
          .executeTakeFirst();
        expect(row?.status).toBe("enabled");
      });
    } finally {
      // #1087: the uat-seed suite runs files sequentially on ONE shared,
      // non-reset DB (vitest.config.ts pool:forks + fileParallelism:false, and
      // connections.ts has no per-file truncate). The external_modules row this
      // test enables is durable, so without cleanup it leaks into later files —
      // notably levels.test.ts's "admin+data does not install job-search"
      // absence assertion, which then fails on a stale dev DB. Delete it here
      // via the app-runtime path under the seeded admin's actor context: RLS
      // (external_modules_delete USING app.current_actor_is_admin()) permits the
      // admin to delete, whereas the migration-owner role is NOBYPASSRLS and its
      // DELETE would silently affect 0 rows.
      await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        await scopedDb.db
          .deleteFrom("app.external_modules")
          .where("id", "=", "job-search")
          .execute();
      });
      await runner.destroy();
    }
  });
});
