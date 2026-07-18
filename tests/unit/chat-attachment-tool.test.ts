/**
 * #1133 — chat.readAttachment tool execute.
 *
 * Real ChatAttachmentsService over a tmpdir vault; no DB (the tool never touches
 * scopedDb — vault ownership is structural via ctx.actorUserId). Proves the three
 * result shapes: image → data WITHOUT bytes + `media` payload (the gateway forwards
 * media over MCP stdio, bypassing renderAndCap), text → extracted text inline, and
 * unknown/foreign id → soft "Attachment not found" data error.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import { VaultContextRunner } from "@jarv1s/vault";

import { chatReadAttachmentExecute } from "../../packages/chat/src/attachment-tool.js";
import { ChatAttachmentsService } from "../../packages/chat/src/attachments-service.js";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-body")
]);

const scopedDb = null as unknown as DataContextDb;

describe("chat.readAttachment execute (#1133)", () => {
  let vaultBase: string;
  let service: ChatAttachmentsService;
  const actorUserId = randomUUID();
  const ctx = { actorUserId, requestId: randomUUID(), chatSessionId: "" };

  beforeAll(async () => {
    vaultBase = await mkdtemp(join(tmpdir(), "jarvis-attach-tool-"));
    service = new ChatAttachmentsService(new VaultContextRunner(vaultBase));
  });

  afterAll(async () => {
    await rm(vaultBase, { recursive: true, force: true });
  });

  const services = () => ({ chatAttachments: service });

  it("throws when the service is not wired (gateway reports generic tool failure)", async () => {
    await expect(
      chatReadAttachmentExecute(scopedDb, { attachmentId: randomUUID() }, ctx, {})
    ).rejects.toThrow("chat attachments service unavailable");
  });

  it("returns a soft not-found error for an unknown id", async () => {
    const result = await chatReadAttachmentExecute(
      scopedDb,
      { attachmentId: randomUUID() },
      ctx,
      services()
    );
    expect(result.data).toEqual({ error: "Attachment not found" });
  });

  it("cannot read another user's attachment (structural vault ownership)", async () => {
    const meta = await service.saveAttachment(
      { actorUserId: randomUUID(), requestId: randomUUID() },
      { fileName: "theirs.png", mimeType: "image/png", bytes: PNG_BYTES }
    );
    const result = await chatReadAttachmentExecute(
      scopedDb,
      { attachmentId: meta.id },
      ctx,
      services()
    );
    expect(result.data).toEqual({ error: "Attachment not found" });
  });

  it("returns images as media with metadata-only data", async () => {
    const meta = await service.saveAttachment(
      { actorUserId, requestId: randomUUID() },
      { fileName: "shot.png", mimeType: "image/png", bytes: PNG_BYTES }
    );
    const result = await chatReadAttachmentExecute(
      scopedDb,
      { attachmentId: meta.id },
      ctx,
      services()
    );
    expect(result.data).toEqual({ fileName: "shot.png", mimeType: "image/png" });
    expect(result.media).toEqual({
      kind: "image",
      base64: PNG_BYTES.toString("base64"),
      mimeType: "image/png"
    });
  });

  it("returns text files as inline extracted text with no media", async () => {
    const meta = await service.saveAttachment(
      { actorUserId, requestId: randomUUID() },
      { fileName: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("hello attachment") }
    );
    const result = await chatReadAttachmentExecute(
      scopedDb,
      { attachmentId: meta.id },
      ctx,
      services()
    );
    expect(result.data).toEqual({
      fileName: "notes.txt",
      mimeType: "text/plain",
      text: "hello attachment"
    });
    expect(result.media).toBeUndefined();
  });
});
