import { describe, expect, it } from "vitest";

import {
  extractEmailSignals,
  MAX_SIGNAL_STR_CHARS,
  type EmailExtractDeps,
  type ParsedEmail
} from "../../packages/connectors/src/email-extract.js";

function parsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    externalId: "msg-1",
    historyId: null,
    subject: "Quarterly numbers",
    from: "Alice <alice@example.com>",
    recipients: ["ben@example.com"],
    receivedAt: "2026-07-03T12:00:00.000Z",
    labelIds: ["INBOX"],
    snippet: "Can you send the numbers",
    body: "Hi Ben, can you send over the Q2 numbers by Friday? Thanks, Alice.",
    bodyTruncated: false,
    ...overrides
  };
}

function depsReturning(json: Record<string, unknown>): EmailExtractDeps {
  return {
    selectModel: async () => ({ tier: "economy" }),
    runChat: async () => ({ text: JSON.stringify(json) })
  };
}

const BASE_REPLY = {
  summary: "Alice asks for the Q2 numbers by Friday.",
  billsDue: [],
  actionItems: [],
  deadlines: [],
  mayGetLostInShuffle: false,
  importance: "normal",
  confidence: 0.9
};

describe("email actionability triage", () => {
  it("carries a needs_reply classification through", async () => {
    const result = await extractEmailSignals(
      parsedEmail(),
      depsReturning({
        ...BASE_REPLY,
        actionability: {
          category: "needs_reply",
          reason: "Direct question from a real person expecting an answer.",
          suggestedTasks: [{ text: "Send Q2 numbers to Alice", dueDate: "2026-07-04" }]
        }
      })
    );
    expect(result.signals.actionability?.category).toBe("needs_reply");
    expect(result.signals.actionability?.reason).toContain("Direct question");
    expect(result.signals.actionability?.suggestedTasks).toEqual([
      { text: "Send Q2 numbers to Alice", dueDate: "2026-07-04" }
    ]);
  });

  it("carries needs_action with due date for a bill", async () => {
    const result = await extractEmailSignals(
      parsedEmail({ subject: "Your electric bill is due", body: "Amount due $120 by July 10." }),
      depsReturning({
        ...BASE_REPLY,
        summary: "Electric bill of $120 due July 10.",
        actionability: {
          category: "needs_action",
          reason: "Bill with a due date.",
          dueDate: "2026-07-10",
          suggestedTasks: [{ text: "Pay electric bill", dueDate: "2026-07-10" }]
        }
      })
    );
    expect(result.signals.actionability?.category).toBe("needs_action");
    expect(result.signals.actionability?.dueDate).toBe("2026-07-10");
  });

  it("keeps noise as noise with no suggested tasks", async () => {
    const result = await extractEmailSignals(
      parsedEmail({ subject: "50% OFF EVERYTHING", body: "Huge sale! Click now to save big." }),
      depsReturning({
        ...BASE_REPLY,
        summary: "Marketing blast.",
        actionability: { category: "noise" }
      })
    );
    expect(result.signals.actionability?.category).toBe("noise");
    expect(result.signals.actionability?.suggestedTasks ?? []).toEqual([]);
  });

  it("coerces an unknown category to unknown", async () => {
    const result = await extractEmailSignals(
      parsedEmail(),
      depsReturning({
        ...BASE_REPLY,
        actionability: { category: "very_important_do_now" }
      })
    );
    expect(result.signals.actionability?.category).toBe("unknown");
  });

  it("omits actionability entirely when the model returns none", async () => {
    const result = await extractEmailSignals(parsedEmail(), depsReturning(BASE_REPLY));
    expect(result.signals.actionability).toBeUndefined();
  });

  it("drops a body-echoing reason and suggested-task text", async () => {
    const body =
      "Hi Ben, can you send over the Q2 numbers by Friday? Also remember the offsite " +
      "planning doc needs review before the leadership sync on Monday morning. Thanks, Alice.";
    const result = await extractEmailSignals(
      parsedEmail({ body }),
      depsReturning({
        ...BASE_REPLY,
        actionability: {
          category: "needs_action",
          reason: body,
          suggestedTasks: [{ text: body }, { text: "Review offsite planning doc" }]
        }
      })
    );
    expect(result.signals.actionability?.category).toBe("needs_action");
    expect(result.signals.actionability?.reason).toBeUndefined();
    expect(result.signals.actionability?.suggestedTasks).toEqual([
      { text: "Review offsite planning doc" }
    ]);
  });

  it("bounds the reason length", async () => {
    const result = await extractEmailSignals(
      parsedEmail(),
      depsReturning({
        ...BASE_REPLY,
        actionability: { category: "fyi", reason: "z".repeat(5000) }
      })
    );
    expect(result.signals.actionability?.reason?.length ?? 0).toBeLessThanOrEqual(
      MAX_SIGNAL_STR_CHARS
    );
  });
});
