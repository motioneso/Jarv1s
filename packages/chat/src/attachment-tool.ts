import type { ToolExecute } from "@jarv1s/module-sdk";

import type { ChatAttachmentsService } from "./attachments-service.js";

/**
 * #1133 — `chat.readAttachment`: the engine's on-demand pull for a file the user
 * attached to the current turn. The engine learns ids from the server-composed
 * `<attachments>` manifest (see live/attachments-manifest.ts) and fetches bytes here,
 * so attachment content never rides in the prompt text itself.
 *
 * Risk is "read", which structurally routes this through the gateway's
 * readToolServices registry (never write-capable services, no confirmation). Vault
 * ownership is structural — the service resolves ids inside the CALLER's vault only,
 * so another user's id simply comes back "not found". Images return via the
 * `media` pass-through (MCP image content block, bypassing renderAndCap — see
 * gateway.runHandler); PDF/text return extracted text capped at
 * ATTACHMENT_TEXT_CAP_CHARS, under the gateway's 16k render cap.
 */
export const chatReadAttachmentExecute: ToolExecute = async (_scopedDb, input, ctx, services) => {
  const svc = services?.chatAttachments as ChatAttachmentsService | undefined;
  if (!svc) throw new Error("chat attachments service unavailable");
  const result = await svc.readContent(
    { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
    String(input.attachmentId ?? "")
  );
  if (result.kind === "missing") {
    return { data: { error: "Attachment not found" } };
  }
  if (result.kind === "image") {
    return {
      data: { fileName: result.meta.fileName, mimeType: result.meta.mimeType },
      media: { kind: "image", base64: result.base64, mimeType: result.meta.mimeType }
    };
  }
  return {
    data: { fileName: result.meta.fileName, mimeType: result.meta.mimeType, text: result.text }
  };
};
