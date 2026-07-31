/**
 * The Gmail convention was verified by opening a generated link against a real connected account
 * on 2026-07-30. IMAP remains linkless in v1.
 */
export const GMAIL_ACTION_LINKS_ENABLED = true;

export interface GmailActionLinkInput {
  readonly accountIndex: number;
  readonly threadId: string;
}

export interface EmailActionLinkInput {
  readonly providerId: string;
  readonly threadId: string | null;
}

/** Pure provider-owned builder used by the explicit production gate and its verification test. */
export function buildGmailThreadLink(input: GmailActionLinkInput): string {
  return `https://mail.google.com/mail/u/${input.accountIndex}/#all/${encodeURIComponent(input.threadId)}`;
}

export function buildEmailActionLink(input: EmailActionLinkInput): string | null {
  if (!GMAIL_ACTION_LINKS_ENABLED || input.providerId !== "google" || !input.threadId) return null;
  // Known limitation: /u/0 is an unverifiable assumption about the viewer's browser session.
  return buildGmailThreadLink({ accountIndex: 0, threadId: input.threadId });
}
