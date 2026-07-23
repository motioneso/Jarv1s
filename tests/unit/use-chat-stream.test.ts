import { describe, expect, it } from "vitest";
import {
  parseRecord,
  shouldEndPrivateChatOnStreamDisconnect
} from "../../apps/web/src/chat/use-chat-stream.js";

describe("parseRecord", () => {
  it("parses a plain reply record", () => {
    expect(parseRecord(JSON.stringify({ kind: "reply", text: "Hello" }))).toMatchObject({
      kind: "reply",
      text: "Hello"
    });
  });

  it("parses an action_request record with all optional fields", () => {
    const data = JSON.stringify({
      kind: "action_request",
      text: "Approve or deny: Write 'x'",
      actionRequestId: "ar_42",
      toolName: "example.write",
      summary: "Write 'x'"
    });
    const record = parseRecord(data);
    expect(record?.kind).toBe("action_request");
    expect(record?.actionRequestId).toBe("ar_42");
    expect(record?.toolName).toBe("example.write");
    expect(record?.summary).toBe("Write 'x'");
  });

  it("parses an action_result record with outcome", () => {
    const data = JSON.stringify({
      kind: "action_result",
      text: "Executed: example.write",
      actionRequestId: "ar_42",
      toolName: "example.write",
      outcome: "executed"
    });
    const record = parseRecord(data);
    expect(record?.outcome).toBe("executed");
  });

  it("parses a structured module result on an action_result record", () => {
    const record = parseRecord(
      JSON.stringify({
        kind: "action_result",
        text: "Executed: job-search.resume.critique",
        toolName: "job-search.resume.critique",
        outcome: "executed",
        result: { status: "ok", revisionId: "review-1" }
      })
    );
    expect(record?.result).toEqual({ status: "ok", revisionId: "review-1" });
  });

  it("returns null for non-JSON", () => {
    expect(parseRecord("not-json")).toBeNull();
  });

  it("returns null for records with an unknown kind", () => {
    expect(parseRecord(JSON.stringify({ kind: "foreign_kind", text: "Hello" }))).toBeNull();
  });

  it("strips unknown outcome values", () => {
    const data = JSON.stringify({ kind: "action_result", text: "x", outcome: "unknown-value" });
    const record = parseRecord(data);
    expect(record?.outcome).toBeUndefined();
  });
});

describe("shouldEndPrivateChatOnStreamDisconnect", () => {
  it("marks an active private transcript ended when the SSE stream disconnects", () => {
    expect(
      shouldEndPrivateChatOnStreamDisconnect({
        privateMode: true,
        privateEnded: false,
        streamErrorCount: 1
      })
    ).toBe(true);
  });

  it("does not mark ordinary chats ended", () => {
    expect(
      shouldEndPrivateChatOnStreamDisconnect({
        privateMode: false,
        privateEnded: false,
        streamErrorCount: 1
      })
    ).toBe(false);
  });

  it("marks an empty private transcript ended after stream failure", () => {
    expect(
      shouldEndPrivateChatOnStreamDisconnect({
        privateMode: true,
        privateEnded: false,
        streamErrorCount: 1
      })
    ).toBe(true);
  });
});
