import { describe, expect, it, vi } from "vitest";

import { AssistantToolGateway, ConfirmationRegistry, SessionTokenRegistry } from "@jarv1s/ai";

describe("first-party Jarvis MCP transport", () => {
  it("auto-allows transport without consulting action policy", async () => {
    const tokens = new SessionTokenRegistry();
    const createPendingAssistantAction = vi.fn();
    const emit = vi.fn();
    const resolveLocalTimezone = vi.fn();
    const yoloMode = vi.fn();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [],
      repository: { createPendingAssistantAction } as never,
      runner: { withDataContext: vi.fn() } as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit },
      confirmTimeoutMs: 5,
      resolveLocalTimezone,
      yoloMode
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    await expect(
      gateway.requestNativeToolPermission(token, {
        toolName: "  mcp__jarvis__job_search_resume_import  ",
        toolInput: { attachmentId: "attachment-1" }
      })
    ).resolves.toEqual({ decision: "allow", reason: "First-party Jarvis MCP transport." });
    expect(createPendingAssistantAction).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(resolveLocalTimezone).not.toHaveBeenCalled();
    expect(yoloMode).not.toHaveBeenCalled();
  });

  it.each([
    "mcp__jarvis__",
    "mcp__jarviss__job_search_resume_import",
    "mcp__github__get_issue",
    "Bash"
  ])("keeps non-Jarvis transport name %j behind native confirmation", async (toolName) => {
    const tokens = new SessionTokenRegistry();
    const createPendingAssistantAction = vi.fn(async () => ({ id: "native-not-transport" }));
    const resolveLocalTimezone = vi.fn(async () => null);
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [],
      repository: { createPendingAssistantAction } as never,
      runner: {
        withDataContext: async (_access: unknown, work: (db: unknown) => Promise<unknown>) =>
          work({})
      } as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => undefined },
      confirmTimeoutMs: 1,
      resolveLocalTimezone
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });

    await expect(
      gateway.requestNativeToolPermission(token, { toolName, toolInput: {} })
    ).resolves.toEqual({ decision: "deny", reason: "Timed out awaiting confirmation." });
    expect(createPendingAssistantAction).toHaveBeenCalledOnce();
    expect(resolveLocalTimezone).toHaveBeenCalledOnce();
  });
});

describe("logical action terminal results", () => {
  const createGateway = (input: { yolo: boolean; handlerError?: boolean }) => {
    const tokens = new SessionTokenRegistry();
    const emitted: Array<{
      kind: string;
      actionRequestId: string;
      toolName: string;
      outcome?: string;
    }> = [];
    const handlerRequestIds: string[] = [];
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [
        {
          id: "job-search",
          name: "Job Search",
          version: "1.0.0",
          publisher: "Jarv1s",
          lifecycle: "optional",
          compatibility: { jarv1s: "*" },
          assistantTools: [
            {
              name: "job-search.resume.import",
              description: "Import a resume.",
              permissionId: "job-search.resume.write",
              actionFamilyId: "resume_changes",
              risk: "write",
              executionPolicy: "auto",
              execute: async (_db, _toolInput, ctx) => {
                handlerRequestIds.push(ctx.requestId);
                if (input.handlerError) throw new Error("private handler detail");
                return { data: { imported: true } };
              }
            }
          ]
        }
      ],
      repository: { insertActionAuditLog: async () => undefined } as never,
      runner: {
        withDataContext: async (_access: unknown, work: (db: unknown) => Promise<unknown>) =>
          work({})
      } as never,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: (_chatSessionId, record) => emitted.push(record) },
      confirmTimeoutMs: 50,
      yoloMode: async () => input.yolo,
      actionPolicy: () => ({
        getFamilyTier: async () => "trusted_auto",
        getFamilyManifest: async () => ({
          id: "resume_changes",
          label: "Resume changes",
          description: "Changes to a Job Search resume.",
          defaultTier: "ask_each_time",
          allowedTiers: ["ask_each_time", "trusted_auto"]
        })
      })
    });
    return {
      gateway,
      emitted,
      handlerRequestIds,
      token: tokens.mint({
        actorUserId: "u1",
        chatSessionId: "s1",
        allowedToolNames: null
      })
    };
  };

  it("emits one standalone executed result for a successful YOLO action", async () => {
    const { gateway, token, emitted, handlerRequestIds } = createGateway({ yolo: true });

    await expect(gateway.callTool(token, "job-search.resume.import", {})).resolves.toMatchObject({
      ok: true
    });
    expect(emitted).toEqual([
      {
        kind: "action_result",
        actionRequestId: handlerRequestIds[0],
        toolName: "job-search.resume.import",
        outcome: "executed"
      }
    ]);
    expect(handlerRequestIds[0]).toMatch(/^mcp_/);
  });

  it("emits one standalone executed result for a successful trusted-auto action", async () => {
    const { gateway, token, emitted, handlerRequestIds } = createGateway({ yolo: false });

    await expect(gateway.callTool(token, "job-search.resume.import", {})).resolves.toMatchObject({
      ok: true
    });
    expect(emitted).toEqual([
      {
        kind: "action_result",
        actionRequestId: handlerRequestIds[0],
        toolName: "job-search.resume.import",
        outcome: "executed"
      }
    ]);
  });

  it("emits one standalone error result when a trusted-auto handler fails", async () => {
    const { gateway, token, emitted, handlerRequestIds } = createGateway({
      yolo: false,
      handlerError: true
    });

    await expect(gateway.callTool(token, "job-search.resume.import", {})).resolves.toMatchObject({
      ok: false
    });
    expect(emitted).toEqual([
      {
        kind: "action_result",
        actionRequestId: handlerRequestIds[0],
        toolName: "job-search.resume.import",
        outcome: "error"
      }
    ]);
  });
});
