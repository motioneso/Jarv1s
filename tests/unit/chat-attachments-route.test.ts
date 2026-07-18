import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultContextRunner } from "@jarv1s/vault";
import { registerChatAttachmentRoutes } from "../../packages/chat/src/attachments-routes.js";
import {
  ChatAttachmentsService,
  MAX_IMAGE_ATTACHMENT_BYTES
} from "../../packages/chat/src/attachments-service.js";

// #1133 — upload route protocol tests: raw octet-stream body + x-jarvis-* headers.
// Uses a real service over a tmpdir vault base; no DB involved.

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-body")
]);

describe("POST /api/chat/attachments (#1133)", () => {
  let app: FastifyInstance;
  let vaultBase: string;
  let service: ChatAttachmentsService;
  const actorUserId = randomUUID();
  let authorized = true;

  beforeAll(async () => {
    vaultBase = await mkdtemp(join(tmpdir(), "jarvis-attach-route-"));
    service = new ChatAttachmentsService(new VaultContextRunner(vaultBase));
    app = Fastify({ logger: false });
    registerChatAttachmentRoutes(app, {
      resolveAccessContext: async () => {
        if (!authorized) throw new Error("no session");
        return { actorUserId, requestId: randomUUID() };
      },
      attachmentsService: service
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(vaultBase, { recursive: true, force: true });
  });

  function upload(opts: {
    body?: Buffer;
    mime?: string;
    fileName?: string;
    contentType?: string;
  }) {
    const headers: Record<string, string> = {
      "content-type": opts.contentType ?? "application/octet-stream"
    };
    if (opts.mime !== undefined) headers["x-jarvis-mime-type"] = opts.mime;
    if (opts.fileName !== undefined) headers["x-jarvis-file-name"] = opts.fileName;
    return app.inject({
      method: "POST",
      url: "/api/chat/attachments",
      headers,
      body: opts.body ?? PNG_BYTES
    });
  }

  it("stores a valid upload and returns 201 with the wire DTO", async () => {
    const res = await upload({
      mime: "image/png",
      fileName: encodeURIComponent("스크린샷 1.png")
    });
    expect(res.statusCode).toBe(201);
    const { attachment } = res.json();
    // Wire DTO carries exactly the fields the client renders — no lifecycle fields.
    expect(Object.keys(attachment).sort()).toEqual(["fileName", "id", "mimeType", "sizeBytes"]);
    expect(attachment.fileName).toBe("스크린샷 1.png");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.sizeBytes).toBe(PNG_BYTES.length);

    const content = await service.readContent(
      { actorUserId, requestId: randomUUID() },
      attachment.id
    );
    expect(content.kind).toBe("image");
  });

  it("returns 401 when the session cannot be resolved", async () => {
    authorized = false;
    try {
      const res = await upload({ mime: "image/png", fileName: "a.png" });
      expect(res.statusCode).toBe(401);
    } finally {
      authorized = true;
    }
  });

  it("returns 400 for missing headers and malformed percent-encoding", async () => {
    expect((await upload({ fileName: "a.png" })).statusCode).toBe(400);
    expect((await upload({ mime: "image/png" })).statusCode).toBe(400);
    expect((await upload({ mime: "image/png", fileName: "%E0%A4%A" })).statusCode).toBe(400);
  });

  it("returns 415 for non-whitelisted mime and sniff mismatch", async () => {
    const exe = await upload({ mime: "application/x-msdownload", fileName: "x.exe" });
    expect(exe.statusCode).toBe(415);
    const mislabeled = await upload({
      mime: "image/png",
      fileName: "fake.png",
      body: Buffer.from("not a png at all")
    });
    expect(mislabeled.statusCode).toBe(415);
  });

  it("returns 413 when the per-kind cap is exceeded", async () => {
    const res = await upload({
      mime: "image/png",
      fileName: "big.png",
      body: Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_ATTACHMENT_BYTES)])
    });
    expect(res.statusCode).toBe(413);
  });

  it("rejects bodies that are not octet-stream buffers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/attachments",
      headers: {
        "content-type": "application/json",
        "x-jarvis-mime-type": "text/plain",
        "x-jarvis-file-name": "a.txt"
      },
      body: JSON.stringify({ sneaky: true })
    });
    // JSON parser yields an object, not a Buffer — the route refuses it.
    expect(res.statusCode).toBe(400);
  });
});
