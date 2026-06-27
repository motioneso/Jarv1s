import { describe, it, expect } from "vitest";
import { build } from "vite";
import { registerRoutes } from "@jarv1s/settings";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

describe("priority model API", () => {
  it("GET /api/me/priority-model returns defaults when empty", async () => {
    const app = await build();
    const response = await app.inject({
      method: "GET",
      url: "/api/me/priority-model"
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.version).toBe(1);
    expect(body.mode).toBe("balanced");
    expect(body.anchors).toEqual([]);
    expect(body.mutedSources).toEqual([]);
  });

  it("PATCH /api/me/priority-model validates and stores", async () => {
    const app = await build();
    const input: PriorityModelPreferenceV1 = {
      version: 1,
      mode: "deadline_first",
      anchors: [
        {
          id: "a1",
          kind: "project",
          label: "Apollo",
          aliases: ["moon"],
          weight: 2,
          enabled: true,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      mutedSources: ["email"],
      updatedAt: "2026-06-27T00:00:00Z"
    };
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: input
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.mode).toBe("deadline_first");
    expect(body.anchors).toHaveLength(1);
    expect(body.mutedSources).toEqual(["email"]);
    expect(body.updatedAt).not.toBe(input.updatedAt);
  });

  it("PATCH /api/me/priority-model rejects invalid mode", async () => {
    const app = await build();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: {
        version: 1,
        mode: "invalid",
        anchors: [],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(500);
  });

  it("PATCH /api/me/priority-model rejects too many anchors", async () => {
    const app = await build();
    const anchors = Array.from({ length: 51 }, (_, i) => ({
      id: `a${i}`,
      kind: "project" as const,
      label: `Project ${i}`,
      aliases: [],
      weight: 1 as const,
      enabled: true,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z"
    }));
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: {
        version: 1,
        mode: "balanced",
        anchors,
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(500);
  });

  it("PATCH /api/me/priority-model rejects invalid weight", async () => {
    const app = await build();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [
          {
            id: "a1",
            kind: "project",
            label: "Test",
            aliases: [],
            weight: 5,
            enabled: true,
            createdAt: "2026-06-01T00:00:00Z",
            updatedAt: "2026-06-01T00:00:00Z"
          }
        ],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(500);
  });

  it("PATCH /api/me/priority-model rejects unknown source", async () => {
    const app = await build();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: ["unknown"],
        updatedAt: "2026-06-27T00:00:00Z"
      }
    });
    expect(response.statusCode).toBe(500);
  });

  it("PATCH /api/me/priority-model rejects unknown top-level keys", async () => {
    const app = await build();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/priority-model",
      payload: {
        version: 1,
        mode: "balanced",
        anchors: [],
        mutedSources: [],
        updatedAt: "2026-06-27T00:00:00Z",
        unknown: "value"
      }
    });
    expect(response.statusCode).toBe(500);
  });
});
