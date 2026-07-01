import { describe, expect, it } from "vitest";

import type { EmailMessage } from "@jarv1s/db";
import { buildReplyMime, deriveReplyTarget } from "@jarv1s/email";

function makeMessage(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: "msg-1",
    connector_account_id: "acct-1",
    owner_user_id: "user-1",
    sender: "alice@example.com",
    recipients: ["me@example.com"],
    subject: "Lunch plans",
    snippet: null,
    body_excerpt: null,
    received_at: new Date().toISOString(),
    external_id: "ext-1",
    external_metadata: { threadId: "thread-42" },
    summary: null,
    signals: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  } as EmailMessage;
}

describe("deriveReplyTarget", () => {
  it("derives recipient from the sender, never from any caller input", () => {
    const target = deriveReplyTarget(makeMessage({ sender: "bob@example.com" }));
    expect(target.to).toBe("bob@example.com");
  });

  it("prefixes the subject with Re: when absent", () => {
    const target = deriveReplyTarget(makeMessage({ subject: "Lunch plans" }));
    expect(target.subject).toBe("Re: Lunch plans");
  });

  it("is idempotent when the subject already carries a Re: prefix (any case)", () => {
    expect(deriveReplyTarget(makeMessage({ subject: "Re: Lunch plans" })).subject).toBe(
      "Re: Lunch plans"
    );
    expect(deriveReplyTarget(makeMessage({ subject: "RE: Lunch plans" })).subject).toBe(
      "RE: Lunch plans"
    );
  });

  it("extracts threadId from external_metadata", () => {
    expect(
      deriveReplyTarget(makeMessage({ external_metadata: { threadId: "t-9" } })).threadId
    ).toBe("t-9");
  });

  it("returns null threadId when external_metadata lacks one", () => {
    expect(deriveReplyTarget(makeMessage({ external_metadata: {} })).threadId).toBeNull();
    expect(
      deriveReplyTarget(makeMessage({ external_metadata: null as never })).threadId
    ).toBeNull();
  });
});

describe("buildReplyMime", () => {
  it("produces a url-safe base64 string with no padding", () => {
    const raw = buildReplyMime({ to: "a@b.com", subject: "Re: Hi", body: "Hello there" });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw).not.toContain("=");
  });

  it("encodes RFC822 headers and the body verbatim", () => {
    const raw = buildReplyMime({
      to: "a@b.com",
      subject: "Re: Hi",
      body: "Line one\nLine two"
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: a@b.com");
    expect(decoded).toContain("Subject: Re: Hi");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("MIME-Version: 1.0");
    expect(decoded).toContain("Line one\nLine two");
  });
});
