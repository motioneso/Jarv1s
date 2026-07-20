import type { ChatAttachmentDto } from "@jarv1s/shared";

/**
 * #1133 — client-side pending-attachment state for the chat composer.
 *
 * Pure helpers (no React, no fetch) so the accept/reject rules and the chip state
 * machine are unit-testable without rendering the composer — mirroring how
 * `mergeTranscriptIntoText` keeps the voice-input invariant testable (#738).
 *
 * The validation constants MIRROR the server's attachments-service; the server remains
 * the authority (it re-checks mime, size, and magic bytes on upload). Client checks
 * exist only to fail fast with a friendly message before spending the upload.
 */

export const CLIENT_MAX_ATTACHMENTS_PER_TURN = 5;
export const CLIENT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CLIENT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// #1216 — mirror the server whitelist (packages/chat attachments-service classifyAttachmentMime);
// the client must fail-fast-accept exactly what the server extracts, and it extracts DOCX.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The file-input `accept` list — same families the server whitelists. */
export const ATTACHMENT_ACCEPT = `image/png,image/jpeg,image/webp,image/gif,application/pdf,${DOCX_MIME},text/*,application/json`;

export interface PendingAttachment {
  /** Client-generated key for list rendering/removal — never sent to the server. */
  readonly localId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly status: "uploading" | "ready" | "error";
  /** Server attachment id, present once status is "ready". */
  readonly id?: string;
  readonly error?: string;
}

/** Returns a user-facing rejection reason, or null when the file is acceptable. */
export function attachmentValidationError(file: {
  readonly type: string;
  readonly size: number;
  readonly name: string;
}): string | null {
  const isImage = IMAGE_MIMES.has(file.type);
  const isDocument =
    file.type === "application/pdf" ||
    file.type === DOCX_MIME ||
    file.type.startsWith("text/") ||
    file.type === "application/json";
  if (!isImage && !isDocument) {
    return `"${file.name}" is not a supported type. Attach images, PDFs, Word documents, or text files.`;
  }
  const cap = isImage ? CLIENT_MAX_IMAGE_BYTES : CLIENT_MAX_DOCUMENT_BYTES;
  if (file.size > cap) {
    return `"${file.name}" is too large (max ${Math.round(cap / (1024 * 1024))}MB).`;
  }
  return null;
}

export function addPendingAttachment(
  list: readonly PendingAttachment[],
  entry: {
    readonly localId: string;
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly mimeType: string;
  }
): readonly PendingAttachment[] {
  return [...list, { ...entry, status: "uploading" }];
}

export function markAttachmentReady(
  list: readonly PendingAttachment[],
  localId: string,
  id: string
): readonly PendingAttachment[] {
  return list.map((item) =>
    item.localId === localId ? { ...item, status: "ready" as const, id } : item
  );
}

export function markAttachmentError(
  list: readonly PendingAttachment[],
  localId: string,
  error: string
): readonly PendingAttachment[] {
  return list.map((item) =>
    item.localId === localId ? { ...item, status: "error" as const, error } : item
  );
}

export function removePendingAttachment(
  list: readonly PendingAttachment[],
  localId: string
): readonly PendingAttachment[] {
  return list.filter((item) => item.localId !== localId);
}

/** Wire DTOs for the chips that are actually sendable (uploaded, have a server id). */
export function readyAttachmentDtos(list: readonly PendingAttachment[]): ChatAttachmentDto[] {
  return list.flatMap((item) =>
    item.status === "ready" && item.id
      ? [
          {
            id: item.id,
            fileName: item.fileName,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes
          }
        ]
      : []
  );
}

export function hasUploadingAttachment(list: readonly PendingAttachment[]): boolean {
  return list.some((item) => item.status === "uploading");
}

/**
 * Extracts image files from a paste event's items (screenshot paste). Non-image
 * clipboard content (plain text) is left to the textarea's default paste handling.
 */
export function pastedImageFiles(
  items: ArrayLike<{ readonly kind: string; readonly type: string; getAsFile(): File | null }>
): File[] {
  const files: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && item.kind === "file" && IMAGE_MIMES.has(item.type)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
