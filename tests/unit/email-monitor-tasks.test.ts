import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMAIL_TASK_MODE,
  emailTaskExternalKey,
  parseEmailTaskMode,
  planEmailTasks,
  type EmailContextItem
} from "@jarv1s/connectors";

const NOW = "2026-07-04T12:00:00.000Z";

function item(overrides: Partial<EmailContextItem> = {}): EmailContextItem {
  return {
    messageKey: "msg-1",
    account: { connectorAccountId: "acct-1", providerId: "google", providerLabel: "Gmail" },
    sender: "boss@work.example",
    recipients: ["me@self.example"],
    subject: "Budget approval needed",
    receivedAt: "2026-07-04T09:00:00.000Z",
    threadId: null,
    snippet: null,
    summary: "Approve the Q3 budget by Friday",
    actionability: "needs_action",
    importance: "normal",
    confidence: 0.9,
    reason: "Asks you to approve the budget",
    dueDate: null,
    suggestedTasks: [{ title: "Approve Q3 budget", dueDate: "2026-07-10T00:00:00.000Z" }],
    source: "live",
    degradedReason: null,
    cacheMessageId: null,
    ...overrides
  };
}

function plan(
  items: EmailContextItem[],
  mode: Parameters<typeof planEmailTasks>[0]["mode"],
  rejectionAggregates: Parameters<typeof planEmailTasks>[0]["rejectionAggregates"] = []
) {
  return planEmailTasks({ items, mode, rejectionAggregates, now: NOW });
}

describe("parseEmailTaskMode", () => {
  it("passes valid modes through and defaults everything else to suggest", () => {
    expect(parseEmailTaskMode("off")).toBe("off");
    expect(parseEmailTaskMode("auto_safe")).toBe("auto_safe");
    expect(parseEmailTaskMode("auto")).toBe("auto");
    expect(parseEmailTaskMode("banana")).toBe("suggest");
    expect(parseEmailTaskMode(null)).toBe("suggest");
    expect(parseEmailTaskMode(42)).toBe("suggest");
    expect(DEFAULT_EMAIL_TASK_MODE).toBe("suggest");
  });
});

describe("emailTaskExternalKey", () => {
  it("is deterministic and normalizes the action title", () => {
    expect(emailTaskExternalKey("acct-1", "msg-9", "Pay the Bill!")).toBe(
      "acct-1:msg-9:pay-the-bill"
    );
    expect(emailTaskExternalKey("acct-1", "msg-9", "Pay the Bill!")).toBe(
      emailTaskExternalKey("acct-1", "msg-9", "  pay THE bill?? ")
    );
  });

  it("caps the normalized segment at 40 chars", () => {
    const key = emailTaskExternalKey("a", "m", "x".repeat(120));
    expect(key).toBe(`a:m:${"x".repeat(40)}`);
  });
});

describe("planEmailTasks — candidate selection", () => {
  it("mode off plans nothing", () => {
    expect(plan([item()], "off")).toEqual([]);
  });

  it("plans needs_action and needs_reply candidates in suggest mode as suggested", () => {
    const planned = plan(
      [
        item(),
        item({
          messageKey: "msg-2",
          actionability: "needs_reply",
          suggestedTasks: [{ title: "Reply to Sam", dueDate: null }]
        })
      ],
      "suggest"
    );
    expect(planned).toHaveLength(2);
    expect(planned.every((t) => t.status === "suggested")).toBe(true);
    expect(planned[0]?.sourceRef).toBe("msg-1");
    expect(planned[0]?.externalKey).toBe(
      emailTaskExternalKey("acct-1", "msg-1", "Approve Q3 budget")
    );
  });

  it("never plans noise, fyi, waiting_on_someone, or unknown", () => {
    const planned = plan(
      [
        item({ actionability: "noise", subject: "MEGA SALE 50% off" }),
        item({ actionability: "fyi", messageKey: "msg-2" }),
        item({ actionability: "waiting_on_someone", messageKey: "msg-3" }),
        item({ actionability: "unknown", messageKey: "msg-4" })
      ],
      "auto"
    );
    expect(planned).toEqual([]);
  });

  it("plans time_sensitive_info only at high confidence with a due date or suggested task", () => {
    const highWithDue = item({
      actionability: "time_sensitive_info",
      confidence: 0.8,
      suggestedTasks: [],
      dueDate: "2026-07-05T00:00:00.000Z",
      subject: "Flight check-in closes tomorrow"
    });
    const lowConfidence = item({
      actionability: "time_sensitive_info",
      confidence: 0.5,
      messageKey: "msg-2",
      dueDate: "2026-07-05T00:00:00.000Z"
    });
    const planned = plan([highWithDue, lowConfidence], "suggest");
    expect(planned).toHaveLength(1);
    expect(planned[0]?.title).toBe("Flight check-in closes tomorrow");
  });

  it("skips candidates without a suggested task or due date, and confidence below 0.4", () => {
    const planned = plan(
      [item({ suggestedTasks: [], dueDate: null }), item({ messageKey: "msg-2", confidence: 0.3 })],
      "suggest"
    );
    expect(planned).toEqual([]);
  });

  it("plans one task per suggested task candidate with distinct external keys", () => {
    const planned = plan(
      [
        item({
          suggestedTasks: [
            { title: "Approve Q3 budget", dueDate: null },
            { title: "Forward to finance", dueDate: null }
          ]
        })
      ],
      "suggest"
    );
    expect(planned).toHaveLength(2);
    expect(new Set(planned.map((t) => t.externalKey)).size).toBe(2);
  });
});

describe("planEmailTasks — rejection-domain learning", () => {
  it("skips domains with >=3 rejections and no accepts", () => {
    const planned = plan([item({ sender: "billing@noisy.example" })], "suggest", [
      { senderDomain: "noisy.example", rejected: 3, accepted: 0 }
    ]);
    expect(planned).toEqual([]);
  });

  it("halves effective confidence for domains with >=3 rejections but some accepts", () => {
    const aggregates = [{ senderDomain: "mixed.example", rejected: 4, accepted: 1 }];
    // 0.9 → 0.45: still planned, but below the auto todo threshold (0.6) → suggested.
    const demoted = plan(
      [item({ sender: "a@mixed.example", confidence: 0.9 })],
      "auto",
      aggregates
    );
    expect(demoted).toHaveLength(1);
    expect(demoted[0]?.status).toBe("suggested");
    // 0.7 → 0.35: below the 0.4 floor → dropped entirely.
    const dropped = plan(
      [item({ sender: "a@mixed.example", messageKey: "msg-2", confidence: 0.7 })],
      "auto",
      aggregates
    );
    expect(dropped).toEqual([]);
  });
});

describe("planEmailTasks — status by mode", () => {
  it("auto_safe promotes only confident needs_action with a hard due date", () => {
    const planned = plan(
      [
        item({ dueDate: "2026-07-06T00:00:00.000Z", confidence: 0.8 }),
        item({ messageKey: "msg-2", dueDate: null, confidence: 0.9 }),
        item({ messageKey: "msg-3", dueDate: "2026-07-06T00:00:00.000Z", confidence: 0.6 })
      ],
      "auto_safe"
    );
    expect(planned.map((t) => [t.sourceRef, t.status])).toEqual([
      ["msg-1", "todo"],
      ["msg-2", "suggested"],
      ["msg-3", "suggested"]
    ]);
  });

  it("needs_reply is always suggested, even in auto mode", () => {
    const planned = plan(
      [
        item({
          actionability: "needs_reply",
          confidence: 0.95,
          dueDate: "2026-07-05T00:00:00.000Z",
          suggestedTasks: [{ title: "Reply to boss", dueDate: null }]
        })
      ],
      "auto"
    );
    expect(planned[0]?.status).toBe("suggested");
  });

  it("auto promotes needs_action at confidence >= 0.6 and stages the rest", () => {
    const planned = plan(
      [item({ confidence: 0.65 }), item({ messageKey: "msg-2", confidence: 0.5 })],
      "auto"
    );
    expect(planned.map((t) => t.status)).toEqual(["todo", "suggested"]);
  });
});

describe("planEmailTasks — output shape", () => {
  it("prioritizes due-within-48h and high importance at 2, else 3", () => {
    const planned = plan(
      [
        item({ suggestedTasks: [{ title: "Soon", dueDate: "2026-07-05T00:00:00.000Z" }] }),
        item({
          messageKey: "msg-2",
          importance: "high",
          suggestedTasks: [{ title: "Important", dueDate: null }]
        }),
        item({
          messageKey: "msg-3",
          suggestedTasks: [{ title: "Later", dueDate: "2026-07-20T00:00:00.000Z" }]
        })
      ],
      "suggest"
    );
    expect(planned.map((t) => t.priority)).toEqual([2, 2, 3]);
  });

  it("uses the candidate due date, falling back to the item due date", () => {
    const planned = plan(
      [
        item({
          dueDate: "2026-07-08T00:00:00.000Z",
          suggestedTasks: [
            { title: "Has own due", dueDate: "2026-07-06T00:00:00.000Z" },
            { title: "Inherits", dueDate: null }
          ]
        })
      ],
      "suggest"
    );
    expect(planned.map((t) => t.dueAt)).toEqual([
      "2026-07-06T00:00:00.000Z",
      "2026-07-08T00:00:00.000Z"
    ]);
  });

  it("uses the subject as the title when only a due date qualifies the item", () => {
    const planned = plan(
      [item({ suggestedTasks: [], dueDate: "2026-07-06T00:00:00.000Z" })],
      "suggest"
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]?.title).toBe("Budget approval needed");
  });

  it("bounds the description at 600 chars and never emits a planted body", () => {
    const body = "FULL PRIVATE BODY ".repeat(60);
    const longReason = "r".repeat(700);
    const planted = item({ reason: longReason }) as EmailContextItem & { body: string };
    const withBody = { ...planted, body };
    const planned = plan([withBody], "suggest");
    expect(planned[0]?.description?.length).toBe(600);
    expect(planned[0]?.description).not.toBe(body);
    expect(planned[0]?.description?.includes("FULL PRIVATE BODY")).toBe(false);
  });

  it("falls back to the summary when there is no reason", () => {
    const planned = plan([item({ reason: null })], "suggest");
    expect(planned[0]?.description).toBe("Approve the Q3 budget by Friday");
  });
});
