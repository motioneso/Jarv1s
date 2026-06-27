/**
 * Chat priority consumer tests.
 */

import { describe, it, expect } from "vitest";
import { crossToolCandidatesToPriority, rankChatContext } from "@jarv1s/chat/priority-consumer";
import { rankPriorityCandidates } from "@jarv1s/priority";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

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
        explicitPriority: 5,
        textForAnchorMatch: ["overdue task"]
      },
      {
        source: "calendar" as const,
        title: "Meeting",
        textForAnchorMatch: ["meeting"]
      }
    ];
    const ranked = rankChatContext(candidates, model, "2026-06-27T12:00:00Z", "America/Los_Angeles");
    expect(ranked[0]).toMatchObject({
      source: "tasks",
      band: "high"
    });
  });
});
