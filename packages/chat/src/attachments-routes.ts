import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext } from "@jarv1s/db";
import type { ChatAttachmentDto, UploadChatAttachmentResponse } from "@jarv1s/shared";

import {
  ChatAttachmentUploadError,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
  type ChatAttachmentsService,
  type StoredAttachmentMeta
} from "./attachments-service.js";

/**
 * #1133 / #1154 — chat attachment upload.
 *
 * Protocol (deviates from the spec's original multipart sketch, recorded there): the body is
 * the raw file bytes as `application/octet-stream`; the DECLARED mime travels in the
 * `x-jarvis-mime-type` header and the display filename, percent-encoded, in
 * `x-jarvis-file-name`. One exact-match buffer parser avoids colliding with the default
 * JSON/text parsers and the skills-import `text/markdown` parser, and skips a multipart
 * dependency for what is a single blob (same reasoning as /api/ai/transcriptions).
 *
 * Bytes flow request → ChatAttachmentsService → vault only: never logged, never persisted
 * to the DB, never placed on a pg-boss payload.
 */

const OCTET_STREAM = "application/octet-stream";
// Server-level cap; per-kind caps (5MB image / 10MB doc) are enforced by the service with
// friendlier 413 messages. Slack over the doc cap so a body AT the cap isn't cut off here.
const UPLOAD_BODY_LIMIT = MAX_DOCUMENT_ATTACHMENT_BYTES + 64 * 1024;

export interface ChatAttachmentRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly attachmentsService: ChatAttachmentsService;
}

export function storedMetaToDto(meta: StoredAttachmentMeta): ChatAttachmentDto {
  // Wire DTO deliberately drops createdAt/sentAt — lifecycle detail the client never needs.
  return {
    id: meta.id,
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes
  };
}

export function registerChatAttachmentRoutes(
  server: FastifyInstance,
  deps: ChatAttachmentRoutesDependencies
): void {
  server.addContentTypeParser(OCTET_STREAM, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  server.post("/api/chat/attachments", { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    let access: AccessContext;
    try {
      access = await deps.resolveAccessContext(request);
    } catch {
      return reply.code(401).send({ error: "Session is missing or expired" });
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply
        .code(400)
        .send({ error: `Attachment body must be non-empty ${OCTET_STREAM} bytes` });
    }

    const mimeType = request.headers["x-jarvis-mime-type"];
    if (typeof mimeType !== "string" || mimeType.length === 0) {
      return reply.code(400).send({ error: "Missing x-jarvis-mime-type header" });
    }

    const rawFileName = request.headers["x-jarvis-file-name"];
    if (typeof rawFileName !== "string" || rawFileName.length === 0) {
      return reply.code(400).send({ error: "Missing x-jarvis-file-name header" });
    }
    let fileName: string;
    try {
      // Percent-encoding keeps non-ASCII filenames legal in a header; a malformed
      // sequence is a client bug, not something to guess around.
      fileName = decodeURIComponent(rawFileName);
    } catch {
      return reply.code(400).send({ error: "x-jarvis-file-name must be percent-encoded" });
    }

    try {
      const meta = await deps.attachmentsService.saveAttachment(access, {
        fileName,
        mimeType,
        bytes: body
      });
      const response: UploadChatAttachmentResponse = { attachment: storedMetaToDto(meta) };
      return reply.code(201).send(response);
    } catch (error) {
      if (error instanceof ChatAttachmentUploadError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      // Scrub unexpected errors — a vault path could leak the userId-derived directory.
      request.log.error({ err: error }, "chat attachment upload failed");
      return reply.code(500).send({ error: "Attachment upload failed" });
    }
  });
}
