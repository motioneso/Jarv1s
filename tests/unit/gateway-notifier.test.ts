import { describe, expect, it, vi } from "vitest";
import { ChatGatewayNotifier } from "../../packages/chat/src/gateway-notifier.js";
import type { ChatSessionManager } from "../../packages/chat/src/live/chat-session-manager.js";
import { surfaceSessionKey } from "../../packages/chat/src/live/chat-surface.js";
import type { TranscriptRecord } from "../../packages/chat/src/live/types.js";

const makeManager = () =>
  ({
    injectRecord: vi.fn()
  }) as unknown as ChatSessionManager;

describe("ChatGatewayNotifier", () => {
  it("routes composite session ids to their actor and surface", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit(surfaceSessionKey("u:1", "job-search"), {
      kind: "action_request",
      actionRequestId: "ar_surface",
      toolName: "example.read",
      summary: "Read the value"
    });

    expect(manager.injectRecord).toHaveBeenCalledWith(
      "u:1",
      expect.objectContaining({ actionRequestId: "ar_surface" }),
      "job-search"
    );
  });

  it("converts action_request and fans out to manager.injectRecord", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_request",
      actionRequestId: "ar_1",
      toolName: "example.write",
      summary: "Write the value 'hello'"
    });

    expect(manager.injectRecord).toHaveBeenCalledOnce();
    const call0 = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    const [actorUserId, record] = call0;
    expect(actorUserId).toBe("u1");
    expect(record.kind).toBe("action_request");
    expect(record.actionRequestId).toBe("ar_1");
    expect(record.toolName).toBe("example.write");
    expect(record.summary).toBe("Write the value 'hello'");
  });

  it("threads an optional preview through to the transcript record", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_request",
      actionRequestId: "ar_2",
      toolName: "email.draftReply",
      summary: "Draft a reply",
      preview: { to: "alice@example.test", subject: "Re: lunch", body: "See you at noon." }
    });

    const [, record] = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    expect(record.preview).toEqual({
      to: "alice@example.test",
      subject: "Re: lunch",
      body: "See you at noon."
    });
  });

  it("omits preview when the action_request carries none", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_request",
      actionRequestId: "ar_3",
      toolName: "example.write",
      summary: "Write the value 'hello'"
    });

    const [, record] = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    expect(record.preview).toBeUndefined();
  });

  it("converts action_result with outcome", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "example.write",
      outcome: "executed"
    });

    const [, record] = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    expect(record.kind).toBe("action_result");
    expect(record.outcome).toBe("executed");
    expect(record.actionRequestId).toBe("ar_1");
  });

  it("renders an allowed outcome as 'Allowed by YOLO'", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "Read",
      outcome: "allowed"
    });

    const [, record] = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    expect(record.outcome).toBe("allowed");
    expect(record.text).toContain("Allowed by YOLO");
  });

  it("still renders denied outcomes unchanged", () => {
    const manager = makeManager();
    const notifier = new ChatGatewayNotifier(manager);

    notifier.emit("u1", {
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "example.write",
      outcome: "denied"
    });

    const [, record] = (manager.injectRecord as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      TranscriptRecord
    ];
    expect(record.text).toContain("Denied");
  });
});
