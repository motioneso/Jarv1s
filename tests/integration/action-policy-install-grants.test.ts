import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  grantSelfOperationForModule,
  AiRepository,
  type SelfOperationManifestInput
} from "@moss/ai";
import { DataContextRunner, createDatabase, type MossDatabase } from "@moss/db";
import type { ModuleAssistantToolManifest } from "@moss/module-sdk";
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

describe("action policy install grants", () => {
  let appDb: Kysely<MossDatabase>;
  let dataContext: DataContextRunner;
  let repo: AiRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    repo = new AiRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("stores trusted_auto under the existing action-policy preference key", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-1" },
      async (scopedDb) => {
        const inserted = await repo.insertActionPolicyIfAbsent(
          scopedDb,
          "test-mod-1",
          "family-1",
          "trusted_auto"
        );
        expect(inserted).toBe(true);
      }
    );

    const policies = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-1b" },
      (scopedDb) => repo.listActionPolicies(scopedDb)
    );
    const stored = policies.find(
      (p) => p.moduleId === "test-mod-1" && p.actionFamilyId === "family-1"
    );
    expect(stored?.tier).toBe("trusted_auto");
  });

  it("does not clobber an existing always_confirm user choice", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-2a" },
      async (scopedDb) => {
        await repo.setActionPolicy(scopedDb, "test-mod-2", "family-2", "always_confirm");
      }
    );

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-2b" },
      async (scopedDb) => {
        const inserted = await repo.insertActionPolicyIfAbsent(
          scopedDb,
          "test-mod-2",
          "family-2",
          "trusted_auto"
        );
        expect(inserted).toBe(false);
      }
    );

    const policies = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-2c" },
      (scopedDb) => repo.listActionPolicies(scopedDb)
    );
    const stored = policies.find(
      (p) => p.moduleId === "test-mod-2" && p.actionFamilyId === "family-2"
    );
    expect(stored?.tier).toBe("always_confirm");
  });

  it("is idempotent across reinstall and reconcile", async () => {
    const manifest: SelfOperationManifestInput = {
      id: "test-mod-3",
      assistantTools: [
        tool("test-mod-3.writeThing", {
          selfOperationGrant: "granted_at_install",
          actionFamilyId: "family-3"
        })
      ]
    };

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-3a" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repo, manifest)
    );
    // Reinstall / reconcile: running it again must not throw and must not change the stored tier.
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-3b" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repo, manifest)
    );

    const policies = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-3c" },
      (scopedDb) => repo.listActionPolicies(scopedDb)
    );
    const matches = policies.filter(
      (p) => p.moduleId === "test-mod-3" && p.actionFamilyId === "family-3"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.tier).toBe("trusted_auto");
  });

  it("grants only families referenced by granted_at_install tools", async () => {
    const manifest: SelfOperationManifestInput = {
      id: "test-mod-4",
      assistantTools: [
        tool("test-mod-4.installGranted", {
          selfOperationGrant: "granted_at_install",
          actionFamilyId: "family-install"
        }),
        tool("test-mod-4.confirmAlways", {
          selfOperationGrant: "confirm_always",
          actionFamilyId: "family-confirm"
        }),
        tool("test-mod-4.userPromotable", {
          selfOperationGrant: "user_promotable",
          actionFamilyId: "family-promotable"
        })
      ]
    };

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-4" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repo, manifest)
    );

    const policies = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-4b" },
      (scopedDb) => repo.listActionPolicies(scopedDb)
    );
    const forModule = policies.filter((p) => p.moduleId === "test-mod-4");
    expect(forModule).toHaveLength(1);
    expect(forModule[0]?.actionFamilyId).toBe("family-install");
    expect(forModule[0]?.tier).toBe("trusted_auto");
  });
});
