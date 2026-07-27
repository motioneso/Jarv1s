import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildChatGatewayDependencies } from "../../packages/chat/src/routes.js";
import { AiRepository } from "../../packages/ai/src/repository.js";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { ConfirmationRegistry, SessionNotifier, SessionTokenRegistry } from "@jarv1s/ai";
import type { JarvisModuleManifest, ModuleAssistantToolManifest } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { LEGACY_AGENCY_AUTO_EXECUTE_KEY } from "../../packages/tasks/src/action-policy.js";
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

/** Mirrors the real tasks module's single granted_at_install family (task_changes) — the
 * hardcoded `moduleId === "tasks"` compat branch in routes.ts only engages for this exact id. */
const tasksShapedModule: JarvisModuleManifest = {
  id: "tasks",
  name: "Tasks (test double)",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  assistantTools: [
    tool("tasks.create", {
      selfOperationGrant: "granted_at_install",
      actionFamilyId: "task_changes"
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

  function actionPolicyFor(
    actorUserId: string,
    overrides: { agencyPreferences?: PreferencesRepository; resolveModule?: JarvisModuleManifest } = {}
  ) {
    const deps = buildChatGatewayDependencies({
      resolveActiveModules: async () => [overrides.resolveModule ?? testModule],
      repository,
      runner,
      tokens: {} as unknown as SessionTokenRegistry,
      confirmations: {} as unknown as ConfirmationRegistry,
      notifier: {} as unknown as SessionNotifier,
      agencyPreferences: overrides.agencyPreferences,
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

  it("#1311 finding #2: task_changes never falls through to the generic self-heal when preferences is absent, even with a legacy revocation on file", async () => {
    const actorUserId = ids.userA;
    await runner.withDataContext({ actorUserId, requestId: "req-legacy-seed" }, (scopedDb) =>
      new PreferencesRepository().upsert(scopedDb, LEGACY_AGENCY_AUTO_EXECUTE_KEY, false)
    );

    // No agencyPreferences wired — the exact shape of a caller that omits the optional port.
    const policy = actionPolicyFor(actorUserId, { resolveModule: tasksShapedModule });
    const tier = await policy.getFamilyTier("tasks", "task_changes");
    expect(tier).toBeNull();

    // And critically: no row got written to the generic action_policies table either — the
    // guard skips the heal entirely rather than just masking its result.
    const policies = await runner.withDataContext(
      { actorUserId, requestId: "req-legacy-check" },
      (scopedDb) => repository.listActionPolicies(scopedDb)
    );
    const stored = policies.find(
      (p) => p.moduleId === "tasks" && p.actionFamilyId === "task_changes"
    );
    expect(stored).toBeUndefined();
  });

  it("task_changes still resolves through the compat helper (and honors the legacy revocation) once preferences is wired", async () => {
    const actorUserId = ids.userB;
    const agencyPreferences = new PreferencesRepository();
    await runner.withDataContext({ actorUserId, requestId: "req-legacy-seed-2" }, (scopedDb) =>
      agencyPreferences.upsert(scopedDb, LEGACY_AGENCY_AUTO_EXECUTE_KEY, false)
    );

    const policy = actionPolicyFor(actorUserId, {
      resolveModule: tasksShapedModule,
      agencyPreferences
    });
    const tier = await policy.getFamilyTier("tasks", "task_changes");
    expect(tier).toBe("ask_each_time");
  });
});
