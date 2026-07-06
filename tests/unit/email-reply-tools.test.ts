import { describe, expect, it, vi, afterEach } from "vitest";

import { dataContextBrand, type DataContextDb, type EmailMessage } from "@jarv1s/db";
import type { ToolContext, ToolServices } from "@jarv1s/module-sdk";
import {
  EmailRepository,
  emailDraftReplyExecute,
  emailReplyPreview,
  emailSendReplyExecute,
  summarizeDraftReply,
  summarizeSendReply
} from "@jarv1s/email";

const ctx: ToolContext = { actorUserId: "user-1", requestId: "req-1" } as ToolContext;
const scopedDb = { db: {} as never, [dataContextBrand]: true } satisfies DataContextDb;

function gmailMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "cache-1",
    connector_account_id: "google-acct",
    owner_user_id: "user-1",
    sender: "alice@example.com",
    recipients: ["me@example.com"],
    subject: "Lunch?",
    snippet: null,
    body_excerpt: null,
    received_at: new Date().toISOString(),
    external_id: "ext-1",
    external_metadata: { threadId: "thread-7" },
    summary: null,
    signals: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  } as EmailMessage;
}

afterEach(() => vi.restoreAllMocks());

describe("email reply tool execute", () => {
  it("draftReply plumbs {cacheMessageId, body} to the service and wraps the result", async () => {
    const draftReply = vi.fn(async () => ({ ok: true as const, mode: "draft" as const }));
    const services = { emailWrite: { draftReply, sendReply: vi.fn() } } as unknown as ToolServices;

    const result = await emailDraftReplyExecute(
      scopedDb,
      { cacheMessageId: "cache-1", body: "Sure!" },
      ctx,
      services
    );

    expect(draftReply).toHaveBeenCalledWith(scopedDb, ctx, {
      cacheMessageId: "cache-1",
      body: "Sure!"
    });
    expect(result).toEqual({ data: { ok: true, mode: "draft" } });
  });

  it("sendReply plumbs input to the service and surfaces a secret-free failure message", async () => {
    const sendReply = vi.fn(async () => ({
      ok: false as const,
      mode: "send" as const,
      message: "Replies aren't supported for this account yet."
    }));
    const services = { emailWrite: { draftReply: vi.fn(), sendReply } } as unknown as ToolServices;

    const result = await emailSendReplyExecute(
      scopedDb,
      { cacheMessageId: "cache-1", body: "On my way" },
      ctx,
      services
    );

    expect(sendReply).toHaveBeenCalledWith(scopedDb, ctx, {
      cacheMessageId: "cache-1",
      body: "On my way"
    });
    expect(result.data.ok).toBe(false);
    expect(result.data.message).toMatch(/aren't supported/i);
  });

  it("throws a fail-closed error when the emailWrite service is absent", async () => {
    await expect(
      emailDraftReplyExecute(scopedDb, { cacheMessageId: "c", body: "b" }, ctx, {} as ToolServices)
    ).rejects.toThrow(/emailWrite service is not available/);
  });
});

describe("email reply summarize (card fallback, body-free)", () => {
  it("draft summary mentions review-in-Gmail and never echoes the body", () => {
    const line = summarizeDraftReply({ cacheMessageId: "c", body: "SECRET-BODY" }, ctx);
    expect(line).not.toContain("SECRET-BODY");
    expect(line).toMatch(/draft/i);
  });

  it("send summary warns it sends immediately and never echoes the body", () => {
    const line = summarizeSendReply({ cacheMessageId: "c", body: "SECRET-BODY" }, ctx);
    expect(line).not.toContain("SECRET-BODY");
    expect(line).toMatch(/send/i);
  });
});

describe("email reply preview (server-derived, live-only)", () => {
  it("derives recipient/subject from the cached message and pairs the composed body", async () => {
    vi.spyOn(EmailRepository.prototype, "getById").mockResolvedValue(gmailMessage());

    const preview = await emailReplyPreview(
      scopedDb,
      { cacheMessageId: "cache-1", body: "Sure!" },
      ctx
    );

    expect(preview).toEqual({ to: "alice@example.com", subject: "Re: Lunch?", body: "Sure!" });
  });

  it("returns undefined when the cached message is not visible (→ card falls back to summary)", async () => {
    vi.spyOn(EmailRepository.prototype, "getById").mockResolvedValue(undefined);

    const preview = await emailReplyPreview(scopedDb, { cacheMessageId: "nope", body: "x" }, ctx);

    expect(preview).toBeUndefined();
  });

  it("returns undefined without a DB lookup when the message id is missing", async () => {
    const getById = vi.spyOn(EmailRepository.prototype, "getById");

    const preview = await emailReplyPreview(scopedDb, { body: "x" }, ctx);

    expect(preview).toBeUndefined();
    expect(getById).not.toHaveBeenCalled();
  });
});
