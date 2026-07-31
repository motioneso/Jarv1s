import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantSurface } from "../../apps/web/src/chat/assistant-surface/index.js";
import { createAssistantSurfaceHandle } from "../../apps/web/src/chat/assistant-surface/handle.js";
import { moduleChatSurface } from "../../apps/web/src/shell/chat-surface-key.js";

// React/web unit tests use .tsx so root NodeNext typecheck does not reinterpret Vite imports.
afterEach(() => vi.unstubAllGlobals());

describe("createAssistantSurfaceHandle", () => {
  it("binds turn, upload, composer, and record subscription to host services", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat/turn")) {
        return Response.json({ reply: "ok" });
      }
      if (url.endsWith("/api/chat/attachments")) {
        return Response.json({
          attachment: {
            id: "attachment-1",
            fileName: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 3
          }
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = vi.fn();
    const subscribeRecords = vi.fn(() => unsubscribe);
    const seedComposer = vi.fn();
    const handle = createAssistantSurfaceHandle(subscribeRecords, undefined, seedComposer);

    expect(handle.Surface).toBe(AssistantSurface);
    expect(handle.subscribeRecords).toBe(subscribeRecords);
    expect(handle.subscribeRecords(vi.fn())).toBe(unsubscribe);
    handle.seedComposer("Please revise the summary");
    expect(seedComposer).toHaveBeenCalledWith("Please revise the summary");

    await handle.submitTurn({
      text: "Use these titles",
      controlContext: { step: "profile", action: "save" },
      attachmentIds: ["attachment-1"]
    });
    await expect(
      handle.uploadAttachment(new File(["pdf"], "report.pdf", { type: "application/pdf" }))
    ).resolves.toEqual({ id: "attachment-1", fileName: "report.pdf", sizeBytes: 3 });

    const turnCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/chat/turn"));
    expect(turnCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Use these titles",
          controlContext: { step: "profile", action: "save" },
          attachmentIds: ["attachment-1"]
        })
      })
    );
  });

  it("scopes turns and record subscription to its host-controlled chat surface", async () => {
    // #1284 — the module never names a surface directly: setSurfaceKey takes an opaque key, and
    // the handle derives the wire surface by combining it with the host-bound moduleId. Before any
    // setSurfaceKey call, the handle has no claimed surface at all (see the next test).
    const fetchMock = vi.fn(async () => Response.json({ reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = vi.fn();
    const subscribeRecords = vi.fn(() => unsubscribe);
    const handle = createAssistantSurfaceHandle(subscribeRecords, "demo-module");
    const expectedSurface = moduleChatSurface("demo-module", "profile-1");

    handle.setSurfaceKey("profile-1");
    handle.subscribeRecords(vi.fn());
    await handle.submitTurn({ text: "hello" });

    expect(subscribeRecords).toHaveBeenCalledWith(expect.any(Function), expectedSurface);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/turn",
      expect.objectContaining({
        body: JSON.stringify({ text: "hello", surface: expectedSurface })
      })
    );
  });

  it("releases its surface claim on setSurfaceKey(null)", async () => {
    // #1284 — this is the "reset to drawer" half of the contract: a module that had claimed a
    // surface and then releases it must fall back to the handle's unscoped (no-surface) behaviour,
    // exactly as if setSurfaceKey had never been called.
    const fetchMock = vi.fn(async () => Response.json({ reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const subscribeRecords = vi.fn(() => vi.fn());
    const handle = createAssistantSurfaceHandle(subscribeRecords, "demo-module");

    handle.setSurfaceKey("profile-1");
    handle.setSurfaceKey(null);
    await handle.submitTurn({ text: "hello" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/turn",
      expect.objectContaining({ body: JSON.stringify({ text: "hello" }) })
    );
  });
});
