/**
 * #1133 — composer attachment helpers (pure state machine + validation).
 *
 * These rules gate what reaches the upload endpoint and which chips become
 * sendable DTOs; the server re-validates everything (authority stays there).
 */
import { describe, expect, it } from "vitest";

import {
  addPendingAttachment,
  attachmentValidationError,
  CLIENT_MAX_DOCUMENT_BYTES,
  CLIENT_MAX_IMAGE_BYTES,
  formatAttachmentSize,
  hasUploadingAttachment,
  markAttachmentError,
  markAttachmentReady,
  pastedImageFiles,
  readyAttachmentDtos,
  removePendingAttachment
} from "../../apps/web/src/chat/attachments.js";

describe("attachmentValidationError (#1133)", () => {
  it("accepts supported images and documents", () => {
    expect(
      attachmentValidationError({ type: "image/png", size: 1024, name: "shot.png" })
    ).toBeNull();
    expect(
      attachmentValidationError({ type: "application/pdf", size: 1024, name: "doc.pdf" })
    ).toBeNull();
    expect(
      attachmentValidationError({ type: "text/markdown", size: 1024, name: "notes.md" })
    ).toBeNull();
    expect(
      attachmentValidationError({ type: "application/json", size: 1024, name: "data.json" })
    ).toBeNull();
  });

  it("rejects unsupported types with the file name in the message", () => {
    const error = attachmentValidationError({
      type: "application/zip",
      size: 10,
      name: "bundle.zip"
    });
    expect(error).toContain("bundle.zip");
    expect(error).toContain("not a supported type");
  });

  it("enforces the image cap and the larger document cap separately", () => {
    expect(
      attachmentValidationError({
        type: "image/png",
        size: CLIENT_MAX_IMAGE_BYTES + 1,
        name: "big.png"
      })
    ).toContain("too large");
    // same size is fine as a document (10MB cap)
    expect(
      attachmentValidationError({
        type: "application/pdf",
        size: CLIENT_MAX_IMAGE_BYTES + 1,
        name: "big.pdf"
      })
    ).toBeNull();
    expect(
      attachmentValidationError({
        type: "application/pdf",
        size: CLIENT_MAX_DOCUMENT_BYTES + 1,
        name: "huge.pdf"
      })
    ).toContain("too large");
  });
});

describe("pending attachment state machine (#1133)", () => {
  const entry = { localId: "l1", fileName: "a.png", sizeBytes: 10, mimeType: "image/png" };

  it("add → ready produces a sendable DTO", () => {
    let list = addPendingAttachment([], entry);
    expect(hasUploadingAttachment(list)).toBe(true);
    expect(readyAttachmentDtos(list)).toEqual([]);

    list = markAttachmentReady(list, "l1", "server-id-1");
    expect(hasUploadingAttachment(list)).toBe(false);
    expect(readyAttachmentDtos(list)).toEqual([
      { id: "server-id-1", fileName: "a.png", mimeType: "image/png", sizeBytes: 10 }
    ]);
  });

  it("errored chips are excluded from the send and removable", () => {
    let list = addPendingAttachment([], entry);
    list = markAttachmentError(list, "l1", "Upload failed");
    expect(hasUploadingAttachment(list)).toBe(false);
    expect(readyAttachmentDtos(list)).toEqual([]);
    expect(list[0]?.error).toBe("Upload failed");

    list = removePendingAttachment(list, "l1");
    expect(list).toEqual([]);
  });

  it("marking an unknown localId is a no-op", () => {
    const list = addPendingAttachment([], entry);
    expect(markAttachmentReady(list, "nope", "x")).toEqual(list);
  });
});

describe("pastedImageFiles (#1133)", () => {
  const item = (kind: string, type: string, file: File | null) => ({
    kind,
    type,
    getAsFile: () => file
  });

  it("extracts only image files, leaving text items to default paste handling", () => {
    const png = new File(["x"], "shot.png", { type: "image/png" });
    const files = pastedImageFiles([
      item("string", "text/plain", null),
      item("file", "image/png", png),
      item("file", "application/pdf", new File(["y"], "d.pdf", { type: "application/pdf" }))
    ]);
    expect(files).toEqual([png]);
  });

  it("returns empty for a plain-text clipboard", () => {
    expect(pastedImageFiles([item("string", "text/plain", null)])).toEqual([]);
  });
});

describe("formatAttachmentSize (#1133)", () => {
  it("formats B / KB / MB", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2 KB");
    expect(formatAttachmentSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
