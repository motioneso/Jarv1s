import { assertDataContextDb, type EmailMessage } from "@jarv1s/db";
import type {
  ActionRequestPreview,
  ToolContext,
  ToolExecute,
  ToolPreview,
  ToolResult,
  ToolServices
} from "@jarv1s/module-sdk";
import { emailMessageDtoSchema, nullableStringSchema } from "@jarv1s/shared";

import type { EmailWriteService, ReplyInput } from "./email-write-service.js";
import { deriveReplyTarget } from "./reply-mime.js";
import { EmailRepository } from "./repository.js";
import { serializeEmailMessage } from "./routes.js";

const repository = new EmailRepository();

export const emailToolMessageOutputSchema = {
  ...emailMessageDtoSchema,
  required: [...emailMessageDtoSchema.required, "connectorAccountId"],
  properties: {
    ...emailMessageDtoSchema.properties,
    connectorAccountId: { type: "string" },
    threadId: nullableStringSchema,
    connectorLabel: nullableStringSchema
  }
} as const;

// Structural interface — no @jarv1s/connectors import (module isolation).
interface FeatureGrantService {
  grantedAccountIds(
    scopedDb: Parameters<ToolExecute>[0],
    feature: "email" | "calendar"
  ): Promise<ReadonlySet<string>>;
}

function narrowFeatureGrants(services: ToolServices | undefined): FeatureGrantService {
  const svc = (services ?? {}).featureGrants as FeatureGrantService | undefined;
  if (!svc || typeof svc.grantedAccountIds !== "function") {
    throw new Error("featureGrants service is not available");
  }
  return svc;
}

export const emailListVisibleMessagesExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const featureGrants = narrowFeatureGrants(services);
  const grantedIds = await featureGrants.grantedAccountIds(scopedDb, "email");
  const messages = await repository.listVisibleForBriefing(scopedDb);
  const filtered = messages.filter((m) => grantedIds.has(m.connector_account_id));
  return { data: { messages: filtered.map(serializeEmailToolMessage) } };
};

function serializeEmailToolMessage(message: EmailMessage) {
  const base = serializeEmailMessage(message);
  const md: Record<string, unknown> =
    message.external_metadata != null && typeof message.external_metadata === "object"
      ? (message.external_metadata as Record<string, unknown>)
      : {};
  return {
    ...base,
    connectorAccountId: message.connector_account_id,
    threadId: typeof md.threadId === "string" ? md.threadId : null,
    connectorLabel: typeof md.connectorLabel === "string" ? md.connectorLabel : null
  };
}

// ── Reply write tools (email.draftReply / email.sendReply) ────────────────────────────────
//
// Tool input is `{ cacheMessageId, body }` ONLY — the model never addresses. The write-impl
// re-derives recipient/subject/threadId from the owner-visible cached email under DataContextDb
// (security floor §5). These tools are thin: narrow the composition-host `emailWrite` service
// and hand it the (validated) input. The composed body rides the live card preview + the Gmail
// call only; it is never persisted (summarize below is deliberately body-free).

// Structural interface — the concrete service is built in the composition host (packages/chat)
// which may import connectors. The email module only knows this shape (module isolation).
function narrowEmailWrite(services: ToolServices | undefined): EmailWriteService {
  const svc = (services ?? {}).emailWrite as EmailWriteService | undefined;
  if (!svc || typeof svc.draftReply !== "function" || typeof svc.sendReply !== "function") {
    throw new Error("emailWrite service is not available");
  }
  return svc;
}

function readReplyInput(input: Record<string, unknown>): ReplyInput {
  return {
    cacheMessageId: typeof input.cacheMessageId === "string" ? input.cacheMessageId : "",
    body: typeof input.body === "string" ? input.body : ""
  };
}

export const emailDraftReplyExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  const service = narrowEmailWrite(services);
  const result = await service.draftReply(scopedDb, ctx, readReplyInput(input));
  return { data: { ...result } };
};

export const emailSendReplyExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  const service = narrowEmailWrite(services);
  const result = await service.sendReply(scopedDb, ctx, readReplyInput(input));
  return { data: { ...result } };
};

// Card fallback lines — NO body, NO recipient interpolation from input (the rich, server-derived
// recipient/subject/body arrives via the async `preview` producer below; this is the text a client
// shows when no preview is present).
export function summarizeDraftReply(_input: Record<string, unknown>, _ctx: ToolContext): string {
  return (
    "Draft a reply to this email? Jarvis addresses it to the original sender on the existing " +
    "thread — the draft lands in Gmail for you to review before it sends."
  );
}

export function summarizeSendReply(_input: Record<string, unknown>, _ctx: ToolContext): string {
  return (
    "Send this reply? Jarvis addresses it to the original sender on the existing thread. " +
    "It sends immediately and can't be undone from Jarvis."
  );
}

/**
 * Async card-preview producer shared by both reply tools. Derives the recipient/subject from the
 * owner-visible cached email under the actor's DataContextDb and pairs them with the composed
 * `body` from input. Returned on the live SSE card only — NEVER persisted (the durable row keeps
 * the key-names-only inputSummary). Returns undefined (→ card falls back to summarize) when the
 * message id is missing or the cached row is not visible to the actor.
 */
export const emailReplyPreview: ToolPreview = async (
  scopedDb,
  input,
  _ctx,
  _services
): Promise<ActionRequestPreview | undefined> => {
  assertDataContextDb(scopedDb);
  const { cacheMessageId, body } = readReplyInput(input);
  if (!cacheMessageId) return undefined;
  const message = await repository.getById(scopedDb, cacheMessageId);
  if (!message) return undefined;
  const target = deriveReplyTarget(message);
  return { to: target.to, subject: target.subject, body };
};
