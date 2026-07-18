/**
 * #1133 — POST /api/chat/turn attachment wiring.
 *
 * Exercises the real live-routes /turn handler against a real ChatAttachmentsService
 * over a tmpdir vault (no DB — the runtime/persistence side is a recording stub,
 * mirroring route-local-rate-limit.test.ts). Proves the validation gates fire BEFORE
 * any engine work: id shape, count cap, existence, incognito, missing service — and
 * that a valid turn hands resolved metadata to submitTurn and stamps sentAt.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { VaultContextRunner } from "@jarv1s/vault";
import type { AccessContext } from "@jarv1s/db";

import { registerChatLiveRoutes } from "../../packages/chat/src/live-routes.js";
import {
  ChatAttachmentsService,
  type StoredAttachmentMeta
} from "../../packages/chat/src/attachments-service.js";
import { PageContextStore } from "../../packages/chat/src/live/page-context-store.js";
import { readAttachments } from "../../packages/chat/src/attachments-routes.js";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-body")
]);

describe("POST /api/chat/turn with attachmentIds (#1133)", () => {
  let app: FastifyInstance;
  let appWithoutService: FastifyInstance;
  let vaultBase: string;
  let service: ChatAttachmentsService;
  const actorUserId = randomUUID();
  const access: AccessContext = { actorUserId, requestId: randomUUID() };

  let incognito = false;
  let submitted: Array<{
    text: string;
    attachments: readonly StoredAttachmentMeta[] | undefined;
  }> = [];

  const stubRuntime = {
    manager: {
      submitTurn: async (
        _actor: string,
        _userName: string,
        text: string,
        opts?: { readonly attachments?: readonly StoredAttachmentMeta[] }
      ) => {
        submitted.push({ text, attachments: opts?.attachments });
        return { reply: "ok" };
      },
      getPrivacyState: async () => ({ incognito }),
      clear: async () => undefined,
      switchProvider: async () => undefined
    },
    resolveUserName: async () => "Tester"
  };

  beforeAll(async () => {
    vaultBase = await mkdtemp(join(tmpdir(), "jarvis-attach-turn-"));
    service = new ChatAttachmentsService(new VaultContextRunner(vaultBase));

    const resolveAccessContext = async (): Promise<AccessContext> => access;
    app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });
    registerChatLiveRoutes(app, {
      resolveAccessContext,
      runtime: stubRuntime as never,
      pageContextStore: new PageContextStore({ now: () => Date.now(), ttlMs: 300_000 }),
      attachmentsService: service
    });
    await app.ready();

    // A second app with NO attachments service — deployments predating the wiring
    // must reject attachment turns instead of silently dropping the files.
    appWithoutService = Fastify({ logger: false });
    await appWithoutService.register(rateLimit, { global: false });
    registerChatLiveRoutes(appWithoutService, {
      resolveAccessContext,
      runtime: stubRuntime as never,
      pageContextStore: new PageContextStore({ now: () => Date.now(), ttlMs: 300_000 })
    });
    await appWithoutService.ready();
  });

  afterAll(async () => {
    await app.close();
    await appWithoutService.close();
    await rm(vaultBase, { recursive: true, force: true });
  });

  beforeEach(() => {
    incognito = false;
    submitted = [];
  });

  function postTurn(target: FastifyInstance, payload: Record<string, unknown>) {
    return target.inject({ method: "POST", url: "/api/chat/turn", payload });
  }

  async function saveFixture(): Promise<StoredAttachmentMeta> {
    return service.saveAttachment(access, {
      fileName: "shot.png",
      mimeType: "image/png",
      bytes: PNG_BYTES
    });
  }

  it("rejects a non-array attachmentIds", async () => {
    const res = await postTurn(app, { text: "hi", attachmentIds: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("attachmentIds must be an array");
    expect(submitted).toHaveLength(0);
  });

  it("rejects more than the per-turn cap", async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    const res = await postTurn(app, { text: "hi", attachmentIds: ids });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("5 entries or fewer");
  });

  it("rejects non-UUID ids before any vault access", async () => {
    const res = await postTurn(app, { text: "hi", attachmentIds: ["../../etc/passwd"] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("attachmentIds must contain valid attachment ids");
  });

  it("rejects an id that does not resolve in the caller's vault", async () => {
    const res = await postTurn(app, { text: "hi", attachmentIds: [randomUUID()] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Attachment not found");
    expect(submitted).toHaveLength(0);
  });

  it("rejects attachments while the chat is private/incognito", async () => {
    const meta = await saveFixture();
    incognito = true;
    const res = await postTurn(app, { text: "hi", attachmentIds: [meta.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("private chat");
    expect(submitted).toHaveLength(0);
  });

  it("rejects attachment turns when no service is wired", async () => {
    const meta = await saveFixture();
    const res = await postTurn(appWithoutService, { text: "hi", attachmentIds: [meta.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Attachments are not available.");
  });

  it("still requires text when there are no attachments", async () => {
    const empty = await postTurn(app, { text: "   " });
    expect(empty.statusCode).toBe(400);
    const emptyWithList = await postTurn(app, { text: "", attachmentIds: [] });
    expect(emptyWithList.statusCode).toBe(400);
  });

  it("passes resolved metadata to submitTurn and stamps sentAt", async () => {
    const meta = await saveFixture();
    const res = await postTurn(app, { text: "look at this", attachmentIds: [meta.id] });
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toBe("ok");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.text).toBe("look at this");
    expect(submitted[0]?.attachments?.map((m) => m.id)).toEqual([meta.id]);
    const after = await service.getMeta(access, meta.id);
    expect(after?.sentAt).toBeDefined();
  });

  it("allows an attachment-only turn with no text", async () => {
    const meta = await saveFixture();
    const res = await postTurn(app, { attachmentIds: [meta.id] });
    expect(res.statusCode).toBe(200);
    expect(submitted[0]?.text).toBe("");
    expect(submitted[0]?.attachments).toHaveLength(1);
  });

  it("dedupes a repeated id so the manifest cannot double-render", async () => {
    const meta = await saveFixture();
    const res = await postTurn(app, { text: "twice", attachmentIds: [meta.id, meta.id] });
    expect(res.statusCode).toBe(200);
    expect(submitted[0]?.attachments).toHaveLength(1);
  });
});

describe("readAttachments tool_metadata shape-checker (#1133)", () => {
  it("returns undefined for absent or junk values", () => {
    expect(readAttachments(undefined)).toBeUndefined();
    expect(readAttachments("x")).toBeUndefined();
    expect(readAttachments([])).toBeUndefined();
  });

  it("filters malformed entries and keeps valid ones", () => {
    const good = { id: "a", fileName: "f.txt", mimeType: "text/plain", sizeBytes: 3 };
    expect(readAttachments([good, { id: 1 }, null])).toEqual([good]);
  });
});
