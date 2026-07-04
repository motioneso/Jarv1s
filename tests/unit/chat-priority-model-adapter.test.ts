import { describe, expect, it, vi } from "vitest";
import { ChatPriorityModelAdapter } from "../../packages/chat/src/live/priority-model-adapter.js";

describe("ChatPriorityModelAdapter", () => {
  it("reads the priority model inside a data context scoped to the actor", async () => {
    const scopedDb = { __brand: "scoped" };
    const withDataContext = vi.fn(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
      fn(scopedDb)
    );
    const stored = {
      version: 1,
      mode: "deadline_first",
      anchors: [],
      mutedSources: ["notes"],
      updatedAt: "2026-07-01T00:00:00Z"
    };
    const preferencesRepository = { get: vi.fn().mockResolvedValue(stored) };

    const adapter = new ChatPriorityModelAdapter({
      dataContext: { withDataContext } as never,
      preferencesRepository: preferencesRepository as never
    });

    const model = await adapter.getModel("user1");

    expect(withDataContext).toHaveBeenCalledWith(
      { actorUserId: "user1", requestId: "chat:priority-model" },
      expect.any(Function)
    );
    expect(preferencesRepository.get).toHaveBeenCalledWith(scopedDb, "priority.model.v1");
    expect(model.mode).toBe("deadline_first");
    expect(model.mutedSources).toEqual(["notes"]);
  });
});
