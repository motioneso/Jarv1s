import { describe, it, expect, vi } from "vitest";
import {
  selfHealGrantedAtInstallTier,
  type SelfOperationManifestInput
} from "../../packages/ai/src/gateway/self-operation.js";
import type { AiRepository } from "../../packages/ai/src/repository.js";
import type { DataContextDb } from "@jarv1s/db";
import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

function tool(
  overrides: Partial<ModuleAssistantToolManifest> = {}
): ModuleAssistantToolManifest {
  return {
    name: "mock.tool",
    description: "Mock tool",
    permissionId: "mock.perm",
    risk: "write",
    executionPolicy: "auto",
    inputSchema: {},
    outputSchema: {},
    execute: async () => ({ data: {} }),
    ...overrides
  };
}

const scopedDb = {} as DataContextDb;

describe("selfHealGrantedAtInstallTier", () => {
  it("heals a granted_at_install family with no stored policy to trusted_auto", async () => {
    const insertActionPolicyIfAbsent = vi.fn().mockResolvedValue(true);
    const listActionPolicies = vi
      .fn()
      .mockResolvedValue([{ moduleId: "mod", actionFamilyId: "fam", tier: "trusted_auto" }]);
    const repository = {
      insertActionPolicyIfAbsent,
      listActionPolicies
    } as unknown as Pick<AiRepository, "listActionPolicies" | "insertActionPolicyIfAbsent">;

    const manifest: SelfOperationManifestInput = {
      id: "mod",
      assistantTools: [tool({ selfOperationGrant: "granted_at_install", actionFamilyId: "fam" })]
    };

    const tier = await selfHealGrantedAtInstallTier(scopedDb, repository, manifest, "fam");

    expect(tier).toBe("trusted_auto");
    expect(insertActionPolicyIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("does not heal confirm_always or user_promotable families", async () => {
    const insertActionPolicyIfAbsent = vi.fn().mockResolvedValue(true);
    const listActionPolicies = vi.fn().mockResolvedValue([]);
    const repository = {
      insertActionPolicyIfAbsent,
      listActionPolicies
    } as unknown as Pick<AiRepository, "listActionPolicies" | "insertActionPolicyIfAbsent">;

    const manifest: SelfOperationManifestInput = {
      id: "mod",
      assistantTools: [
        tool({ selfOperationGrant: "confirm_always", actionFamilyId: "confirm-fam" }),
        tool({ selfOperationGrant: "user_promotable", actionFamilyId: "promotable-fam" })
      ]
    };

    const confirmTier = await selfHealGrantedAtInstallTier(
      scopedDb,
      repository,
      manifest,
      "confirm-fam"
    );
    const promotableTier = await selfHealGrantedAtInstallTier(
      scopedDb,
      repository,
      manifest,
      "promotable-fam"
    );

    expect(confirmTier).toBeNull();
    expect(promotableTier).toBeNull();
    expect(insertActionPolicyIfAbsent).not.toHaveBeenCalled();
  });

  it("fails closed when the grant insert throws", async () => {
    const insertActionPolicyIfAbsent = vi.fn().mockRejectedValue(new Error("db down"));
    const listActionPolicies = vi.fn().mockResolvedValue([]);
    const repository = {
      insertActionPolicyIfAbsent,
      listActionPolicies
    } as unknown as Pick<AiRepository, "listActionPolicies" | "insertActionPolicyIfAbsent">;

    const manifest: SelfOperationManifestInput = {
      id: "mod",
      assistantTools: [tool({ selfOperationGrant: "granted_at_install", actionFamilyId: "fam" })]
    };

    const tier = await selfHealGrantedAtInstallTier(scopedDb, repository, manifest, "fam");

    expect(tier).toBeNull();
  });
});
