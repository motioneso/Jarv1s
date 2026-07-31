/**
 * Gmail links are disabled until the final URL has been opened against a real connected dev
 * account. Flip this one point only after that verification; IMAP remains linkless in v1.
 */
export const GMAIL_ACTION_LINKS_ENABLED = false;

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
  return buildGmailThreadLink({ accountIndex: 0, threadId: input.threadId });
}
