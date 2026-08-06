import { describe, expect, it } from "vitest";

import { composeBriefing } from "../../packages/briefings/src/compose.js";
import { composeEveningBriefing } from "../../packages/briefings/src/compose-evening.js";
import {
  buildEmailCatchUp,
  gatherActionRows,
  projectActionRows
} from "../../packages/briefings/src/action-rows.js";
import {
  FIXED_NOW,
  definition,
  fakeScopedDb,
  makeFakeDeps,
  makeStructuredTaskDeps,
  runInput
} from "./briefings-compose.harness.js";
import type { ComposeDeps } from "../../packages/briefings/src/compose.js";

describe("structured briefing action rows", () => {
  it("returns rows beside prose and excludes their tasks and emails from prose", async () => {
    const captured: string[] = [];
    const deps = makeStructuredTaskDeps(
      makeFakeDeps({
        generateChat: async (input) => {
          captured.push(input.messages[0]!.content);
          return { text: "synth narrative" };
        }
      })
    );
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);

    expect(result.structuredPayload.actionRows).toHaveLength(1);
    expect(result.structuredPayload.actionRows[0]?.taskId).toBe("task-row");
    expect(captured[0]).not.toContain("Reply row title");
    expect(captured[0]).not.toContain("Row email");
    expect(captured[0]).toContain("Prose task");
  });

  it("morning and evening use the same row projector", async () => {
    const deps = makeStructuredTaskDeps(makeFakeDeps());
    const morning = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    const evening = await composeEveningBriefing(
      fakeScopedDb,
      definition({ briefing_type: "evening" }),
      runInput,
      deps
    );

    expect(evening.structuredPayload.actionRows).toEqual(morning.structuredPayload.actionRows);
  });

  it("counts cached linkless rows and omits rows without a source", () => {
    const result = projectActionRows([
      { id: "missing-source", sourceRef: null, suggestionMetadata: null },
      {
        id: "missing-cache",
        title: "No cache",
        description: null,
        dueAt: null,
        updatedAt: null,
        source: "email",
        sourceRef: "acct:missing-cache",
        suggestionMetadata: {
          version: 1,
          category: "time_sensitive_info",
          sourceLabel: "Gmail",
          sourceHref: "https://mail.example.test/thread",
          cacheMessageId: null,
          subjectSignature: "sig-missing-cache",
          computedAt: FIXED_NOW.toISOString(),
          resurfaceReason: null
        }
      },
      {
        id: "null-source",
        title: "Null source",
        description: null,
        dueAt: null,
        updatedAt: null,
        source: "email",
        sourceRef: null,
        suggestionMetadata: {
          version: 1,
          category: "needs_reply",
          sourceLabel: "Gmail",
          sourceHref: null,
          cacheMessageId: "cache-null-source",
          subjectSignature: "sig-null-source",
          computedAt: FIXED_NOW.toISOString(),
          resurfaceReason: null
        }
      },
      {
        id: "empty-source",
        title: "Empty source",
        description: null,
        dueAt: null,
        updatedAt: null,
        source: "email",
        sourceRef: "",
        suggestionMetadata: {
          version: 1,
          category: "needs_reply",
          sourceLabel: "Gmail",
          sourceHref: null,
          cacheMessageId: "cache-empty-source",
          subjectSignature: "sig-empty-source",
          computedAt: FIXED_NOW.toISOString(),
          resurfaceReason: null
        }
      },
      {
        id: "missing-link",
        title: "No link",
        description: "  ",
        dueAt: null,
        updatedAt: null,
        source: "email",
        sourceRef: "acct:message",
        suggestionMetadata: {
          version: 1,
          category: "needs_action",
          sourceLabel: "IMAP",
          sourceHref: null,
          cacheMessageId: "cache-imap",
          subjectSignature: "sig",
          computedAt: FIXED_NOW.toISOString(),
          resurfaceReason: null
        }
      }
    ]);

    expect(result.payload.actionRows).toHaveLength(1);
    expect(result.payload.actionRows[0]).toMatchObject({
      taskId: "missing-link",
      explanation: "This email may need your attention.",
      primaryAction: null,
      sourceHref: null
    });
    expect(result.sourceRefs).toEqual(new Set(["acct:message"]));
  });

  it("logs only the action-row stage and error class when tasks.list fails", async () => {
    const logs: unknown[][] = [];
    const deps = {
      ...makeFakeDeps({ failTool: "tasks.list" }),
      logger: { error: (...args: unknown[]) => logs.push(args) }
    } as unknown as ComposeDeps;
    const gaps: Parameters<typeof gatherActionRows>[4] = [];

    const result = await gatherActionRows(fakeScopedDb, definition(), runInput, deps, gaps);

    expect(result.payload.actionRows).toEqual([]);
    expect(gaps).toEqual([{ source: "action_rows", reason: "structured_payload_failed" }]);
    expect(logs[0]?.[0]).toEqual({ stage: "action-row-gather", name: "Error" });
    expect(JSON.stringify(logs)).not.toContain("message");
    expect(JSON.stringify(logs)).not.toContain("private");
  });

  it("records a sanitized invalid-metadata metric while omitting malformed rows", async () => {
    const logs: unknown[][] = [];
    const base = makeFakeDeps();
    const deps = {
      ...base,
      logger: { error: (...args: unknown[]) => logs.push(args) },
      moduleManifests: base.moduleManifests.map((manifest) => ({
        ...manifest,
        assistantTools: (manifest.assistantTools ?? []).map((tool) =>
          tool.name === "tasks.list"
            ? {
                ...tool,
                execute: async () => ({
                  data: { items: [{ id: "bad-row", suggestionMetadata: { private: "content" } }] }
                })
              }
            : tool
        )
      }))
    } as unknown as ComposeDeps;
    const gaps: Parameters<typeof gatherActionRows>[4] = [];

    const result = await gatherActionRows(fakeScopedDb, definition(), runInput, deps, gaps);

    expect(result.payload.actionRows).toEqual([]);
    expect(gaps).toEqual([]);
    expect(logs[0]?.[0]).toEqual({
      stage: "action-row-projection",
      name: "InvalidSuggestionMetadata",
      count: 1
    });
    expect(JSON.stringify(logs)).not.toContain("private");
  });

  it("builds bounded email-only catch-up from guarded summaries", async () => {
    const asOf = new Date("2026-06-13T12:30:00.000Z");
    const catchUp = await buildEmailCatchUp(
      fakeScopedDb,
      [
        { id: "excluded", connectorAccountId: "acct", actionability: "fyi", summary: "row" },
        { id: "one", connectorAccountId: "acct", actionability: "fyi", summary: "one" },
        {
          id: "two",
          connectorAccountId: "acct",
          actionability: "waiting_on_someone",
          summary: "two"
        },
        { id: "three", connectorAccountId: "acct", actionability: "fyi", summary: "three" },
        { id: "four", connectorAccountId: "acct", actionability: "fyi", summary: "four" },
        { id: "noise", connectorAccountId: "acct", actionability: "noise", summary: "noise" }
      ],
      new Set(["acct:excluded"]),
      async () => asOf
    );

    expect(catchUp).toEqual({
      source: "email",
      itemCount: 4,
      summaryText: "one\ntwo\nthree",
      asOf: asOf.toISOString()
    });
  });

  it("omits catch-up when no eligible email items remain", async () => {
    await expect(
      buildEmailCatchUp(
        fakeScopedDb,
        [{ id: "noise", connectorAccountId: "acct", actionability: "noise" }],
        new Set(),
        async () => new Date("2026-06-13T12:30:00.000Z")
      )
    ).resolves.toBeNull();
  });
});
