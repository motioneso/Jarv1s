import { describe, expect, it } from "vitest";
import type { TranscriptRecord, EngineLaunchOpts } from "../../packages/chat/src/live/types.js";

describe("TranscriptRecord action kinds", () => {
  it("accepts action_request kind with optional fields", () => {
    const r: TranscriptRecord = {
      kind: "action_request",
      text: "Approve or deny: Write the value 'hello'",
      actionRequestId: "ar_1",
      toolName: "example.write",
      summary: "Write the value 'hello'"
    };
    expect(r.kind).toBe("action_request");
    expect(r.actionRequestId).toBe("ar_1");
  });

  it("accepts action_result kind with outcome", () => {
    const r: TranscriptRecord = {
      kind: "action_result",
      text: "Executed: example.write",
      actionRequestId: "ar_1",
      toolName: "example.write",
      outcome: "executed"
    };
    expect(r.outcome).toBe("executed");
  });

  it("accepts EngineLaunchOpts with mcp fields", () => {
    const opts: EngineLaunchOpts = {
      neutralDir: "/tmp/test",
      personaPath: "/tmp/p.txt",
      mcpToken: "jst_abc123",
      mcpServerUrl: "http://127.0.0.1:3000/api/mcp"
    };
    expect(opts.mcpToken).toBe("jst_abc123");
  });
});
