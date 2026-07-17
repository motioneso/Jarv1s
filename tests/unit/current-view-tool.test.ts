import { expect, it, vi } from "vitest";
import { sanitizeAssistantToolResult } from "@jarv1s/ai";
import {
  createCurrentViewReadService,
  chatGetCurrentViewExecute,
  chatGetCurrentViewOutputSchema
} from "@jarv1s/chat";

const snapshot = {
  route: "/news",
  pageTitle: "News",
  headings: ["Add source"],
  buttons: [],
  labels: [],
  visibleText: ["Unavailable"],
  focused: null,
  selectedText: null,
  errors: [
    {
      code: "news.add_source.no_json_model",
      class: "prerequisite" as const,
      remediationRef: "news.add_source.configure_json_model"
    }
  ],
  capturedAt: "2026-07-16T00:00:00.000Z"
};

it("returns only the requesting actor's view and model capabilities", async () => {
  const service = createCurrentViewReadService({
    store: {
      get: vi.fn((actor) => (actor === "u1" ? { snapshot, platform: "web" } : undefined))
    } as never,
    getModelCapabilities: vi.fn().mockResolvedValue(["chat", "tool-use"]),
    getBuildInfo: () => ({ version: "1.2.3", buildId: "abc123" })
  });
  const result = await service.get({} as never, "u1");
  expect(result).toMatchObject({
    available: true,
    view: { route: "/news" },
    serverFacts: { platform: "web", modelCapabilities: ["chat", "tool-use"] }
  });
  expect(JSON.stringify(result)).not.toMatch(/modelId|modelName|provider/i);
  expect((await service.get({} as never, "u2")).available).toBe(false);
});

it("runs through the read service and recursively strips undeclared fields", async () => {
  const get = vi.fn().mockResolvedValue({
    available: true,
    view: snapshot,
    serverFacts: {
      appVersion: "1.2.3",
      buildId: "abc123",
      platform: "web",
      modelCapabilities: ["chat"],
      modelName: "secret"
    }
  });
  const result = await chatGetCurrentViewExecute(
    {} as never,
    {},
    { actorUserId: "u1", requestId: "r1", chatSessionId: "u1" },
    { currentView: { get } }
  );
  const sanitized = sanitizeAssistantToolResult(chatGetCurrentViewOutputSchema, result);
  expect(get).toHaveBeenCalledWith(expect.anything(), "u1");
  expect(JSON.stringify(sanitized)).not.toContain("modelName");
});
