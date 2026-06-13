import { describe, expect, it } from "vitest";
import type { ToolExecute, ToolServices, ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

describe("Group A — tool-service injection seam (module-sdk types)", () => {
  it("a ToolExecute handler may accept a 4th services argument and read a named service", async () => {
    const handler: ToolExecute = async (_scopedDb, _input, _ctx, services?: ToolServices) => {
      const svc = (services ?? {}).demo as { ping: () => string } | undefined;
      return { data: { value: svc ? svc.ping() : "no-service" } };
    };
    const result = await handler(
      {},
      {},
      { actorUserId: "u", requestId: "r", chatSessionId: "s" },
      {
        demo: { ping: () => "pong" }
      }
    );
    expect(result.data.value).toBe("pong");
  });

  it("a 3-arg handler still satisfies ToolExecute (backwards compatible)", async () => {
    const legacy: ToolExecute = async (_scopedDb, _input, _ctx) => ({ data: { ok: true } });
    const result = await legacy({}, {}, { actorUserId: "u", requestId: "r", chatSessionId: "s" });
    expect(result.data.ok).toBe(true);
  });

  it("ModuleAssistantToolManifest accepts an optional requiresServices array", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "demo.tool",
      description: "demo",
      permissionId: "demo.manage",
      risk: "write",
      requiresServices: ["demo"]
    };
    expect(tool.requiresServices).toEqual(["demo"]);
  });
});
