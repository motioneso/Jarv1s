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
  readonly references: string[] | null;
}

const RE_PREFIX = /^\s*re:/i;

/**
 * Extract thread identifier from IMAP headers (Message-ID, References).
 * IMAP threads are RFC822 message chains; threadId is first Message-ID in chain.
 */
function deriveImapThreadId(metadata: Record<string, unknown>): {
  threadId: string | null;
  references: string[] | null;
} {
  const messageId = typeof metadata.messageId === "string" ? metadata.messageId : null;
  const referencesRaw = metadata.references;
  const references: string[] = [];

  if (Array.isArray(referencesRaw)) {
    for (const ref of referencesRaw) {
      if (typeof ref === "string" && ref) references.push(ref);
    }
  } else if (typeof referencesRaw === "string" && referencesRaw) {
    references.push(referencesRaw);
  }

  const threadId: string | null =
    references.length > 0 ? (references[0] ?? null) : (messageId ?? null);
  const allReferences: string[] = messageId ? [...references, messageId] : references;

  return { threadId, references: allReferences.length > 0 ? allReferences : null };
}

/**
 * Derive reply addressing from a cached email message. Recipient is the original sender,
 * subject gains a `Re: ` prefix if it lacks one (case-insensitive, idempotent), and the
 * thread identifier is derived based on provider type (Gmail: threadId, IMAP: Message-ID chain).
 */
export function deriveReplyTarget(message: EmailMessage): ReplyTarget {
  const metadata =
    message.external_metadata != null && typeof message.external_metadata === "object"
      ? (message.external_metadata as Record<string, unknown>)
      : {};

  // Prefer an explicit thread identifier (Gmail stores one); otherwise derive the
  // thread from the IMAP RFC822 header chain (Message-ID/References). Keying on a
  // stored `providerType` marker is unreliable — no ingest path writes one — so the
  // derivation is provider-agnostic and depends only on which fields are present.
  const explicitThreadId = typeof metadata.threadId === "string" ? metadata.threadId : null;
  let threadId: string | null;
  let references: string[] | null = null;

  if (explicitThreadId) {
    threadId = explicitThreadId;
  } else {
    const imapThread = deriveImapThreadId(metadata);
    threadId = imapThread.threadId;
    references = imapThread.references;
  }

  const subject = RE_PREFIX.test(message.subject) ? message.subject : `Re: ${message.subject}`;
  return { to: message.sender, subject, threadId, references };
}

/**
 * Remove CR and LF from a value destined for an RFC822 header. Reply header values
 * (recipient, subject) are derived from cached inbound email; stripping line breaks
 * closes a header-injection vector (e.g. a smuggled `Bcc:`) even if upstream ingestion
 * ever fails to normalize them. Header folding is not needed for our short values.
 */
function stripHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Build a base64url-encoded RFC822 plain-text message for the Gmail draft/send APIs.
 * The body is emitted verbatim; headers are minimal (To/Subject/MIME-Version/Content-Type).
 */
export function buildReplyMime(input: { to: string; subject: string; body: string }): string {
  return buildNewMessageMime(input);
}

export function buildNewMessageMime(input: { to: string; subject: string; body: string }): string {
  const headers = [
    `To: ${stripHeaderValue(input.to)}`,
    `Subject: ${stripHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8"
  ];
  const message = `${headers.join("\n")}\n\n${input.body}`;
  return Buffer.from(message, "utf8").toString("base64url");
}
