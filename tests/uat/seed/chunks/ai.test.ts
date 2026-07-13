import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedAiProviderChunk } from "./ai.js";
import { AiRepository } from "@jarv1s/ai";

describe("seedAiProviderChunk", () => {
  it("binds a provider+model to module.news so news settings don't 503", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedAiProviderChunk(runner, userId);

    const repo = new AiRepository();
    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const binding = await repo.getModuleServiceBinding(scopedDb, "module.news");
      expect(binding).not.toBeNull();
      expect(binding?.kind).toBe("model");
    });
  });
});
