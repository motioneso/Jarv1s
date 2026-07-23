import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantSurface } from "../../apps/web/src/chat/assistant-surface/index.js";
import { createAssistantSurfaceHandle } from "../../apps/web/src/chat/assistant-surface/handle.js";

// React/web unit tests use .tsx so root NodeNext typecheck does not reinterpret Vite imports.
afterEach(() => vi.unstubAllGlobals());

describe("createAssistantSurfaceHandle", () => {
  it("binds seed, turn, upload, surface, and record subscription to host services", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat/module-onboarding")) {
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/chat/turn")) {
        return Response.json({ reply: "ok" });
      }
      if (url.endsWith("/api/chat/attachments")) {
        return Response.json({
          attachment: {
            id: "attachment-1",
            fileName: "resume.pdf",
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
    const handle = createAssistantSurfaceHandle("job-search", subscribeRecords);

    expect(handle.Surface).toBe(AssistantSurface);
    expect(handle.subscribeRecords).toBe(subscribeRecords);
    expect(handle.subscribeRecords(vi.fn())).toBe(unsubscribe);

    await expect(handle.seedOnboarding()).resolves.toEqual({ ok: true });
    await handle.submitTurn({
      text: "Use these titles",
      controlContext: {
        step: "profile",
        action: "save",
        values: { targetTitles: ["Staff Product Designer"] }
      },
      attachmentIds: ["attachment-1"]
    });
    await expect(
      handle.uploadAttachment(new File(["pdf"], "resume.pdf", { type: "application/pdf" }))
    ).resolves.toEqual({ id: "attachment-1", fileName: "resume.pdf", sizeBytes: 3 });

    const seedCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/chat/module-onboarding")
    );
    expect(seedCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ moduleId: "job-search" })
      })
    );
    const turnCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/chat/turn"));
    expect(turnCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Use these titles",
          controlContext: {
            step: "profile",
            action: "save",
            values: { targetTitles: ["Staff Product Designer"] }
          },
          attachmentIds: ["attachment-1"]
        })
      })
    );
  });

  it("binds module onboarding to its host-controlled chat surface", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/chat/module-onboarding")) return Response.json({ ok: true });
      return Response.json({ reply: "ok" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = vi.fn();
    const subscribeRecords = vi.fn(() => unsubscribe);
    const handle = createAssistantSurfaceHandle("job-search", subscribeRecords, "job-search");

    handle.subscribeRecords(vi.fn());
    await handle.seedOnboarding();
    await handle.submitTurn({ text: "hello" });

    expect(subscribeRecords).toHaveBeenCalledWith(expect.any(Function), "job-search");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/module-onboarding",
      expect.objectContaining({
        body: JSON.stringify({ moduleId: "job-search", surface: "job-search" })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/turn",
      expect.objectContaining({ body: JSON.stringify({ text: "hello", surface: "job-search" }) })
    );
  });
});
