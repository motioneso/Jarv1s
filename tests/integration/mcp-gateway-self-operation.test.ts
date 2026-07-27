import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  grantSelfOperationForModule,
  type GatewaySessionRecord,
  type SelfOperationManifestInput
} from "@jarv1s/ai";
import { calendarModuleManifest } from "@jarv1s/calendar";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolCalls, exampleToolModule } from "./fixtures/example-tool-module.js";

describe("AssistantToolGateway self-operation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let bootstrapDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repository: AiRepository;
  let tokens: SessionTokenRegistry;
  let confirmations: ConfirmationRegistry;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];

  function firstActionRequest(): { actionRequestId: string; toolName: string; summary: string } {
    const entry = emitted[0];
    if (!entry || entry.record.kind !== "action_request") {
      throw new Error("expected an action_request card to have been emitted");
    }
    return entry.record;
  }

  async function waitForActionRequest() {
    await vi.waitFor(() => expect(emitted).toHaveLength(1), { timeout: 5_000 });
    return firstActionRequest();
  }

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    bootstrapDb = createDatabase({
      connectionString: connectionStrings.bootstrap,
      maxConnections: 1
    });
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
  });

  afterAll(async () => {
    await bootstrapDb.destroy();
    await appDb.destroy();
  });

  beforeEach(() => {
    exampleToolCalls.length = 0;
    emitted = [];
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
  });

  // #1263 Task 17: unlike gateway tests that stub getFamilyTier directly, these read the tier the
  // way production does — from the real AiRepository/DataContextRunner — so they actually prove the
  // install-grant write path and a stored user override are honored end to end.
  function dbBackedActionPolicy(ctx: { actorUserId: string; requestId: string }) {
    return {
      getFamilyTier: async (moduleId: string, familyId: string) =>
        runner.withDataContext(
          { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
          async (scopedDb) => {
            const policies = await repository.listActionPolicies(scopedDb);
            return (
              policies.find((p) => p.moduleId === moduleId && p.actionFamilyId === familyId)
                ?.tier ?? null
            );
          }
        ),
      getFamilyManifest: async (moduleId: string, familyId: string) =>
        moduleId === exampleToolModule.id
          ? (exampleToolModule.assistantActionFamilies?.find((f) => f.id === familyId) ?? null)
          : null
    };
  }

  it("first use after install grant runs without an action card", async () => {
    const grantManifest: SelfOperationManifestInput = {
      id: exampleToolModule.id,
      assistantTools: exampleToolModule.assistantTools?.map((tool) =>
        tool.name === "example.autoWrite"
          ? { ...tool, selfOperationGrant: "granted_at_install" as const }
          : tool
      )
    };

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-install-grant-1" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repository, grantManifest)
    );

    const installGrantGateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 30_000,
      actionPolicy: (ctx) => dbBackedActionPolicy(ctx)
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-install-grant",
      allowedToolNames: null
    });

    const res = await installGrantGateway.callTool(token, "example.autoWrite", { value: "quiet" });

    expect(res.ok).toBe(true);
    expect(emitted.map((entry) => entry.record.kind)).toEqual(["action_result"]);
  });

  it("stored always_confirm override still produces an action card", async () => {
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-always-confirm-override" },
      (scopedDb) =>
        repository.setActionPolicy(scopedDb, exampleToolModule.id, "dummy", "always_confirm")
    );

    const overrideGateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 30_000,
      actionPolicy: (ctx) => dbBackedActionPolicy(ctx)
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-always-confirm-override",
      allowedToolNames: null
    });

    const call = overrideGateway.callTool(token, "example.autoWrite", { value: "quiet" });
    const request = await waitForActionRequest();

    expect(request.toolName).toBe("example.autoWrite");
    expect(exampleToolCalls).toHaveLength(0);

    await overrideGateway.resolveActionRequest(ids.userA, request.actionRequestId, "cancelled");
    await call;
  });

  it("install grants for the calendar module still leave calendar.deleteEvent asking (user_promotable is not promoted by install)", async () => {
    const grantManifest: SelfOperationManifestInput = {
      id: calendarModuleManifest.id,
      assistantTools: calendarModuleManifest.assistantTools,
      assistantActionFamilies: calendarModuleManifest.assistantActionFamilies
    };

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-calendar-install-grant" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repository, grantManifest)
    );

    const fakeCalendarWrite = {
      async proposeAndInsert() {
        throw new Error("should not be called — deleteEvent must confirm first");
      },
      async deleteEvent() {
        throw new Error("should not be called — deleteEvent must confirm first");
      }
    };

    function dbBackedCalendarActionPolicy(ctx: { actorUserId: string; requestId: string }) {
      return {
        getFamilyTier: async (moduleId: string, familyId: string) =>
          runner.withDataContext(
            { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
            async (scopedDb) => {
              const policies = await repository.listActionPolicies(scopedDb);
              return (
                policies.find((p) => p.moduleId === moduleId && p.actionFamilyId === familyId)
                  ?.tier ?? null
              );
            }
          ),
        getFamilyManifest: async (_moduleId: string, familyId: string) =>
          calendarModuleManifest.assistantActionFamilies?.find((f) => f.id === familyId) ?? null
      };
    }

    const calendarGateway = new AssistantToolGateway({
      resolveActiveModules: async () => [calendarModuleManifest],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 30_000,
      actionPolicy: (ctx) => dbBackedCalendarActionPolicy(ctx),
      toolServices: { calendarWrite: fakeCalendarWrite }
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "s-calendar-install-grant",
      allowedToolNames: null
    });

    const call = calendarGateway.callTool(token, "calendar.deleteEvent", {
      eventId: "some-uuid",
      displayTitle: "Board sync"
    });
    const request = await waitForActionRequest();

    expect(request.toolName).toBe("calendar.deleteEvent");

    await calendarGateway.resolveActionRequest(ids.userA, request.actionRequestId, "cancelled");
    await call;
  });

  it("installing calendar does not arm the background follow-through writer", async () => {
    // #1263 Fable security review, PR #1268: buildCalendarFollowThroughPort.executeAutoActions
    // (module-registry/src/index.ts:711) is a second, unattended reader of calendar_writeback's
    // tier — on a block_time signal it calls calendarWrite.proposeAndInsert directly, no card, no
    // chat session, no gateway. Granting trusted_auto at install would arm unattended background
    // calendar writes the instant the module is enabled. Task 1 moved proposeFocusBlock to
    // user_promotable so install must not write trusted_auto for calendar_writeback at all.
    const grantManifest: SelfOperationManifestInput = {
      id: calendarModuleManifest.id,
      assistantTools: calendarModuleManifest.assistantTools,
      assistantActionFamilies: calendarModuleManifest.assistantActionFamilies
    };

    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-calendar-install-grant-no-writeback" },
      (scopedDb) => grantSelfOperationForModule(scopedDb, repository, grantManifest)
    );

    const writebackTier = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-calendar-install-grant-no-writeback-read" },
      async (scopedDb) => {
        const policies = await repository.listActionPolicies(scopedDb);
        return (
          policies.find(
            (p) =>
              p.moduleId === calendarModuleManifest.id && p.actionFamilyId === "calendar_writeback"
          )?.tier ?? null
        );
      }
    );

    // Tightened per Coordinator review (PR #1268): grantSelfOperationForModule only inserts rows
    // for granted_at_install families, and calendar_writeback's only owner (proposeFocusBlock) is
    // user_promotable — so install must write no row at all, not merely a non-trusted_auto one.
    expect(writebackTier).toBeNull();
  });

  it("the five built-in confirm_always tools remain the only confirmation declarations", () => {
    const confirmAlwaysTools: string[] = [];
    for (const manifest of getBuiltInModuleManifests()) {
      for (const tool of manifest.assistantTools ?? []) {
        if (tool.selfOperationGrant === "confirm_always") {
          confirmAlwaysTools.push(tool.name);
        }
      }
    }

    // web.read is the fifth (PR #1268 Opus security review): risk "write", not "destructive" —
    // it is on this list because it has no actionFamilyId, so policy.ts:40 confirms every call,
    // restoring the pre-PR guarantee that protected the v0.1.0 audit's web.read
    // prompt-injection-to-exfiltration finding.
    expect(confirmAlwaysTools.sort()).toEqual(
      [
        "email.sendReply",
        "memory.forget",
        "people.merge",
        "people.splitIdentity",
        "web.read"
      ].sort()
    );
  });
});
