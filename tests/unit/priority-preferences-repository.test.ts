import { describe, it, expect, beforeEach } from "vitest";
import { PriorityPreferencesRepository } from "@jarv1s/priority";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

describe("PriorityPreferencesRepository", () => {
  let repo: PriorityPreferencesRepository;

  beforeEach(() => {
    repo = new PriorityPreferencesRepository();
  });

  it("returns defaults for null", () => {
    const model = repo.get(null);
    expect(model).toEqual({
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: [],
      updatedAt: expect.any(String)
    });
  });

  it("returns defaults for undefined", () => {
    const model = repo.get(undefined);
    expect(model.version).toBe(1);
    expect(model.mode).toBe("balanced");
    expect(model.anchors).toEqual([]);
    expect(model.mutedSources).toEqual([]);
  });

  it("returns defaults for version != 1", () => {
    const model = repo.get({ version: 2, mode: "balanced", anchors: [], mutedSources: [], updatedAt: "" });
    expect(model.version).toBe(1);
    expect(model.mode).toBe("balanced");
  });

  it("returns valid model as-is", () => {
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
    const model = repo.get(input);
    expect(model).toEqual(input);
  });
});
