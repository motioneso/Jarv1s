import { describe, expect, it, vi } from "vitest";

import { dataContextBrand, type DataContextDb, type EmailMessage } from "@jarv1s/db";
import type { ToolContext } from "@jarv1s/module-sdk";
import { GoogleApiError, GoogleConnectError } from "@jarv1s/connectors";
import { buildEmailWriteService, type EmailWriteImplDeps } from "@jarv1s/chat";

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

function makeDeps(overrides: Partial<EmailWriteImplDeps> = {}): {
  deps: EmailWriteImplDeps;
  createDraft: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const createDraft = vi.fn(async () => ({ id: "draft-1" }));
  const sendMessage = vi.fn(async () => ({ id: "msg-1", threadId: "thread-7" }));
  const deps: EmailWriteImplDeps = {
    emailRepository: { getById: async () => gmailMessage() },
    connectorsRepository: {
      getAccountProviderType: async () => "google",
      getGmailWriteScopeState: async () => ({ accountId: "google-acct", hasScope: true }),
      getActiveImapAccountSecret: async () => null
    },
    googleService: { getFreshAccessToken: async () => "fresh-token" },
    googleApiClient: { createDraft, sendMessage },
    preferencesRepository: { get: async () => null },
    ...overrides
  } as unknown as EmailWriteImplDeps;
  return { deps, createDraft, sendMessage };
}

describe("buildEmailWriteService.draftReply", () => {
  it("creates a threaded Gmail draft addressed to the cached sender", async () => {
    const { deps, createDraft } = makeDeps();
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, {
      cacheMessageId: "cache-1",
      body: "Sure!"
    });

    expect(result).toEqual({ ok: true, mode: "draft" });
    expect(createDraft).toHaveBeenCalledTimes(1);
    const call = createDraft.mock.calls[0]![0] as {
      accessToken: string;
      threadId: string;
      raw: string;
    };
    expect(call.accessToken).toBe("fresh-token");
    expect(call.threadId).toBe("thread-7");
    // Recipient is server-derived (sender), never from tool input.
    const decoded = Buffer.from(call.raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: alice@example.com");
    expect(decoded).toContain("Sure!");
  });

  it("returns a secret-free not-found message when the cached message is absent", async () => {
    const { deps, createDraft } = makeDeps({
      emailRepository: { getById: async () => undefined }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "nope", body: "x" });

    expect(result.ok).toBe(false);
    expect(createDraft).not.toHaveBeenCalled();
    expect(result.message).toBeTruthy();
  });

  it("routes IMAP accounts to the IMAP provider, never to Gmail", async () => {
    const { deps, createDraft } = makeDeps({
      emailRepository: { getById: async () => gmailMessage({ connector_account_id: "imap-acct" }) },
      connectorsRepository: {
        getAccountProviderType: async () => "imap",
        getGmailWriteScopeState: async () => ({ accountId: "google-acct", hasScope: true }),
        // No active IMAP secret wired here, so the IMAP provider fails closed with a
        // secret-free message — proving the dispatch reached IMAP, not Gmail.
        getActiveImapAccountSecret: async () => null
      }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("draft");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("prompts to reconnect when gmail.modify scope is missing", async () => {
    const { deps, createDraft } = makeDeps({
      connectorsRepository: {
        getAccountProviderType: async () => "google",
        getGmailWriteScopeState: async () => ({ accountId: "google-acct", hasScope: false })
      }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(result.ok).toBe(false);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("respects a revoked email feature grant", async () => {
    const { deps, createDraft } = makeDeps({
      preferencesRepository: { get: async () => ({ email: false, calendar: true }) }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(result.ok).toBe(false);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("denies IMAP draft and send when the email feature grant is revoked", async () => {
    const getActiveImapAccountSecret = vi.fn(async () => null);
    const { deps, createDraft, sendMessage } = makeDeps({
      emailRepository: { getById: async () => gmailMessage({ connector_account_id: "imap-acct" }) },
      connectorsRepository: {
        getAccountProviderType: async () => "imap",
        getGmailWriteScopeState: async () => ({ accountId: "google-acct", hasScope: true }),
        getActiveImapAccountSecret
      },
      preferencesRepository: { get: async () => ({ email: false, calendar: true }) }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);

    const draft = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });
    const send = await svc.sendReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(draft.ok).toBe(false);
    expect(send.ok).toBe(false);
    // The revoked grant must deny before the IMAP provider is ever engaged: no secret
    // lookup, and no Gmail calls either.
    expect(getActiveImapAccountSecret).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("wraps a Gmail API error into a secret-free message and never throws", async () => {
    const { deps } = makeDeps({
      googleApiClient: {
        createDraft: async () => {
          throw new GoogleApiError("Google gmail returned 403", 403);
        },
        sendMessage: async () => ({ id: "x" })
      }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
    expect(result.message).not.toContain("403");
  });

  it("handles a missing Google connection secret-free", async () => {
    const { deps } = makeDeps({
      googleService: {
        getFreshAccessToken: async () => {
          throw new GoogleConnectError("No active Google connection");
        }
      }
    } as unknown as Partial<EmailWriteImplDeps>);
    const svc = buildEmailWriteService(deps);
    const result = await svc.draftReply(scopedDb, ctx, { cacheMessageId: "cache-1", body: "x" });

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("buildEmailWriteService.sendReply", () => {
  it("sends a threaded Gmail message addressed to the cached sender", async () => {
    const { deps, sendMessage, createDraft } = makeDeps();
    const svc = buildEmailWriteService(deps);
    const result = await svc.sendReply(scopedDb, ctx, {
      cacheMessageId: "cache-1",
      body: "On my way"
    });

    expect(result).toEqual({ ok: true, mode: "send" });
    expect(createDraft).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const call = sendMessage.mock.calls[0]![0] as { threadId: string; raw: string };
    expect(call.threadId).toBe("thread-7");
    const decoded = Buffer.from(call.raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: alice@example.com");
  });
});
