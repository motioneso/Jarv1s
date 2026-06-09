import { describe, expect, it } from "vitest";
import { gatewayResponseToMcp } from "../../packages/chat/src/mcp-transport.js";
import type { GatewayToolResponse } from "@jarv1s/ai";

describe("gatewayResponseToMcp", () => {
  it("maps ok=true response to non-error content", () => {
    const res: GatewayToolResponse = { ok: true, data: { result: "hello" } };
    const mcp = gatewayResponseToMcp(res);
    expect(mcp.isError).toBe(false);
    expect(mcp.content[0]!.text).toBe(JSON.stringify({ result: "hello" }));
  });

  it("maps denied response to isError=true with reason", () => {
    const res: GatewayToolResponse = { ok: false, denied: true, reason: "Denied by user." };
    const mcp = gatewayResponseToMcp(res);
    expect(mcp.isError).toBe(true);
    expect(mcp.content[0]!.text).toBe("Denied by user.");
  });

  it("maps error response to isError=true with error message", () => {
    const res: GatewayToolResponse = { ok: false, error: "Tool failed" };
    const mcp = gatewayResponseToMcp(res);
    expect(mcp.isError).toBe(true);
    expect(mcp.content[0]!.text).toBe("Tool failed");
  });
});
