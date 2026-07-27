import { describe, expect, it } from "vitest";

import {
  assertBuiltInSelfOperationManifests,
  BUILT_IN_SELF_OPERATION_SCOPE_NOTE,
  SELF_OPERATION_EXCLUSIONS,
  type SelfOperationManifestInput
} from "@jarv1s/ai";
import type { ModuleAssistantActionFamilyManifest, ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

function family(
  id: string,
  allowedTiers: ModuleAssistantActionFamilyManifest["allowedTiers"]
): ModuleAssistantActionFamilyManifest {
  return { id, label: id, description: id, defaultTier: "ask_each_time", allowedTiers };
}

function manifest(
  id: string,
  assistantTools: readonly ModuleAssistantToolManifest[],
  assistantActionFamilies: readonly ModuleAssistantActionFamilyManifest[] = []
): SelfOperationManifestInput {
  return { id, assistantTools, assistantActionFamilies };
}

describe("self-operation chassis", () => {
  it("rejects an unclassified built-in write tool", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.updateSomething",
      description: "Update something.",
      permissionId: "memory.manage",
      risk: "write"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [tool])])).toThrow();
  });

  it("rejects a built-in module override of a central exclusion", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "settings.yolo.enable",
      description: "Enable YOLO mode.",
      permissionId: "settings.manage",
      risk: "write",
      executionPolicy: "auto",
      selfOperationGrant: "granted_at_install"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("settings", [tool])])).toThrow();
  });

  it("rejects generic preference-key inputs on built-in tools", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.forget",
      description: "Forget a fact.",
      permissionId: "memory.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always",
      inputSchema: { type: "object", properties: { preferenceKey: { type: "string" } } }
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [tool])])).toThrow();
  });

  it("covers all seven immutable built-in exclusion categories", () => {
    const categories = new Set(SELF_OPERATION_EXCLUSIONS.map((rule) => rule.category));
    expect(categories).toEqual(
      new Set([
        "self_authority",
        "prompt_shaping",
        "secrets",
        "identity_auth_registration",
        "data_scope_consent",
        "assistant_brain",
        "external_effect"
      ])
    );
  });

  it("rejects built-in granted_at_install without write auto execution", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.destroyEverything",
      description: "Destroy everything.",
      permissionId: "memory.manage",
      risk: "destructive",
      selfOperationGrant: "granted_at_install"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [tool])])).toThrow();
  });

  it("rejects built-in granted_at_install without a resolvable trusted family", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.autoOperate",
      description: "Auto-operate.",
      permissionId: "memory.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "memory.untrustedFamily",
      selfOperationGrant: "granted_at_install"
    };
    const untrustedFamily = family("memory.untrustedFamily", ["ask_each_time"]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("memory", [tool], [untrustedFamily])])
    ).toThrow();
  });

  it("requires always_confirm in every referenced built-in family", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.forget",
      description: "Forget a fact.",
      permissionId: "memory.manage",
      risk: "destructive",
      actionFamilyId: "memory.noConfirmFamily",
      selfOperationGrant: "confirm_always"
    };
    const noConfirmFamily = family("memory.noConfirmFamily", ["ask_each_time", "trusted_auto"]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("memory", [tool], [noConfirmFamily])])
    ).toThrow();
  });

  it("allows only the four planned built-in confirm_always tools", () => {
    const memoryForget: ModuleAssistantToolManifest = {
      name: "memory.forget",
      description: "Forget a fact.",
      permissionId: "memory.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };
    const peopleMerge: ModuleAssistantToolManifest = {
      name: "people.merge",
      description: "Merge two identities.",
      permissionId: "people.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };
    const peopleSplitIdentity: ModuleAssistantToolManifest = {
      name: "people.splitIdentity",
      description: "Split an identity.",
      permissionId: "people.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };
    const emailSendReply: ModuleAssistantToolManifest = {
      name: "email.sendReply",
      description: "Send a reply.",
      permissionId: "email.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };
    expect(() =>
      assertBuiltInSelfOperationManifests([
        manifest("memory", [memoryForget]),
        manifest("people", [peopleMerge, peopleSplitIdentity]),
        manifest("email", [emailSendReply])
      ])
    ).not.toThrow();

    const disallowed: ModuleAssistantToolManifest = {
      name: "memory.wipeAll",
      description: "Wipe all memory.",
      permissionId: "memory.manage",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [disallowed])])).toThrow();
  });

  it("accepts built-in read tools without a declaration", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "memory.search",
      description: "Search memory.",
      permissionId: "memory.view",
      risk: "read"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [tool])])).not.toThrow();
  });

  it("documents built-in-only coverage with external modules deferred to #1267", () => {
    expect(BUILT_IN_SELF_OPERATION_SCOPE_NOTE).toContain("#1267");
    expect(BUILT_IN_SELF_OPERATION_SCOPE_NOTE).toContain("actionFamilyId");
  });
});
