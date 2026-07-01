import type { ToolContext } from "@jarv1s/module-sdk";

/**
 * The tool-side input for a reply. This is the ONLY thing the model supplies: which cached
 * message to reply to and the composed body. Recipient, subject, and thread id are NEVER
 * accepted here — the impl derives them from the owner-visible cached email under the actor's
 * DataContextDb (security floor §5: the LLM can never address a message).
 */
export interface ReplyInput {
  readonly cacheMessageId: string;
  readonly body: string;
}

/**
 * Outcome of a draft/send. Always secret-free: `message` is a human-facing reason
 * (not-found, unsupported provider, re-consent needed, upstream failure) and never carries
 * tokens, upstream error bodies, or the email body.
 */
export interface EmailWriteResult {
  readonly ok: boolean;
  readonly mode: "draft" | "send";
  readonly message?: string;
}

/**
 * The contract the email reply tools depend on. OWNED BY packages/email so no connectors
 * import leaks into the email module. The concrete implementation is built in the composition
 * host (packages/chat), which is allowed to import connectors. The tools narrow the injected
 * `services.emailWrite` to this interface.
 */
export interface EmailWriteService {
  draftReply(
    scopedDb: unknown, // DataContextDb; impl narrows via assertDataContextDb
    ctx: ToolContext,
    input: ReplyInput
  ): Promise<EmailWriteResult>;
  sendReply(scopedDb: unknown, ctx: ToolContext, input: ReplyInput): Promise<EmailWriteResult>;
}
