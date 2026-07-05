import { describe, it, expect } from "vitest";
import { resolvePolicy, type ActionPolicyLookup } from "../../packages/ai/src/gateway/policy.js";
import type {
  ModuleAssistantToolManifest,
  ModuleAssistantActionFamilyManifest,
  JarvisActionPermissionTier
} from "../../packages/module-sdk/src/index.js";

describe("gateway policy resolver", () => {
  const createMockLookup = (
    tier: JarvisActionPermissionTier | null,
    manifest: ModuleAssistantActionFamilyManifest | null
  ): ActionPolicyLookup => ({
    getFamilyTier: async () => tier,
    getFamilyManifest: async () => manifest
  });

  const baseManifest: ModuleAssistantActionFamilyManifest = {
    id: "mock_family",
    label: "Mock Family",
    description: "Mock Family Description",
    defaultTier: "ask_each_time",
    allowedTiers: ["ask_each_time", "always_confirm"]
  };

  it("family-less write:auto tool returns confirm", async () => {
    const tool: ModuleAssistantToolManifest = {
      name: "mock.tool",
      description: "Mock tool",
      permissionId: "mock.perm",
      risk: "write",
      executionPolicy: "auto",
      inputSchema: {},
      outputSchema: {},
      execute: async () => ({ data: {} })
    };

    // No familyId set
    const decision = await resolvePolicy(tool, "mock_module", {}, createMockLookup(null, null));
    expect(decision).toBe("confirm");
  });

  it("trusted_auto tier confirms if tool executionPolicy is not auto", async () => {
    const tool: ModuleAssistantToolManifest = {
      name: "mock.tool",
      description: "Mock tool",
      permissionId: "mock.perm",
      actionFamilyId: "mock_family",
      risk: "write",
      executionPolicy: "confirm", // Not auto
      inputSchema: {},
      outputSchema: {},
      execute: async () => ({ data: {} })
    };

    const manifest: ModuleAssistantActionFamilyManifest = {
      ...baseManifest,
      allowedTiers: ["ask_each_time", "trusted_auto"]
    };

    const decision = await resolvePolicy(
      tool,
      "mock_module",
      {},
      createMockLookup("trusted_auto", manifest)
    );
    expect(decision).toBe("confirm");
  });

  it("trusted_auto tier confirms if manifest does not allow trusted_auto", async () => {
    const tool: ModuleAssistantToolManifest = {
      name: "mock.tool",
      description: "Mock tool",
      permissionId: "mock.perm",
      actionFamilyId: "mock_family",
      risk: "write",
      executionPolicy: "auto",
      inputSchema: {},
      outputSchema: {},
      execute: async () => ({ data: {} })
    };

    const manifest: ModuleAssistantActionFamilyManifest = {
      ...baseManifest,
      allowedTiers: ["ask_each_time", "always_confirm"] // Does not allow trusted_auto
    };

    const decision = await resolvePolicy(
      tool,
      "mock_module",
      {},
      createMockLookup("trusted_auto", manifest)
    );
    expect(decision).toBe("confirm");
  });

  it("trusted_auto tier runs if executionPolicy is auto and manifest allows trusted_auto", async () => {
    const tool: ModuleAssistantToolManifest = {
      name: "mock.tool",
      description: "Mock tool",
      permissionId: "mock.perm",
      actionFamilyId: "mock_family",
      risk: "write",
      executionPolicy: "auto",
      inputSchema: {},
      outputSchema: {},
      execute: async () => ({ data: {} })
    };

    const manifest: ModuleAssistantActionFamilyManifest = {
      ...baseManifest,
      allowedTiers: ["ask_each_time", "trusted_auto"]
    };

    const decision = await resolvePolicy(
      tool,
      "mock_module",
      {},
      createMockLookup("trusted_auto", manifest)
    );
    expect(decision).toBe("run");
  });

  it("requiresConfirmation overrides trusted_auto for calls it flags as destructive", async () => {
    const tool: ModuleAssistantToolManifest = {
      name: "mock.tool",
      description: "Mock tool",
      permissionId: "mock.perm",
      actionFamilyId: "mock_family",
      risk: "write",
      executionPolicy: "auto",
      inputSchema: {},
      outputSchema: {},
      execute: async () => ({ data: {} }),
      requiresConfirmation: (input) => input["overwrite"] === true
    };

    const manifest: ModuleAssistantActionFamilyManifest = {
      ...baseManifest,
      allowedTiers: ["ask_each_time", "trusted_auto"]
    };
    const lookup = createMockLookup("trusted_auto", manifest);

    // Ordinary call: still auto-runs under trusted_auto.
    await expect(resolvePolicy(tool, "mock_module", {}, lookup)).resolves.toBe("run");

    // Flagged call: forced to confirm even though the family is trusted_auto and the tool's
    // own executionPolicy is "auto".
    await expect(resolvePolicy(tool, "mock_module", { overwrite: true }, lookup)).resolves.toBe(
      "confirm"
    );
  });
});
