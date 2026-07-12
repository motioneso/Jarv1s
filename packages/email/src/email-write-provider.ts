import type { DataContextDb, EmailMessage } from "@jarv1s/db";

import type { EmailWriteResult } from "./email-write-service.js";

export interface NewEmailInput {
  readonly connectorAccountId?: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * The provider-abstracted email write seam. Owns the backend-specific mechanics of
 * drafting (save to provider) and sending (submit + append to Sent). Each provider
 * implements this interface: Gmail = drafts.create/messages.send; IMAP = APPEND
 * to \Drafts / SMTP submit + APPEND to \Sent.
 *
 * Security invariants (never violated):
 * - Credentials never escape: implementations receive secrets but never serialize
 *   them into HTTP responses, logs, pg-boss payloads, exports, or AI prompts.
 * - Metadata-only: send is synchronous; body rides the chat stream, never the DB.
 * - Provider-agnostic AI: tools unchanged; model sees only cacheMessageId + body.
 */
export interface EmailWriteProvider {
  /**
   * Save a draft to the provider. For Gmail, this creates a draft in the user's
   * Drafts folder. For IMAP, this APPENDs the message to the \Drafts mailbox.
   *
   * @param scopedDb - Actor-scoped database context for credential lookup.
   * @param message - The cached email message we're replying to (owner-RLS-scoped).
   * @param to - Recipient address (derived from message.sender).
   * @param subject - Reply subject (derived from message.subject with Re: prefix).
   * @param threadId - Provider's thread identifier (Gmail threadId or IMAP Message-ID).
   * @param body - Plain-text reply body (from model, never persisted).
   * @returns Secret-free result; failures carry human-safe reasons only.
   */
  saveDraft(
    scopedDb: DataContextDb,
    message: EmailMessage,
    to: string,
    subject: string,
    threadId: string | null,
    body: string
  ): Promise<EmailWriteResult>;

  /**
   * Send a reply via the provider. For Gmail, this submits via messages.send.
   * For IMAP, this sends via SMTP then APPENDs to \Sent.
   *
   * @param scopedDb - Actor-scoped database context for credential lookup.
   * @param message - The cached email message we're replying to (owner-RLS-scoped).
   * @param to - Recipient address (derived from message.sender).
   * @param subject - Reply subject (derived from message.subject with Re: prefix).
   * @param threadId - Provider's thread identifier (Gmail threadId or IMAP Message-ID).
   * @param body - Plain-text reply body (from model, never persisted).
   * @returns Secret-free result; failures carry human-safe reasons only.
   */
  send(
    scopedDb: DataContextDb,
    message: EmailMessage,
    to: string,
    subject: string,
    threadId: string | null,
    body: string
  ): Promise<EmailWriteResult>;

  sendNew(scopedDb: DataContextDb, input: NewEmailInput): Promise<EmailWriteResult>;
}
