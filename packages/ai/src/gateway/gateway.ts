import { randomUUID } from "node:crypto";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import type {
  JarvisModuleManifest,
  ModuleAssistantToolManifest,
  ToolContext,
  ToolExecute
} from "@jarv1s/module-sdk";
import { renderToolResult } from "@jarv1s/module-sdk";
import type { AiAssistantToolDto } from "@jarv1s/shared";

import { summarizeAssistantToolInput } from "../assistant-tools.js";
import type { AiRepository } from "../repository.js";
import type { ConfirmationRegistry } from "./confirmation-registry.js";
import { validateToolInput } from "./input-validation.js";
import { resolvePolicy } from "./policy.js";
import type { SessionTokenRegistry } from "./session-tokens.js";
import type { ActiveModulesResolver, GatewayToolResponse, SessionNotifier } from "./types.js";

export interface AssistantToolGatewayDependencies {
  readonly resolveActiveModules: ActiveModulesResolver;
  readonly repository: AiRepository;
  readonly runner: DataContextRunner;
  readonly tokens: SessionTokenRegistry;
  readonly confirmations: ConfirmationRegistry;
  readonly notifier: SessionNotifier;
  readonly confirmTimeoutMs: number;
}

interface ExecutableTool {
  readonly tool: ModuleAssistantToolManifest;
  readonly execute: ToolExecute;
  readonly dto: AiAssistantToolDto;
}

/**
 * The single chokepoint between Jarvis and every module's real operations. Lists
 * tools, validates input, enforces the hardcoded risk policy + confirmation bridge,
 * scopes each call to the token's user under RLS, and dispatches to the owning
 * module's handler. Identity comes only from the per-session token.
 */
export class AssistantToolGateway {
  constructor(private readonly deps: AssistantToolGatewayDependencies) {}

  /** Only tools with an execute handler are exposed — declaration-only tools are invisible. */
  listTools(): AiAssistantToolDto[] {
    return this.executableTools("").map((entry) => entry.dto);
  }

  async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
    const { actorUserId, chatSessionId } = this.deps.tokens.verify(token);
    const ctx: ToolContext = { actorUserId, requestId: `mcp_${randomUUID()}`, chatSessionId };

    const found = this.executableTools(actorUserId).find((entry) => entry.tool.name === toolName);
    if (!found) {
      return { ok: false, error: `Tool not available: ${toolName}` };
    }

    let input: Record<string, unknown>;
    try {
      input = validateToolInput(found.tool.inputSchema, rawInput);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Invalid input" };
    }

    if (resolvePolicy(found.tool.risk) === "run") {
      return this.runHandler(found, input, ctx);
    }
    return this.confirmAndRun(found, input, ctx);
  }

  /** Called by the Approve/Deny endpoint (and tests). Persists the resolution and unblocks the call. */
  async resolveActionRequest(
    actorUserId: string,
    actionRequestId: string,
    status: "confirmed" | "rejected" | "cancelled"
  ): Promise<void> {
    const access: AccessContext = { actorUserId, requestId: `mcp_${randomUUID()}` };
    const resolved = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
      this.deps.repository.resolveAssistantAction(scopedDb, actionRequestId, { status })
    );
    // Only unblock the pending call if the DB row was actually updated (owner matches + still pending).
    // Without this guard a logged-in user could unblock another user's tool call via a guessed ID.
    if (!resolved) return;
    this.deps.confirmations.resolve(actionRequestId, status);
  }

  private async runHandler(
    found: ExecutableTool,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<GatewayToolResponse> {
    const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };
    try {
      const result = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
        found.execute(scopedDb, input, ctx)
      );
      return { ok: true, data: { text: renderToolResult(result) } };
    } catch {
      // never leak internals/secrets from a handler throw
      return { ok: false, error: `Tool ${found.dto.name} failed` };
    }
  }

  private async confirmAndRun(
    found: ExecutableTool,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<GatewayToolResponse> {
    const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };

    const action = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
      this.deps.repository.createPendingAssistantAction(scopedDb, {
        toolModuleId: found.dto.moduleId,
        toolModuleName: found.dto.moduleName,
        toolName: found.dto.name,
        permissionId: found.dto.permissionId,
        risk: found.tool.risk as "write" | "destructive",
        inputSummary: summarizeAssistantToolInput(input),
        requestId: ctx.requestId
      })
    );

    this.deps.notifier.emit(ctx.chatSessionId, {
      kind: "action_request",
      actionRequestId: action.id,
      toolName: found.dto.name,
      summary: this.summaryFor(found.tool, input, ctx)
    });

    const outcome = await this.deps.confirmations.awaitResolution(
      action.id,
      this.deps.confirmTimeoutMs
    );

    if (outcome !== "confirmed") {
      this.deps.notifier.emit(ctx.chatSessionId, {
        kind: "action_result",
        actionRequestId: action.id,
        toolName: found.dto.name,
        outcome: "denied"
      });
      const reason =
        outcome === "timeout"
          ? "Timed out awaiting confirmation — still pending in your drawer."
          : "Denied by user.";
      return { ok: false, denied: true, reason };
    }

    const result = await this.runHandler(found, input, ctx);
    this.deps.notifier.emit(ctx.chatSessionId, {
      kind: "action_result",
      actionRequestId: action.id,
      toolName: found.dto.name,
      outcome: result.ok ? "executed" : "error"
    });
    return result;
  }

  private summaryFor(
    tool: ModuleAssistantToolManifest,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): string {
    if (typeof tool.summarize === "function") {
      return tool.summarize(input, ctx);
    }
    const generic = summarizeAssistantToolInput(input);
    return `${tool.name} (${String(generic.inputKeyCount ?? 0)} field(s))`;
  }

  private executableTools(actorUserId: string): ExecutableTool[] {
    const modules: readonly JarvisModuleManifest[] = this.deps.resolveActiveModules(actorUserId);
    const out: ExecutableTool[] = [];
    for (const module of modules) {
      for (const tool of module.assistantTools ?? []) {
        if (typeof tool.execute !== "function") {
          continue;
        }
        out.push({
          tool,
          execute: tool.execute,
          dto: {
            moduleId: module.id,
            moduleName: module.name,
            name: tool.name,
            description: tool.description,
            permissionId: tool.permissionId,
            risk: tool.risk,
            inputSchema: tool.inputSchema ?? null,
            outputSchema: tool.outputSchema ?? null
          }
        });
      }
    }
    return out;
  }
}
