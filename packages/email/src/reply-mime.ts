import type { EmailMessage } from "@jarv1s/db";

/**
 * The addressing derived for a reply. This is the ONLY source of truth for who a
 * reply goes to — it is computed from the owner-visible cached email under the actor's
 * DataContextDb, never from model/tool input (security floor §5: the LLM can never address).
 */
export interface ReplyTarget {
  readonly to: string;
  readonly subject: string;
  readonly threadId: string | null;
}

const RE_PREFIX = /^\s*re:/i;

/**
 * Derive reply addressing from a cached email message. Recipient is the original sender,
 * subject gains a `Re: ` prefix if it lacks one (case-insensitive, idempotent), and the
 * Gmail thread id is read from the cached `external_metadata`.
 */
export function deriveReplyTarget(message: EmailMessage): ReplyTarget {
  const metadata =
    message.external_metadata != null && typeof message.external_metadata === "object"
      ? (message.external_metadata as Record<string, unknown>)
      : {};
  const threadId = typeof metadata.threadId === "string" ? metadata.threadId : null;
  const subject = RE_PREFIX.test(message.subject) ? message.subject : `Re: ${message.subject}`;
  return { to: message.sender, subject, threadId };
}

/**
 * Build a base64url-encoded RFC822 plain-text message for the Gmail draft/send APIs.
 * The body is emitted verbatim; headers are minimal (To/Subject/MIME-Version/Content-Type).
 */
export function buildReplyMime(input: { to: string; subject: string; body: string }): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8"
  ];
  const message = `${headers.join("\n")}\n\n${input.body}`;
  return Buffer.from(message, "utf8").toString("base64url");
}
