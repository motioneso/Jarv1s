import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ActionRequestCard } from "../../apps/web/src/chat/action-request-card.js";
import { parseRecord } from "../../apps/web/src/chat/use-chat-stream.js";

describe("ActionRequestCard email preview", () => {
  const baseProps = {
    actionRequestId: "ar_1",
    toolName: "email.draftReply",
    summary: "Draft a reply to Alice"
  };

  it("renders recipient, subject and body when a preview is present", () => {
    const html = renderToString(
      createElement(ActionRequestCard, {
        ...baseProps,
        preview: {
          to: "alice@example.test",
          subject: "Re: lunch plans",
          body: "Sounds great — see you at noon."
        }
      })
    );
    expect(html).toContain("alice@example.test");
    expect(html).toContain("Re: lunch plans");
    expect(html).toContain("Sounds great — see you at noon.");
    // Approve / Reject controls still render.
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });

  it("renders summary-only (no preview block) when no preview is supplied", () => {
    const html = renderToString(createElement(ActionRequestCard, baseProps));
    expect(html).toContain("Draft a reply to Alice");
    // The tool-name label reuses the "action-request-preview__label" class (Decision 6),
    // so we assert on the preview-block-specific containers rather than that shared prefix.
    expect(html).not.toContain("action-request-preview__meta");
    expect(html).not.toContain("action-request-preview__value");
  });

  it("renders the tool name as a distinct, humanized label, not just buried in summary", () => {
    // humanizeToolName strips the module prefix and splits camelCase: "email.draftReply" -> "Draft Reply".
    const html = renderToString(createElement(ActionRequestCard, baseProps));
    expect(html).toContain("action-request-preview__label");
    expect(html).toContain("Draft Reply");
  });

  // Focus-return-on-resolve (status → done/error) is verified via manual dev QA;
  // renderToString has no DOM/focus APIs to assert against here.
  it("never renders an Always-approve control, and orders Approve before Reject", () => {
    const html = renderToString(createElement(ActionRequestCard, baseProps));
    expect(html).not.toMatch(/always approve/i);
    expect(html.indexOf("Approve")).toBeLessThan(html.indexOf("Reject"));
  });
});

describe("parseRecord preview parsing", () => {
  it("parses a well-formed preview object off the SSE chunk", () => {
    const record = parseRecord(
      JSON.stringify({
        kind: "action_request",
        text: "Approve or deny: Draft a reply",
        actionRequestId: "ar_1",
        toolName: "email.draftReply",
        summary: "Draft a reply",
        preview: { to: "alice@example.test", subject: "Re: hi", body: "hello there" }
      })
    );
    expect(record?.preview).toEqual({
      to: "alice@example.test",
      subject: "Re: hi",
      body: "hello there"
    });
  });

  it("drops a malformed preview (missing/wrong-typed fields) rather than trusting it", () => {
    const record = parseRecord(
      JSON.stringify({
        kind: "action_request",
        text: "Approve or deny: Draft a reply",
        summary: "Draft a reply",
        preview: { to: 5, subject: "Re: hi" }
      })
    );
    expect(record?.preview).toBeUndefined();
  });

  it("accepts an allowed outcome on an action_result record", () => {
    const record = parseRecord(
      JSON.stringify({
        kind: "action_result",
        text: "Allowed by YOLO: Read",
        actionRequestId: "ar_1",
        toolName: "Read",
        outcome: "allowed"
      })
    );
    expect(record?.outcome).toBe("allowed");
  });
});
