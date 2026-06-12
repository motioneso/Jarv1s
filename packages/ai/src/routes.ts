import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Per-user rate-limit key for the assistant-tools invoke endpoint: use the Better Auth
// session cookie or Authorization Bearer token so each LAN user gets a separate counter.
// Unauthenticated requests fall back to IP (they will get a 401 before any AI spend).
//
// Override the limit via env: JARVIS_RL_AI_TOOLS_MAX=<n> (requests per minute, default 60).
const AI_TOOLS_MAX = Number(process.env.JARVIS_RL_AI_TOOLS_MAX ?? 60);

function aiToolsRateLimitKey(request: FastifyRequest): string {
  const cookie = (request.headers.cookie ?? "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("better-auth.session_token="));
  if (cookie) {
    return cookie.slice("better-auth.session_token=".length).split(";")[0] ?? request.ip;
  }
  const auth = request.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return request.ip;
}

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  createAiConfiguredModelRouteSchema,
  createAiProviderConfigRouteSchema,
  invokeAiAssistantToolRouteSchema,
  listAiAssistantActionsRouteSchema,
  listAiAssistantToolsRouteSchema,
  listAiConfiguredModelsRouteSchema,
  listAiProviderConfigsRouteSchema,
  lookupAiCapabilityRouteRouteSchema,
  resolveAiAssistantActionRouteSchema,
  revokeAiProviderConfigRouteSchema,
  updateAiConfiguredModelRouteSchema,
  updateAiProviderConfigRouteSchema,
  type AiAssistantToolBlockedReason,
  type AiAssistantActionDto,
  type AiAssistantActionStatus,
  type AiAssistantToolDto,
  type AiAssistantToolInvocationDto,
  type AiAuthMethod,
  type AiConfiguredModelDto,
  type AiModelCapability,
  type AiModelStatus,
  type AiModelTier,
  type AiProviderConfigDto,
  type AiProviderKind,
  type AiProviderStatus,
  type CreateAiConfiguredModelRequest,
  type CreateAiProviderConfigRequest,
  type InvokeAiAssistantToolRequest,
  type ResolveAiAssistantActionRequest,
  type UpdateAiConfiguredModelRequest,
  type UpdateAiProviderConfigRequest
} from "@jarv1s/shared";

import {
  findAssistantToolFromManifests,
  listAssistantToolsFromManifests
} from "./assistant-tools.js";
import { ToolInputValidationError, validateToolInput } from "./gateway/input-validation.js";
import { cliAvailable, type ProviderKind as CliProviderKind } from "./cli-availability.js";
import { createAiSecretCipher, type AiSecretCipher } from "./crypto.js";
import {
  AiRepository,
  type AiAssistantActionRequestSafeRow,
  type AiConfiguredModelSafeRow,
  type AiProviderConfigSafeRow
} from "./repository.js";

export interface AiRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly repository?: AiRepository;
  readonly secretCipher?: AiSecretCipher;
}

interface IdParams {
  readonly id: string;
}

interface CapabilityParams {
  readonly capability: string;
}

interface AssistantToolParams {
  readonly name: string;
}

const AI_PROVIDER_KINDS = new Set<AiProviderKind>([
  "openai-compatible",
  "anthropic",
  "google",
  "ollama",
  "custom"
]);
const WRITABLE_PROVIDER_STATUSES = new Set<Exclude<AiProviderStatus, "revoked">>([
  "active",
  "error",
  "disabled"
]);
const AUTH_METHODS = new Set<AiAuthMethod>(["cli", "api_key"]);
const CLI_PROVIDER_KINDS = new Set<CliProviderKind>(["anthropic", "openai-compatible", "google"]);
const MODEL_STATUSES = new Set<AiModelStatus>(["active", "disabled"]);
const MODEL_TIERS = new Set<AiModelTier>(["reasoning", "interactive", "economy"]);
const MODEL_CAPABILITIES = new Set<AiModelCapability>([
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
]);

export function registerAiRoutes(
  server: FastifyInstance,
  dependencies: AiRoutesDependencies
): void {
  const repository = dependencies.repository ?? new AiRepository();
  const secretCipher = dependencies.secretCipher ?? createAiSecretCipher();

  server.get(
    "/api/ai/providers",
    { schema: listAiProviderConfigsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const providers = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.listProviders(scopedDb)
        );

        return { providers: await Promise.all(providers.map(serializeProvider)) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/ai/providers",
    { schema: createAiProviderConfigRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseCreateProviderBody(request.body);
        const authMethod = body.authMethod ?? "api_key";
        const encryptedCredential =
          authMethod === "cli"
            ? secretCipher.encryptJson({ cli: true })
            : secretCipher.encryptJson(body.credentialPayload ?? {});
        const provider = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.createProvider(scopedDb, {
            providerKind: body.providerKind,
            displayName: body.displayName,
            baseUrl: body.baseUrl ?? null,
            status: body.status ?? "active",
            authMethod,
            encryptedCredential
          })
        );

        return reply.code(201).send({ provider: await serializeProvider(provider) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: IdParams }>(
    "/api/ai/providers/:id",
    { schema: updateAiProviderConfigRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseUpdateProviderBody(request.body);
        const encryptedCredential =
          body.credentialPayload === undefined
            ? undefined
            : secretCipher.encryptJson(body.credentialPayload);
        const provider = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.updateProvider(scopedDb, request.params.id, {
            providerKind: body.providerKind,
            displayName: body.displayName,
            baseUrl: body.baseUrl,
            status: body.status,
            authMethod: body.authMethod,
            encryptedCredential
          })
        );

        if (!provider) {
          return reply.code(404).send({ error: "AI provider config not found" });
        }

        return { provider: await serializeProvider(provider) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: IdParams }>(
    "/api/ai/providers/:id/revoke",
    { schema: revokeAiProviderConfigRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const encryptedCredential = secretCipher.encryptJson({ revoked: true });
        const provider = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.revokeProvider(scopedDb, request.params.id, encryptedCredential)
        );

        if (!provider) {
          return reply.code(404).send({ error: "AI provider config not found" });
        }

        return { provider: await serializeProvider(provider) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/ai/models",
    { schema: listAiConfiguredModelsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const models = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listModels(scopedDb)
        );

        return { models: models.map(serializeModel) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/ai/models",
    { schema: createAiConfiguredModelRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseCreateModelBody(request.body);
        const model = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.createModel(scopedDb, {
            providerConfigId: body.providerConfigId,
            providerModelId: body.providerModelId,
            displayName: body.displayName,
            capabilities: body.capabilities,
            status: body.status ?? "active",
            tier: body.tier
          })
        );

        return reply.code(201).send({ model: serializeModel(model) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: IdParams }>(
    "/api/ai/models/:id",
    { schema: updateAiConfiguredModelRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseUpdateModelBody(request.body);
        const model = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.updateModel(scopedDb, request.params.id, {
            providerModelId: body.providerModelId,
            displayName: body.displayName,
            capabilities: body.capabilities,
            status: body.status,
            tier: body.tier
          })
        );

        if (!model) {
          return reply.code(404).send({ error: "AI model config not found" });
        }

        return { model: serializeModel(model) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: CapabilityParams }>(
    "/api/ai/capability-route/:capability",
    { schema: lookupAiCapabilityRouteRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const capability = parseCapability(request.params.capability);
        const model = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.selectModelForCapability(scopedDb, capability)
        );

        return {
          route: {
            capability,
            available: Boolean(model),
            reason: model ? "matched-active-model" : "no-active-model",
            model: model ? serializeModel(model) : null
          }
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/ai/assistant-actions",
    { schema: listAiAssistantActionsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const actions = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listAssistantActions(scopedDb)
        );

        return { actions: actions.map(serializeAssistantAction) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: IdParams }>(
    "/api/ai/assistant-actions/:id/resolve",
    { schema: resolveAiAssistantActionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseResolveAssistantActionBody(request.body);
        const action = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.resolveAssistantAction(scopedDb, request.params.id, body)
        );

        if (!action) {
          return reply.code(404).send({ error: "Assistant action request not found" });
        }

        return { action: serializeAssistantAction(action) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/ai/assistant-tools",
    { schema: listAiAssistantToolsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const tools = await dependencies.dataContext.withDataContext(accessContext, async () =>
          listAssistantToolsFromManifests(dependencies.listModuleManifests())
        );

        return { tools };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: AssistantToolParams }>(
    "/api/ai/assistant-tools/:name/invoke",
    {
      schema: invokeAiAssistantToolRouteSchema,
      config: {
        rateLimit: {
          max: AI_TOOLS_MAX,
          timeWindow: "1 minute",
          keyGenerator: aiToolsRateLimitKey
        }
      }
    },
    async (request, reply) => {
      let tool: AiAssistantToolDto | undefined;

      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        tool = findAssistantToolFromManifests(
          dependencies.listModuleManifests(),
          request.params.name
        );

        if (!tool) {
          return reply.code(404).send({ error: "Assistant tool is not declared" });
        }

        const body = parseInvokeAssistantToolBody(request.body);

        if (tool.risk !== "read") {
          const pendingTool = tool as AiAssistantToolDto & {
            readonly risk: "write" | "destructive";
          };
          const action = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
            repository.createPendingAssistantAction(scopedDb, {
              toolModuleId: pendingTool.moduleId,
              toolModuleName: pendingTool.moduleName,
              toolName: pendingTool.name,
              permissionId: pendingTool.permissionId,
              risk: pendingTool.risk,
              inputSummary: summarizeAssistantToolInput(body.input ?? {}),
              requestId: accessContext.requestId
            })
          );

          return reply.code(403).send({
            invocation: serializeAssistantToolInvocation(
              pendingTool,
              "blocked",
              null,
              "confirmation_required",
              action.id
            )
          });
        }

        const selectedTool = tool;
        const manifestTool = dependencies
          .listModuleManifests()
          .flatMap((m) => m.assistantTools ?? [])
          .find((t) => t.name === selectedTool.name);

        if (!manifestTool?.execute) {
          return reply.code(403).send({
            invocation: serializeAssistantToolInvocation(
              selectedTool,
              "blocked",
              null,
              "unsupported_tool",
              null
            )
          });
        }

        // Validate caller-supplied input before execution.
        // Invariant: validateToolInput gates every caller-supplied-input execute call on REST paths.
        const validatedInput = validateToolInput(manifestTool.inputSchema, body.input ?? {});
        const result = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          manifestTool.execute!(scopedDb, validatedInput, {
            actorUserId: accessContext.actorUserId,
            requestId: accessContext.requestId ?? "",
            chatSessionId: ""
          }).then((r) => r.data ?? {})
        );

        return {
          invocation: serializeAssistantToolInvocation(
            selectedTool,
            "succeeded",
            result,
            null,
            null
          )
        };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateProviderBody(body: unknown): CreateAiProviderConfigRequest {
  const value = requireObject(body);
  const authMethod = optionalAuthMethod(value.authMethod);

  if (authMethod !== "cli" && value.credentialPayload === undefined) {
    throw new HttpError(400, "credentialPayload is required for api_key auth method");
  }

  return {
    providerKind: requiredProviderKind(value.providerKind, "providerKind"),
    displayName: requiredString(value.displayName, "displayName"),
    baseUrl: optionalNullableString(value.baseUrl, "baseUrl"),
    status: optionalProviderStatus(value.status),
    authMethod,
    credentialPayload:
      value.credentialPayload === undefined
        ? undefined
        : requiredJsonObject(value.credentialPayload, "credentialPayload")
  };
}

function parseUpdateProviderBody(body: unknown): UpdateAiProviderConfigRequest {
  const value = requireObject(body);

  return {
    providerKind: optionalProviderKind(value.providerKind, "providerKind"),
    displayName: optionalString(value.displayName, "displayName"),
    baseUrl: optionalNullableString(value.baseUrl, "baseUrl"),
    status: optionalProviderStatus(value.status),
    authMethod: optionalAuthMethod(value.authMethod),
    credentialPayload:
      value.credentialPayload === undefined
        ? undefined
        : requiredJsonObject(value.credentialPayload, "credentialPayload")
  };
}

function parseCreateModelBody(body: unknown): CreateAiConfiguredModelRequest {
  const value = requireObject(body);

  return {
    providerConfigId: requiredString(value.providerConfigId, "providerConfigId"),
    providerModelId: requiredString(value.providerModelId, "providerModelId"),
    displayName: requiredString(value.displayName, "displayName"),
    capabilities: requiredCapabilities(value.capabilities, "capabilities"),
    status: optionalModelStatus(value.status),
    tier: optionalModelTier(value.tier)
  };
}

function parseUpdateModelBody(body: unknown): UpdateAiConfiguredModelRequest {
  const value = requireObject(body);

  return {
    providerModelId: optionalString(value.providerModelId, "providerModelId"),
    displayName: optionalString(value.displayName, "displayName"),
    capabilities:
      value.capabilities === undefined
        ? undefined
        : requiredCapabilities(value.capabilities, "capabilities"),
    status: optionalModelStatus(value.status),
    tier: optionalModelTier(value.tier)
  };
}

function parseInvokeAssistantToolBody(body: unknown): InvokeAiAssistantToolRequest {
  if (body === undefined) {
    return { input: {} };
  }

  const value = requireObject(body);

  return {
    input: value.input === undefined ? {} : requiredJsonObject(value.input, "input")
  };
}

function parseResolveAssistantActionBody(body: unknown): ResolveAiAssistantActionRequest {
  const value = requireObject(body);

  return {
    status: requiredResolvableAssistantActionStatus(value.status)
  };
}

function requiredResolvableAssistantActionStatus(
  value: unknown
): Exclude<AiAssistantActionStatus, "pending"> {
  if (value === "confirmed" || value === "rejected" || value === "cancelled") {
    return value;
  }

  throw new HttpError(400, "status must be confirmed, rejected, or cancelled");
}

function serializeAssistantToolInvocation(
  tool: AiAssistantToolDto,
  status: AiAssistantToolInvocationDto["status"],
  result: Record<string, unknown> | null,
  blockedReason: AiAssistantToolBlockedReason | null,
  actionRequestId: string | null
): AiAssistantToolInvocationDto {
  return {
    moduleId: tool.moduleId,
    moduleName: tool.moduleName,
    name: tool.name,
    description: tool.description,
    permissionId: tool.permissionId,
    risk: tool.risk,
    status,
    blockedReason,
    actionRequestId,
    result
  };
}

function serializeAssistantAction(action: AiAssistantActionRequestSafeRow): AiAssistantActionDto {
  return {
    id: action.id,
    ownerUserId: action.owner_user_id,
    toolModuleId: action.tool_module_id,
    toolModuleName: action.tool_module_name,
    toolName: action.tool_name,
    permissionId: action.permission_id,
    risk: action.risk,
    status: action.status,
    inputSummary: action.input_summary,
    requestedAt: serializeDate(action.requested_at),
    resolvedAt: toIsoString(action.resolved_at),
    updatedAt: serializeDate(action.updated_at)
  };
}

function summarizeAssistantToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const inputKeys = Object.keys(input).sort();

  return {
    inputKeys,
    inputKeyCount: inputKeys.length
  };
}

async function serializeProvider(provider: AiProviderConfigSafeRow): Promise<AiProviderConfigDto> {
  const isCli = provider.auth_method === "cli";
  const isCliProvider = CLI_PROVIDER_KINDS.has(provider.provider_kind as CliProviderKind);
  const cliAvailableFlag =
    isCli && isCliProvider ? await cliAvailable(provider.provider_kind as CliProviderKind) : false;

  return {
    id: provider.id,
    providerKind: provider.provider_kind,
    displayName: provider.display_name,
    baseUrl: provider.base_url,
    status: provider.status,
    authMethod: provider.auth_method,
    hasCredential: isCli ? false : provider.has_credential,
    cliAvailable: cliAvailableFlag,
    revokedAt: toIsoString(provider.revoked_at),
    createdAt: serializeDate(provider.created_at),
    updatedAt: serializeDate(provider.updated_at)
  };
}

function serializeModel(model: AiConfiguredModelSafeRow): AiConfiguredModelDto {
  return {
    id: model.id,
    providerConfigId: model.provider_config_id,
    providerKind: model.provider_kind,
    providerDisplayName: model.provider_display_name,
    providerStatus: model.provider_status,
    providerModelId: model.provider_model_id,
    displayName: model.display_name,
    capabilities: model.capabilities.map(parseCapability),
    status: model.status,
    tier: model.tier,
    createdAt: serializeDate(model.created_at),
    updatedAt: serializeDate(model.updated_at)
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }

  return value as Record<string, unknown>;
}

function requiredJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value, fieldName);

  if (!parsed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return parsed;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function optionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === null) {
    return null;
  }

  return optionalString(value, fieldName);
}

function requiredProviderKind(value: unknown, fieldName: string): AiProviderKind {
  const providerKind = optionalProviderKind(value, fieldName);

  if (!providerKind) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return providerKind;
}

function optionalProviderKind(value: unknown, fieldName: string): AiProviderKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !AI_PROVIDER_KINDS.has(value as AiProviderKind)) {
    throw new HttpError(400, `${fieldName} is not a supported AI provider kind`);
  }

  return value as AiProviderKind;
}

function optionalAuthMethod(value: unknown): AiAuthMethod | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && AUTH_METHODS.has(value as AiAuthMethod)) {
    return value as AiAuthMethod;
  }

  throw new HttpError(400, "authMethod must be cli or api_key");
}

function optionalProviderStatus(value: unknown): Exclude<AiProviderStatus, "revoked"> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && WRITABLE_PROVIDER_STATUSES.has(value as never)) {
    return value as Exclude<AiProviderStatus, "revoked">;
  }

  throw new HttpError(400, "status must be active, error, or disabled");
}

function optionalModelStatus(value: unknown): AiModelStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && MODEL_STATUSES.has(value as AiModelStatus)) {
    return value as AiModelStatus;
  }

  throw new HttpError(400, "status must be active or disabled");
}

function optionalModelTier(value: unknown): AiModelTier | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && MODEL_TIERS.has(value as AiModelTier)) {
    return value as AiModelTier;
  }

  throw new HttpError(400, "tier must be reasoning, interactive, or economy");
}

function requiredCapabilities(value: unknown, fieldName: string): AiModelCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new HttpError(400, `${fieldName}[${index}] must be a string`);
    }

    return parseCapability(item);
  });
}

function parseCapability(value: string): AiModelCapability {
  if (MODEL_CAPABILITIES.has(value as AiModelCapability)) {
    return value as AiModelCapability;
  }

  throw new HttpError(400, "capability is not supported");
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  if (error instanceof ToolInputValidationError) {
    return reply.code(400).send({ error: error.message });
  }

  if (error instanceof Error) {
    if (error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Invalid bearer token") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Workspace context is unavailable") {
      return reply.code(403).send({ error: error.message });
    }
    if (
      error.message.includes("foreign key") ||
      error.message.includes("violates row-level security policy") ||
      error.message.includes("duplicate key")
    ) {
      return reply.code(400).send({ error: "AI configuration request is invalid" });
    }
  }

  throw error;
}
