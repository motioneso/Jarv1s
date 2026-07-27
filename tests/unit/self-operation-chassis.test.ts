import { describe, expect, it } from "vitest";

import {
  assertBuiltInSelfOperationManifests,
  BUILT_IN_SELF_OPERATION_SCOPE_NOTE,
  SELF_OPERATION_EXCLUSIONS,
  type SelfOperationManifestInput
} from "@jarv1s/ai";
import type {
  JarvisActionPermissionTier,
  ModuleAssistantActionFamilyManifest,
  ModuleAssistantToolManifest,
  ModuleAssistantToolSelfOperationGrant
} from "@jarv1s/module-sdk";

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

  it("rejects built-in user_promotable without write auto execution", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "destructive",
      actionFamilyId: "calendar.family",
      selfOperationGrant: "user_promotable"
    };
    const promotableFamily = family("calendar.family", [
      "ask_each_time",
      "trusted_auto",
      "always_confirm"
    ]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("calendar", [tool], [promotableFamily])])
    ).toThrow();
  });

  it("rejects built-in user_promotable without an actionFamilyId", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      selfOperationGrant: "user_promotable"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("calendar", [tool])])).toThrow();
  });

  it("rejects built-in user_promotable whose family cannot reach trusted_auto", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar.family",
      selfOperationGrant: "user_promotable"
    };
    const unpromotableFamily = family("calendar.family", ["ask_each_time", "always_confirm"]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("calendar", [tool], [unpromotableFamily])])
    ).toThrow();
  });

  it("rejects built-in user_promotable whose family cannot demand always_confirm back", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar.family",
      selfOperationGrant: "user_promotable"
    };
    const noConfirmBackFamily = family("calendar.family", ["ask_each_time", "trusted_auto"]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("calendar", [tool], [noConfirmBackFamily])])
    ).toThrow();
  });

  it("accepts a fully-wired built-in user_promotable tool", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar.family",
      selfOperationGrant: "user_promotable"
    };
    const promotableFamily = family("calendar.family", [
      "ask_each_time",
      "trusted_auto",
      "always_confirm"
    ]);
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("calendar", [tool], [promotableFamily])])
    ).not.toThrow();
  });

  it("rejects a built-in action family shared by a granted_at_install tool and a user_promotable tool", () => {
    // #1263 Task 4 hardening (a): if install granted trusted_auto for the same family a
    // user_promotable tool relies on the user to set, "user_promotable" would be a lie the moment
    // the granted_at_install tool's install grant ran first.
    const installTool: ModuleAssistantToolManifest = {
      name: "calendar.autoOperate",
      description: "Auto-operate.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar.sharedFamily",
      selfOperationGrant: "granted_at_install"
    };
    const promotableTool: ModuleAssistantToolManifest = {
      name: "calendar.deleteEvent",
      description: "Delete an event.",
      permissionId: "calendar.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "calendar.sharedFamily",
      selfOperationGrant: "user_promotable"
    };
    const sharedFamily = family("calendar.sharedFamily", [
      "ask_each_time",
      "trusted_auto",
      "always_confirm"
    ]);
    expect(() =>
      assertBuiltInSelfOperationManifests([
        manifest("calendar", [installTool, promotableTool], [sharedFamily])
      ])
    ).toThrow(
      'module "calendar" action family "calendar.sharedFamily" is referenced by both a ' +
        "granted_at_install tool and a user_promotable tool: install would silently promote the " +
        "tier the user_promotable tool relies on the user to set"
    );
  });

  it("rejects a built-in confirm_always tool that is promotable to trusted_auto", () => {
    // #1263 Task 4 hardening (b): structural, not risk-based — web.read is confirm_always at risk
    // "write" and must keep passing this check, so the invariant is "not promotable" (no auto
    // executionPolicy, and no family that can reach trusted_auto), never "implies risk destructive".
    const tool: ModuleAssistantToolManifest = {
      name: "memory.forget",
      description: "Forget a fact.",
      permissionId: "memory.manage",
      risk: "destructive",
      executionPolicy: "auto",
      selfOperationGrant: "confirm_always"
    };
    expect(() => assertBuiltInSelfOperationManifests([manifest("memory", [tool])])).toThrow(
      'module "memory" tool "memory.forget" declares confirm_always but is promotable to ' +
        'trusted_auto: remove executionPolicy "auto" and any actionFamilyId whose allowedTiers ' +
        "include trusted_auto"
    );
  });

  it("rejects a tool name declared by more than one built-in module", () => {
    // #1263 Task E NB-1: self-operation.ts:267 was shipped with zero negative tests. Two modules
    // declaring the same tool name is exactly what "tool names must be unique across all modules"
    // exists to catch -- without this test the guard could be deleted and nothing would fail.
    const toolA: ModuleAssistantToolManifest = {
      name: "shared.duplicateName",
      description: "Fixture.",
      permissionId: "memory.view",
      risk: "read"
    };
    const toolB: ModuleAssistantToolManifest = {
      name: "shared.duplicateName",
      description: "Fixture.",
      permissionId: "people.view",
      risk: "read"
    };
    expect(() =>
      assertBuiltInSelfOperationManifests([manifest("memory", [toolA]), manifest("people", [toolB])])
    ).toThrow(
      'tool name "shared.duplicateName" is declared by more than one built-in module (most ' +
        'recently "people"): tool names must be unique across all modules'
    );
  });

  it("rejects a granted_at_install tool whose family defaults to always_confirm", () => {
    // #1263 Task E NB-1: self-operation.ts:327 was shipped with zero negative tests. This is the
    // guard that stops install from silently widening a family the module itself gated at
    // always_confirm the moment the module installs.
    const alwaysConfirmDefaultFamily: ModuleAssistantActionFamilyManifest = {
      id: "memory.alwaysConfirmDefaultFamily",
      label: "memory.alwaysConfirmDefaultFamily",
      description: "memory.alwaysConfirmDefaultFamily",
      defaultTier: "always_confirm",
      allowedTiers: ["always_confirm", "trusted_auto"]
    };
    const tool: ModuleAssistantToolManifest = {
      name: "memory.autoOperate",
      description: "Auto-operate.",
      permissionId: "memory.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "memory.alwaysConfirmDefaultFamily",
      selfOperationGrant: "granted_at_install"
    };
    expect(() =>
      assertBuiltInSelfOperationManifests([
        manifest("memory", [tool], [alwaysConfirmDefaultFamily])
      ])
    ).toThrow(
      'module "memory" tool "memory.autoOperate" declares granted_at_install for action ' +
        'family "memory.alwaysConfirmDefaultFamily" whose defaultTier is "always_confirm": a ' +
        "granted_at_install family must not default to always_confirm"
    );
  });

  it("rejects the tasks module declaring a second granted_at_install family beyond task_changes", () => {
    // #1263 Task E NB-1: self-operation.ts:409 was shipped with zero negative tests, and per
    // Coordinator this is the sole guard on a full-bypass path -- packages/module-registry's tasks
    // wiring hardcodes writing only "task_changes" and never calls the generic grant path for tasks
    // at all, so a second granted_at_install family here would silently get no install-time grant.
    const taskChangesFamily: ModuleAssistantActionFamilyManifest = {
      id: "task_changes",
      label: "task_changes",
      description: "task_changes",
      defaultTier: "ask_each_time",
      allowedTiers: ["ask_each_time", "trusted_auto", "always_confirm"]
    };
    const otherFamily: ModuleAssistantActionFamilyManifest = {
      id: "tasks.otherFamily",
      label: "tasks.otherFamily",
      description: "tasks.otherFamily",
      defaultTier: "ask_each_time",
      allowedTiers: ["ask_each_time", "trusted_auto", "always_confirm"]
    };
    const taskChangesTool: ModuleAssistantToolManifest = {
      name: "tasks.updateSomething",
      description: "Update something.",
      permissionId: "tasks.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "task_changes",
      selfOperationGrant: "granted_at_install"
    };
    const otherTool: ModuleAssistantToolManifest = {
      name: "tasks.otherOperate",
      description: "Auto-operate on something else.",
      permissionId: "tasks.manage",
      risk: "write",
      executionPolicy: "auto",
      actionFamilyId: "tasks.otherFamily",
      selfOperationGrant: "granted_at_install"
    };
    expect(() =>
      assertBuiltInSelfOperationManifests([
        manifest("tasks", [taskChangesTool, otherTool], [taskChangesFamily, otherFamily])
      ])
    ).toThrow(
      "module \"tasks\" must declare exactly one granted_at_install action family, " +
        '"task_changes" (found: task_changes, tasks.otherFamily) -- ' +
        "packages/module-registry/src/index.ts special-cases tasks' install grant to write only " +
        '"task_changes" and will silently fail to grant any other family'
    );
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

describe("module-sdk self-operation vocabulary", () => {
  it("accepts the selfOperationGrant vocabulary without widening action tiers", () => {
    const installGrant: ModuleAssistantToolManifest = {
      name: "example.installGrant",
      description: "Fixture.",
      permissionId: "example.use",
      risk: "write",
      selfOperationGrant: "granted_at_install"
    };
    const confirmAlways: ModuleAssistantToolManifest = {
      name: "example.confirmAlways",
      description: "Fixture.",
      permissionId: "example.use",
      risk: "destructive",
      selfOperationGrant: "confirm_always"
    };

    expect(installGrant.selfOperationGrant).toBe("granted_at_install");
    expect(confirmAlways.selfOperationGrant).toBe("confirm_always");

    const grants: readonly ModuleAssistantToolSelfOperationGrant[] = [
      "granted_at_install",
      "confirm_always"
    ];
    const tiers: readonly JarvisActionPermissionTier[] = [
      "ask_each_time",
      "trusted_auto",
      "always_confirm"
    ];
    for (const grant of grants) {
      expect(tiers as readonly string[]).not.toContain(grant);
    }
  });
});
