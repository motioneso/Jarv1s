import { describe, expect, it } from "vitest";

import { RecallService } from "@jarv1s/chat";

type RecallServiceDeps = ConstructorParameters<typeof RecallService>;

describe("RecallService", () => {
  it("strips the actor UUID from the semantic recall query", async () => {
    const actorUserId = "11111111-1111-4111-8111-111111111111";
    let embeddedQuery = "";
    const dataContext = {
      withDataContext: async (_accessCtx: unknown, callback: (db: unknown) => unknown) =>
        callback({})
    } as unknown as RecallServiceDeps[0];
    const embeddingProvider = {
      embedQuery: async (query: string) => {
        embeddedQuery = query;
        return [0.1, 0.2];
      }
    } as unknown as RecallServiceDeps[1];
    const memoryRepo = {
      vectorSearch: async () => []
    } as unknown as RecallServiceDeps[2];
    const factsRepo = {} as unknown as RecallServiceDeps[3];
    const settingsRepo = {
      getOrCreate: async () => ({ recallEnabled: true, factsEnabled: false })
    } as unknown as RecallServiceDeps[4];
    const chatRepo = {} as unknown as RecallServiceDeps[5];
    const service = new RecallService(
      dataContext,
      embeddingProvider,
      memoryRepo,
      factsRepo,
      settingsRepo,
      chatRepo
    );

    await service.recall(actorUserId);

    expect(embeddedQuery).toBe("past conversations");
    expect(embeddedQuery).not.toContain(actorUserId);
  });
});
