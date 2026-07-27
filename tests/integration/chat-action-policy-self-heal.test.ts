import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildChatGatewayDependencies } from "../../packages/chat/src/routes.js";
import { AiRepository } from "../../packages/ai/src/repository.js";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ConfirmationRegistry, SessionNotifier, SessionTokenRegistry } from "@jarv1s/ai";
import type { JarvisModuleManifest, ModuleAssistantToolManifest } from "@jarv1s/module-sdk";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

function tool(
  name: string,
  overrides: Partial<ModuleAssistantToolManifest> = {}
): ModuleAssistantToolManifest {
  return {
    name,
    description: name,
    permissionId: "test.permission",
    risk: "write",
    executionPolicy: "auto",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ data: {} }),
    ...overrides
  };
}

const testModule: JarvisModuleManifest = {
  id: "test-self-heal-mod",
  name: "Test Self Heal",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  assistantTools: [
    tool("test-self-heal-mod.installGranted", {
      selfOperationGrant: "granted_at_install",
      actionFamilyId: "family-heal"
    }),
    tool("test-self-heal-mod.confirmAlways", {
      selfOperationGrant: "confirm_always",
      actionFamilyId: "family-confirm"
    })
  ]
};

describe("chat action policy self-heal (getFamilyTier, real DB via buildChatGatewayDependencies)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repository: AiRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  function actionPolicyFor(actorUserId: string) {
    const deps = buildChatGatewayDependencies({
      resolveActiveModules: async () => [testModule],
      repository,
      runner,
      tokens: {} as unknown as SessionTokenRegistry,
      confirmations: {} as unknown as ConfirmationRegistry,
      notifier: {} as unknown as SessionNotifier,
      collaborators: {}
    });
    const factory = deps.actionPolicy as unknown as (ctx: {
      actorUserId: string;
      requestId: string;
    }) => {
      getFamilyTier: (moduleId: string, familyId: string) => Promise<string | null>;
    };
    return factory({ actorUserId, requestId: `req-${actorUserId}` });
  }

  it("heals a granted_at_install family with no prior row, no explicit enable action having run", async () => {
    const policy = actionPolicyFor(ids.userA);
    const tier = await policy.getFamilyTier("test-self-heal-mod", "family-heal");
    expect(tier).toBe("trusted_auto");
  });

  it("never overrides an explicit always_confirm choice (revocation survival)", async () => {
    await runner.withDataContext({ actorUserId: ids.userB, requestId: "req-preset" }, (scopedDb) =>
      repository.setActionPolicy(scopedDb, "test-self-heal-mod", "family-heal", "always_confirm")
    );

    const policy = actionPolicyFor(ids.userB);
    const tier = await policy.getFamilyTier("test-self-heal-mod", "family-heal");
    expect(tier).toBe("always_confirm");
  });

  it("never heals a confirm_always family (no row created, tier stays null)", async () => {
    const policy = actionPolicyFor(ids.adminUser);
    const tier = await policy.getFamilyTier("test-self-heal-mod", "family-confirm");
    expect(tier).toBeNull();

    const policies = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-confirm-check" },
      (scopedDb) => repository.listActionPolicies(scopedDb)
    );
    const stored = policies.find(
      (p) => p.moduleId === "test-self-heal-mod" && p.actionFamilyId === "family-confirm"
    );
    expect(stored).toBeUndefined();
  });
});
