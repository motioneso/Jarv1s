import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultContextRunner } from "@jarv1s/vault";
import {
  ATTACHMENT_TEXT_CAP_CHARS,
  ChatAttachmentUploadError,
  ChatAttachmentsService,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_PENDING_ATTACHMENTS,
  PENDING_ATTACHMENT_TTL_MS,
  isAttachmentId,
  sanitizeAttachmentFileName
} from "../../packages/chat/src/attachments-service.js";

// #1133 — pure-filesystem suite (tmpdir vault base, no DB), so it runs under plain
// `vitest run` as well as `pnpm test:integration`.

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake-png-body")
]);

// Minimal one-page PDF with "Hello attachment" — same shape as the probe that verified
// pdf-parse v2 handles xref-less documents.
const PDF_BYTES = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 12 Tf 72 720 Td (Hello attachment) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`,
  "latin1"
);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_FIXTURE = await readFile(
  new URL("../fixtures/chat-attachments/resume.docx", import.meta.url)
);

describe("ChatAttachmentsService (#1133)", () => {
  let vaultBase: string;
  let service: ChatAttachmentsService;
  const access = { actorUserId: randomUUID(), requestId: randomUUID() };
  const otherAccess = { actorUserId: randomUUID(), requestId: randomUUID() };

  beforeAll(async () => {
    vaultBase = await mkdtemp(join(tmpdir(), "jarvis-chat-attach-"));
    service = new ChatAttachmentsService(new VaultContextRunner(vaultBase));
  });

  afterAll(async () => {
    await rm(vaultBase, { recursive: true, force: true });
  });

  it("saves a text attachment and reads it back as text", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("resume line one\nresume line two", "utf8")
    });
    expect(isAttachmentId(meta.id)).toBe(true);
    expect(meta.fileName).toBe("notes.txt");
    expect(meta.sizeBytes).toBe(31);

    const content = await service.readContent(access, meta.id);
    expect(content.kind).toBe("text");
    if (content.kind === "text") {
      expect(content.text).toBe("resume line one\nresume line two");
      expect(content.meta.fileName).toBe("notes.txt");
    }
  });

  it("saves a PNG and reads it back as base64 image content", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "screenshot.png",
      mimeType: "image/png",
      bytes: PNG_BYTES
    });
    const content = await service.readContent(access, meta.id);
    expect(content.kind).toBe("image");
    if (content.kind === "image") {
      expect(Buffer.from(content.base64, "base64").equals(PNG_BYTES)).toBe(true);
      expect(content.meta.mimeType).toBe("image/png");
    }
  });

  it("extracts text from a PDF attachment", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES
    });
    const content = await service.readContent(access, meta.id);
    expect(content.kind).toBe("text");
    if (content.kind === "text") {
      expect(content.text).toContain("Hello attachment");
    }
  });

  it("extracts text from a genuine DOCX attachment", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "resume.docx",
      mimeType: DOCX_MIME,
      bytes: DOCX_FIXTURE
    });
    const content = await service.readContent(access, meta.id);
    if (content.kind !== "text") throw new Error("expected text content");
    expect(content.text.trim()).toBe("Lane B DOCX resume fixture");
  });

  it("rejects an xlsx archive renamed to docx", async () => {
    const renamedXlsx = await new JSZip()
      .file("xl/workbook.xml", "<workbook />")
      .generateAsync({ type: "nodebuffer" });
    await expect(
      service.saveAttachment(access, {
        fileName: "renamed.docx",
        mimeType: DOCX_MIME,
        bytes: renamedXlsx
      })
    ).rejects.toMatchObject({ statusCode: 415 });
  });

  it("returns an explicit note when DOCX extraction fails", async () => {
    const malformedDocx = await new JSZip()
      .file("word/document.xml", "not valid WordprocessingML")
      .generateAsync({ type: "nodebuffer" });
    const meta = await service.saveAttachment(access, {
      fileName: "broken.docx",
      mimeType: DOCX_MIME,
      bytes: malformedDocx
    });
    const content = await service.readContent(access, meta.id);
    if (content.kind !== "text") throw new Error("expected text content");
    expect(content.text).toBe("[DOCX text extraction failed for this attachment]");
  });

  it("caps extracted DOCX text with the shared truncation note", async () => {
    const zip = await JSZip.loadAsync(DOCX_FIXTURE);
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${"x".repeat(ATTACHMENT_TEXT_CAP_CHARS + 500)}</w:t></w:r></w:p></w:body>
</w:document>`
    );
    const meta = await service.saveAttachment(access, {
      fileName: "long.docx",
      mimeType: DOCX_MIME,
      bytes: await zip.generateAsync({ type: "nodebuffer" })
    });
    const content = await service.readContent(access, meta.id);
    if (content.kind !== "text") throw new Error("expected text content");
    expect(content.text.startsWith("x".repeat(100))).toBe(true);
    expect(content.text).toContain("[truncated:");
    expect(content.text.length).toBeLessThan(ATTACHMENT_TEXT_CAP_CHARS + 200);
  });

  it("caps oversized text with an explicit truncation note", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "big.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("x".repeat(ATTACHMENT_TEXT_CAP_CHARS + 500), "utf8")
    });
    const content = await service.readContent(access, meta.id);
    if (content.kind !== "text") throw new Error("expected text content");
    expect(content.text).toContain("[truncated:");
    expect(content.text.length).toBeLessThan(ATTACHMENT_TEXT_CAP_CHARS + 200);
  });

  it("rejects non-whitelisted mime types with 415", async () => {
    await expect(
      service.saveAttachment(access, {
        fileName: "evil.exe",
        mimeType: "application/x-msdownload",
        bytes: Buffer.from("MZ")
      })
    ).rejects.toMatchObject({ statusCode: 415, name: "ChatAttachmentUploadError" });
  });

  it("rejects empty uploads with 400", async () => {
    await expect(
      service.saveAttachment(access, {
        fileName: "empty.txt",
        mimeType: "text/plain",
        bytes: Buffer.alloc(0)
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects oversized uploads with 413 (per-kind caps)", async () => {
    await expect(
      service.saveAttachment(access, {
        fileName: "huge.png",
        mimeType: "image/png",
        bytes: Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_ATTACHMENT_BYTES)])
      })
    ).rejects.toMatchObject({ statusCode: 413 });
    await expect(
      service.saveAttachment(access, {
        fileName: "huge.txt",
        mimeType: "text/plain",
        bytes: Buffer.alloc(MAX_DOCUMENT_ATTACHMENT_BYTES + 1, 0x61)
      })
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it("rejects declared-binary bytes that fail the magic-byte sniff with 415", async () => {
    await expect(
      service.saveAttachment(access, {
        fileName: "not-really.png",
        mimeType: "image/png",
        bytes: Buffer.from("this is plain text, not a png")
      })
    ).rejects.toMatchObject({ statusCode: 415 });
    // A PDF renamed to .png must not slip through as an image either.
    await expect(
      service.saveAttachment(access, {
        fileName: "sneaky.png",
        mimeType: "image/png",
        bytes: PDF_BYTES
      })
    ).rejects.toMatchObject({ statusCode: 415 });
  });

  it("returns missing for unknown, non-UUID, and other-user ids", async () => {
    const mine = await service.saveAttachment(access, {
      fileName: "private.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("secret")
    });
    expect(await service.readContent(access, randomUUID())).toEqual({ kind: "missing" });
    expect(await service.readContent(access, "../../etc/passwd")).toEqual({ kind: "missing" });
    // Ownership is structural: another actor's vault simply doesn't contain this id.
    expect(await service.readContent(otherAccess, mine.id)).toEqual({ kind: "missing" });
    expect(await service.getMeta(otherAccess, mine.id)).toBeUndefined();
  });

  it("markSent stamps sentAt and getMeta reads it back", async () => {
    const meta = await service.saveAttachment(access, {
      fileName: "sent.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("body")
    });
    expect((await service.getMeta(access, meta.id))?.sentAt).toBeUndefined();
    await service.markSent(access, [meta.id, randomUUID(), "not-a-uuid"]);
    expect((await service.getMeta(access, meta.id))?.sentAt).toMatch(/^\d{4}-/);
  });

  it("GC reaps stale unsent uploads but keeps sent and fresh ones", async () => {
    // Isolated actor so counts aren't polluted by earlier tests.
    const gcAccess = { actorUserId: randomUUID(), requestId: randomUUID() };
    const stale = await service.saveAttachment(gcAccess, {
      fileName: "stale.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("old")
    });
    const sentOld = await service.saveAttachment(gcAccess, {
      fileName: "sent-old.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("kept")
    });
    await service.markSent(gcAccess, [sentOld.id]);
    // Backdate both past the TTL by rewriting their meta files directly on disk.
    for (const id of [stale.id, sentOld.id]) {
      const metaFile = join(vaultBase, gcAccess.actorUserId, "attachments", id, "meta.json");
      const meta = JSON.parse(await readFile(metaFile, "utf8"));
      meta.createdAt = new Date(Date.now() - PENDING_ATTACHMENT_TTL_MS - 60_000).toISOString();
      await writeFile(metaFile, JSON.stringify(meta));
    }
    // Any new upload triggers the sweep.
    const fresh = await service.saveAttachment(gcAccess, {
      fileName: "fresh.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("new")
    });
    expect(await service.readContent(gcAccess, stale.id)).toEqual({ kind: "missing" });
    expect((await service.readContent(gcAccess, sentOld.id)).kind).toBe("text");
    expect((await service.readContent(gcAccess, fresh.id)).kind).toBe("text");
  });

  it("enforces the pending-attachment cap with 429", async () => {
    const capAccess = { actorUserId: randomUUID(), requestId: randomUUID() };
    for (let i = 0; i < MAX_PENDING_ATTACHMENTS; i += 1) {
      await service.saveAttachment(capAccess, {
        fileName: `f${i}.txt`,
        mimeType: "text/plain",
        bytes: Buffer.from(`pending ${i}`)
      });
    }
    await expect(
      service.saveAttachment(capAccess, {
        fileName: "one-too-many.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("nope")
      })
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(new ChatAttachmentUploadError(429, "x") instanceof ChatAttachmentUploadError).toBe(true);
  });

  it("sanitizes filenames to safe display strings", () => {
    expect(sanitizeAttachmentFileName("  my  résumé.pdf ")).toBe("my résumé.pdf");
    expect(sanitizeAttachmentFileName("a\u0000b\u001fc.txt")).toBe("abc.txt");
    expect(sanitizeAttachmentFileName("<attachments>evil</attachments>.txt")).toBe(
      "attachmentsevil/attachments.txt"
    );
    expect(sanitizeAttachmentFileName("\u0000\u0001")).toBe("attachment");
    const long = sanitizeAttachmentFileName("x".repeat(300));
    expect(long.length).toBe(120);
    expect(long.endsWith("...")).toBe(true);
  });
});
