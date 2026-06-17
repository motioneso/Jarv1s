import { randomUUID } from "node:crypto";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import type {
  JsonSchema,
  JarvisModuleManifest,
  ModuleAssistantToolManifest,
  ToolContext,
  ToolExecute,
  ToolResult,
  ToolServices
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
  /**
   * Opaque, composition-layer-constructed service registry keyed by service name.
   * Passed verbatim (as a per-tool, declared-keys-only subset) as the 4th argument
   * to a confirmed tool's execute. The gateway never inspects it. A tool declares
   * which keys it needs via manifest `requiresServices`.
   */
  readonly toolServices?: ToolServices;
}

interface ExecutableTool {
  readonly tool: ModuleAssistantToolManifest;
  readonly execute: ToolExecute;
  readonly dto: AiAssistantToolDto;
}

const MAX_RENDERED_TOOL_RESULT_CHARS = 16_000;
const TOOL_RESULT_TRUNCATION_SUFFIX = "\n...[truncated tool result]";
const JSON_SCALAR_TYPE_OF: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number",
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null
};
const JSON_NON_NULL_SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);

/**
 * The single chokepoint between Jarvis and every module's real operations. Lists
 * tools, validates input, enforces the hardcoded risk policy + confirmation bridge,
 * scopes each call to the token's user under RLS, and dispatches to the owning
 * module's handler. Identity comes only from the per-session token.
 */
export class AssistantToolGateway {
  constructor(private readonly deps: AssistantToolGatewayDependencies) {}

  /** Returns only tools executable by this actor (via resolveActiveModules). */
  async listToolsForActor(actorUserId: string): Promise<AiAssistantToolDto[]> {
    return (await this.executableTools(actorUserId)).map((entry) => entry.dto);
  }

  async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
    const { actorUserId, chatSessionId, allowedToolNames } = this.deps.tokens.verify(token);
    const ctx: ToolContext = { actorUserId, requestId: `mcp_${randomUUID()}`, chatSessionId };

    const found = (await this.executableTools(actorUserId)).find(
      (entry) => entry.tool.name === toolName
    );
    if (!found) {
      return { ok: false, error: `Tool not available: ${toolName}` };
    }

    // Server-side per-session allowlist check (defense-in-depth on top of executableTools).
    // Only fires when allowedToolNames is non-null (MCP sessions with a captured allowlist).
    // null = unrestricted (REST path tokens minted without an allowlist).
    if (allowedToolNames !== null && !allowedToolNames.has(toolName)) {
      return { ok: false, error: `Tool not in session allowlist: ${toolName}` };
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
    // Confirm-after-timeout guard (fail-closed): a "confirmed" only means anything while the
    // blocked call is still awaiting. After the confirm timeout the waiter is gone, the call
    // already returned "timed out", and the tool can NEVER execute — so persisting 'confirmed'
    // would leave a row claiming a write happened when none did (DB/drawer divergence). When no
    // live waiter exists, treat an Approve as a no-op so the row stays pending (the operator sees
    // an honest "still pending" rather than a phantom success). A reject/cancel stays terminal
    // regardless: declining a no-longer-runnable action is always safe and correct.
    if (status === "confirmed" && !this.deps.confirmations.isAwaiting(actionRequestId)) {
      return;
    }

    const access: AccessContext = { actorUserId, requestId: `mcp_${randomUUID()}` };
    const resolved = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
      this.deps.repository.resolveAssistantAction(scopedDb, actionRequestId, { status })
    );
    // Only unblock the pending call if the DB row was actually updated (owner matches + still pending).
    // Without this guard a logged-in user could unblock another user's tool call via a guessed ID.
    if (!resolved) return;
    this.deps.confirmations.resolve(actionRequestId, status);
  }

  /**
   * The subset of toolServices this tool declared via requiresServices — but ONLY for tools that
   * pass through the confirm gate. A read tool (risk → "run", no confirmation) receives NOTHING,
   * so no injected (potentially write-capable) service can be invoked without an Approve. This
   * keeps the write→confirm floor structurally un-bypassable by a mistaken/hostile read-tool
   * requiresServices declaration, with no service-risk taxonomy (Codex HIGH #5). The per-tool
   * subset also means a tool can never reach an undeclared (write-capable) service (Codex HIGH #1).
   */
  private servicesFor(tool: ModuleAssistantToolManifest): ToolServices {
    if (resolvePolicy(tool.risk) === "run") {
      return {}; // read path bypasses confirmAndRun — never hand it a service (write→confirm floor)
    }
    const registry = this.deps.toolServices ?? {};
    const keys = tool.requiresServices ?? [];
    const subset: Record<string, unknown> = {};
    for (const key of keys) {
      // executableTools already guaranteed every declared key is registered (fail-closed),
      // so this is always present here; guard defensively regardless.
      if (key in registry) subset[key] = registry[key];
    }
    return subset;
  }

  private async runHandler(
    found: ExecutableTool,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<GatewayToolResponse> {
    const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };
    const services = this.servicesFor(found.tool);
    try {
      const result = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
        found.execute(scopedDb, input, ctx, services)
      );
      const sanitized = sanitizeToolResult(found.tool.outputSchema, result);
      return { ok: true, data: { text: capRenderedToolResult(renderToolResult(sanitized)) } };
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

  private async executableTools(actorUserId: string): Promise<ExecutableTool[]> {
    const modules: readonly JarvisModuleManifest[] =
      await this.deps.resolveActiveModules(actorUserId);
    const out: ExecutableTool[] = [];
    for (const module of modules) {
      for (const tool of module.assistantTools ?? []) {
        if (typeof tool.execute !== "function") {
          continue;
        }
        const declaredServices = tool.requiresServices ?? [];
        // Fail closed #1: a read tool must NOT declare services — a read dispatches without the
        // confirm gate, so a write-capable service on a read tool would bypass the write→confirm
        // floor. Such a manifest is a misconfiguration; hide it rather than risk a bypass (HIGH #5).
        if (declaredServices.length > 0 && resolvePolicy(tool.risk) === "run") {
          continue;
        }
        // Fail closed #2: a tool whose required services we cannot satisfy is hidden — never
        // listed and never confirmable. Prevents an approve→execute-fail dead-end (HIGH #2).
        const registry = this.deps.toolServices ?? {};
        const missing = declaredServices.filter((key) => !(key in registry));
        if (missing.length > 0) {
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

function sanitizeToolResult(schema: JsonSchema | undefined, result: ToolResult): ToolResult {
  if (!isPlainObject(result.data)) {
    throw new Error("Tool result data must be an object");
  }
  if (!schema) {
    return result;
  }

  const data = sanitizeToolOutputValue(schema, result.data);
  if (!isPlainObject(data)) {
    throw new Error("Tool result data must be an object");
  }
  const allowedKeys = getDeclaredObjectKeys(schema);

  return {
    data,
    columnOrder:
      allowedKeys === null
        ? result.columnOrder
        : result.columnOrder?.filter((key) => allowedKeys.has(key))
  };
}

function sanitizeToolOutputValue(schema: JsonSchema, value: unknown): unknown {
  if (schema.type === "object" && isPlainObject(schema.properties)) {
    if (!isPlainObject(value)) {
      throw new Error("Tool result output field must be an object");
    }
    return sanitizeToolOutputObject(schema, value);
  }
  const itemSchema = schema.items;
  if (schema.type === "array" && isJsonSchema(itemSchema)) {
    if (!Array.isArray(value)) {
      throw new Error("Tool result output field must be an array");
    }
    return value.map((item) => sanitizeToolOutputValue(itemSchema, item));
  }
  const scalarTypes = getScalarTypes(schema);
  if (scalarTypes.length > 0) {
    const matches = scalarTypes.some((type) => JSON_SCALAR_TYPE_OF[type]?.(value));
    if (!matches) {
      throw new Error(`Tool result output field must be a ${scalarTypes.join(" or ")}`);
    }
  }
  return value;
}

function sanitizeToolOutputObject(
  schema: JsonSchema,
  value: Record<string, unknown>
): Record<string, unknown> {
  for (const key of getRequiredKeys(schema)) {
    if (!(key in value)) {
      throw new Error(`Tool result missing required output field "${key}"`);
    }
  }

  const data: Record<string, unknown> = {};
  const properties = schema.properties as Record<string, unknown>;
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) {
      data[key] = isJsonSchema(propertySchema)
        ? sanitizeToolOutputValue(propertySchema, value[key])
        : value[key];
    }
  }
  return data;
}

function getDeclaredObjectKeys(schema: JsonSchema): Set<string> | null {
  return schema.type === "object" && isPlainObject(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : null;
}

function getRequiredKeys(schema: JsonSchema): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
}

function getScalarTypes(schema: JsonSchema): string[] {
  if (typeof schema.type === "string" && isJsonScalarType(schema.type)) {
    return [schema.type];
  }

  if (!Array.isArray(schema.anyOf)) {
    return [];
  }

  const types = schema.anyOf
    .filter(isJsonSchema)
    .map((candidate) => candidate.type)
    .filter((type): type is string => typeof type === "string");
  const nonNullScalarTypes = types.filter((type) => JSON_NON_NULL_SCALAR_TYPES.has(type));

  if (
    types.length === schema.anyOf.length &&
    types.length === 2 &&
    types.includes("null") &&
    nonNullScalarTypes.length === 1
  ) {
    const [nonNullScalarType] = nonNullScalarTypes;
    if (nonNullScalarType) {
      return [nonNullScalarType, "null"];
    }
  }

  return [];
}

function isJsonScalarType(type: string): type is keyof typeof JSON_SCALAR_TYPE_OF {
  return Object.prototype.hasOwnProperty.call(JSON_SCALAR_TYPE_OF, type);
}

function capRenderedToolResult(text: string): string {
  if (text.length <= MAX_RENDERED_TOOL_RESULT_CHARS) {
    return text;
  }
  const keep = Math.max(0, MAX_RENDERED_TOOL_RESULT_CHARS - TOOL_RESULT_TRUNCATION_SUFFIX.length);
  return `${text.slice(0, keep)}${TOOL_RESULT_TRUNCATION_SUFFIX}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return isPlainObject(value);
}
