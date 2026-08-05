import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatMessageDto } from "@jarv1s/shared";
import { recordsFromMessages } from "../../apps/web/src/chat/chat-drawer.js";
import { Thread, activityVerb } from "../../apps/web/src/chat/message-row.js";

const allowedRecord = {
  kind: "action_result" as const,
  text: "Allowed by YOLO: Read",
  outcome: "allowed" as const
};

describe("chat drawer activity outcomes", () => {
  it("renders action outcomes outside Behind the scenes", () => {
    expect(activityVerb(allowedRecord)).toBe("Allowed by YOLO");

    const html = renderToString(
      createElement(Thread, {
        records: [
          { kind: "thinking", text: "Checking" },
          { kind: "reply", text: "I changed that." },
          { kind: "action_result", text: "LinkedIn monitoring enabled", outcome: "executed" }
        ]
      })
    );
    expect(html).toContain("Behind the scenes");
    expect(html).toContain("LinkedIn monitoring enabled");
    expect(html.indexOf("LinkedIn monitoring enabled")).toBeGreaterThan(
      html.indexOf("I changed that.")
    );
  });

  it("restores terminal action outcomes after history reload", () => {
    const message: ChatMessageDto = {
      id: "m1",
      threadId: "t1",
      ownerUserId: "u1",
      role: "assistant",
      status: "complete",
      body: "I changed that.",
      modelRoute: null,
      tools: [],
      activity: [
        { kind: "thinking", text: "Checking" },
        {
          kind: "action_result",
          text: "LinkedIn monitoring enabled",
          toolName: "job-search.portal.set-enabled",
          outcome: "executed"
        }
      ],
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z"
    };

    expect(recordsFromMessages([message])).toEqual([
      { kind: "thinking", text: "Checking" },
      {
        kind: "reply",
        text: "I changed that.",
        messageId: "m1",
        attachments: undefined,
        answerProvenance: undefined,
        answerProvenanceCitedIds: undefined,
        sourceFreshness: undefined
      },
      {
        kind: "action_result",
        text: "LinkedIn monitoring enabled",
        toolName: "job-search.portal.set-enabled",
        outcome: "executed"
      }
    ]);
  });
});
