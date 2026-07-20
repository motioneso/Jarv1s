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

  /**
   * #1121 red check: the default/CI UAT seed has no usable real assistant chat
   * engine. `seedAiProviderChunk`'s #1025 fake provider is `providerKind:"custom"`
   * with a `["json"]`-only model bound to `module.news` — never `"chat"` capable,
   * never bound generally. This is the exact gap the live chat route's
   * "No active chat-capable model is configured" 400
   * (packages/chat/src/live/persistence.ts:143, packages/chat/src/live-routes.ts:582)
   * exists to report. Calling the same resolver the live route calls
   * (`AiRepository.selectChatModelForUser`) proves the gap directly, no HTTP/browser
   * needed.
   */
  it("#1121: default seed has no chat-capable model (no usable real assistant engine)", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedAiProviderChunk(runner, userId);

    const repo = new AiRepository();
    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const chatModel = await repo.selectChatModelForUser(scopedDb);
      expect(chatModel).toBeNull();
    });
  });
});
