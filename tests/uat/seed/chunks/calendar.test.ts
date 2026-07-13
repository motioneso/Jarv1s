import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedCalendarChunk } from "./calendar.js";

describe("seedCalendarChunk", () => {
  it("creates a connector account and a spread of cached calendar events", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedCalendarChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const events = await scopedDb.db.selectFrom("app.calendar_events").selectAll().execute();
      expect(events.length).toBeGreaterThanOrEqual(4);
    });
  });
});
