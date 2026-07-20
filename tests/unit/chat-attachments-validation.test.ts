// #1216 / #1193 — keep web fail-fast attachment validation aligned with the server's
// DOCX-capable whitelist so resume intake does not reject supported Word documents.
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ACCEPT,
  attachmentValidationError,
  CLIENT_MAX_DOCUMENT_BYTES
} from "../../apps/web/src/chat/attachments.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("chat attachment validation (#1216)", () => {
  it("accepts a small Word document", () => {
    expect(
      attachmentValidationError({ type: DOCX_MIME, size: 1_024, name: "resume.docx" })
    ).toBeNull();
  });

  it("applies the document size cap to Word documents", () => {
    expect(
      attachmentValidationError({
        type: DOCX_MIME,
        size: CLIENT_MAX_DOCUMENT_BYTES + 1,
        name: "resume.docx"
      })
    ).toBe('"resume.docx" is too large (max 10MB).');
  });

  it("still rejects unsupported attachment types", () => {
    expect(
      attachmentValidationError({ type: "application/zip", size: 1_024, name: "archive.zip" })
    ).toBe(
      '"archive.zip" is not a supported type. Attach images, PDFs, Word documents, or text files.'
    );
  });

  it("offers Word documents in the file picker", () => {
    expect(ATTACHMENT_ACCEPT).toContain(DOCX_MIME);
  });
});
