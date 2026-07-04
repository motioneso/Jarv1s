/**
 * Chat priority consumer tests.
 */

import { describe, it, expect, vi } from "vitest";
import {
  crossToolCandidatesToPriority,
  rankChatContext,
  readPriorityModel,
  reorderByPriority
} from "@jarv1s/chat/priority-consumer";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";
import type { DataContextDb } from "@jarv1s/db";

describe("chat priority consumer", () => {
  it("converts cross-tool candidates to priority candidates", () => {
    const input = [
      {
        source: "tasks" as const,
        title: "Fix bug",
        textForAnchorMatch: ["fix bug"]
      },
      {
        source: "calendar" as const,
        title: "Meeting",
        startsAt: "2026-06-28T10:00:00Z",
        textForAnchorMatch: ["meeting"]
      }
    ];
    const converted = crossToolCandidatesToPriority(input);
    expect(converted).toHaveLength(2);
    expect(converted[0]).toMatchObject({
      source: "tasks",
      title: "Fix bug"
    });
    expect(converted[1]).toMatchObject({
      source: "calendar",
      startsAt: "2026-06-28T10:00:00Z"
    });
  });

  it("ranks chat context without new source reads", () => {
    const model: PriorityModelPreferenceV1 = {
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: [],
      updatedAt: "2026-06-27T00:00:00Z"
    };
    const candidates = [
      {
        source: "tasks" as const,
        title: "Overdue task",
        dueAt: "2026-06-26T12:00:00Z",
        explicitPriority: 5 as const,
        textForAnchorMatch: ["overdue task"]
      },
      {
        source: "calendar" as const,
        title: "Meeting",
        textForAnchorMatch: ["meeting"]
      }
    ];
    const ranked = rankChatContext(
      candidates,
      model,
      "2026-06-27T12:00:00Z",
      "America/Los_Angeles"
    );
    expect(ranked[0]).toMatchObject({
      source: "tasks",
      band: "high"
    });
  });
});

describe("readPriorityModel", () => {
  const scopedDb = {} as unknown as DataContextDb;

  it("returns defaults when no preferences repository is provided", async () => {
    const model = await readPriorityModel(scopedDb);
    expect(model).toMatchObject({
      version: 1,
      mode: "balanced",
      anchors: [],
      mutedSources: []
    });
  });

  it("reads priority.model.v1 through the injected reader and normalizes it", async () => {
    const stored = {
      version: 1,
      mode: "deadline_first",
      anchors: [],
      mutedSources: ["email"],
      updatedAt: "2026-07-01T00:00:00Z"
    };
    const reader = { get: vi.fn().mockResolvedValue(stored) };
    const model = await readPriorityModel(scopedDb, reader);
    expect(reader.get).toHaveBeenCalledWith(scopedDb, "priority.model.v1");
    expect(model.mode).toBe("deadline_first");
    expect(model.mutedSources).toEqual(["email"]);
  });

  it("falls back to defaults when the stored value is invalid", async () => {
    const reader = { get: vi.fn().mockResolvedValue({ garbage: true }) };
    const model = await readPriorityModel(scopedDb, reader);
    expect(model.mode).toBe("balanced");
  });
});

describe("reorderByPriority", () => {
  const items = [
    { source: "calendar", title: "Standup", summary: "Standup" },
    { source: "tasks", title: "Fix bug", summary: "Fix bug" },
    { source: "notes", title: "Ideas", summary: "Ideas" }
  ];

  it("reorders mixed-source items to match the ranked results", () => {
    const ranked = [
      { source: "tasks", title: "Fix bug", score: 90, band: "high", reasons: [] },
      { source: "notes", title: "Ideas", score: 50, band: "normal", reasons: [] },
      { source: "calendar", title: "Standup", score: 10, band: "low", reasons: [] }
    ] as const;
    const result = reorderByPriority(items, ranked);
    expect(result.map((i) => i.source)).toEqual(["tasks", "notes", "calendar"]);
  });

  it("returns items unchanged when ranked results are empty", () => {
    expect(reorderByPriority(items, [])).toEqual(items);
  });

  it("keeps unmatched items at the end in their original relative order", () => {
    const ranked = [
      { source: "notes", title: "Ideas", score: 90, band: "high", reasons: [] }
    ] as const;
    const result = reorderByPriority(items, ranked);
    expect(result.map((i) => i.title)).toEqual(["Ideas", "Standup", "Fix bug"]);
  });

  it("does not confuse same title across different sources", () => {
    const dupes = [
      { source: "tasks", title: "Review", summary: "t" },
      { source: "email", title: "Review", summary: "e" }
    ];
    const ranked = [
      { source: "email", title: "Review", score: 90, band: "high", reasons: [] },
      { source: "tasks", title: "Review", score: 10, band: "low", reasons: [] }
    ] as const;
    const result = reorderByPriority(dupes, ranked);
    expect(result.map((i) => i.summary)).toEqual(["e", "t"]);
  });
});
