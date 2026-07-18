import { sanitizeAttachmentFileName, type StoredAttachmentMeta } from "../attachments-service.js";

/**
 * #1133 — render the server-composed `<attachments>` block appended to the engine-bound
 * text for a turn that carries attachments. The engine reads each file on demand via the
 * `chat.readAttachment` MCP tool, so only metadata crosses this boundary — never bytes.
 *
 * `<attachments>` is a reserved seed-framing tag (see prompt-safety.ts): user-influenced
 * text can never fabricate this block, and sanitizeAttachmentFileName strips `<`/`>` from
 * names so a filename can't close the block early.
 */
export function renderAttachmentsManifest(metas: readonly StoredAttachmentMeta[]): string {
  if (metas.length === 0) return "";
  const lines = metas.map(
    (meta) =>
      `- attachmentId=${meta.id} name="${sanitizeAttachmentFileName(meta.fileName)}" ` +
      `type=${meta.mimeType} bytes=${meta.sizeBytes}`
  );
  return (
    "<attachments>\n" +
    `The user attached ${metas.length} file(s) to this message. To read one, call the ` +
    "chat.readAttachment tool with its attachmentId. Images come back as viewable " +
    "images; PDFs and text files come back as extracted text.\n" +
    `${lines.join("\n")}\n` +
    "</attachments>"
  );
}
