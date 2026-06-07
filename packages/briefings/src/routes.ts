import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";

import { listAssistantToolsFromManifests } from "@jarv1s/ai";
import type { AccessContext, BriefingDefinition, BriefingRun, DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  createBriefingDefinitionRouteSchema,
  listBriefingDefinitionsRouteSchema,
  listBriefingRunsRouteSchema,
  runBriefingDefinitionRouteSchema,
  updateBriefingDefinitionRouteSchema,
  type BriefingCadence,
  type BriefingDefinitionDto,
  type BriefingRunDto,
  type CreateBriefingDefinitionRequest,
  type RunBriefingDefinitionRequest,
  type UpdateBriefingDefinitionRequest
} from "@jarv1s/shared";

import { type BriefingRunPayload, isBriefingRunPayloadMetadataOnly } from "./jobs.js";
import { BRIEFINGS_RUN_QUEUE } from "./manifest.js";
import { BriefingsRepository } from "./repository.js";

export interface BriefingsRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly boss: PgBoss;
  readonly repository?: BriefingsRepository;
}

interface DefinitionParams {
  readonly id: string;
}

const BRIEFING_CADENCES = new Set<BriefingCadence>(["manual", "daily", "weekly"]);

export function registerBriefingsRoutes(
  server: FastifyInstance,
  dependencies: BriefingsRoutesDependencies
): void {
  const repository = dependencies.repository ?? new BriefingsRepository();

  server.get(
    "/api/briefings/definitions",
    { schema: listBriefingDefinitionsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const definitions = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.listDefinitions(scopedDb)
        );

        return { definitions: definitions.map(serializeDefinition) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/briefings/definitions",
    { schema: createBriefingDefinitionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseCreateDefinitionBody(request.body, dependencies.listModuleManifests());
        const definition = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.createDefinition(scopedDb, input)
        );

        return reply.code(201).send({ definition: serializeDefinition(definition) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: DefinitionParams }>(
    "/api/briefings/definitions/:id",
    { schema: updateBriefingDefinitionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseUpdateDefinitionBody(request.body, dependencies.listModuleManifests());
        const definition = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.updateDefinition(scopedDb, request.params.id, input)
        );

        if (!definition) {
          return reply.code(404).send({ error: "Briefing definition not found" });
        }

        return { definition: serializeDefinition(definition) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: DefinitionParams }>(
    "/api/briefings/definitions/:id/run",
    { schema: runBriefingDefinitionRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = parseRunDefinitionBody(request.body);
        const definition = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.getDefinitionById(scopedDb, request.params.id)
        );

        if (!definition || definition.owner_user_id !== accessContext.actorUserId) {
          return reply.code(404).send({ error: "Briefing definition not found" });
        }

        const runId = randomUUID();
        const payload: BriefingRunPayload = {
          actorUserId: accessContext.actorUserId,
          definitionId: definition.id,
          briefingRunId: runId,
          runKind: "manual",
          idempotencyKey: body.idempotencyKey
        };

        if (!isBriefingRunPayloadMetadataOnly(payload as unknown as Record<string, unknown>)) {
          throw new HttpError(500, "Briefing job payload contains non-metadata fields");
        }

        const jobId = await dependencies.boss.send(BRIEFINGS_RUN_QUEUE, payload);

        if (!jobId) {
          throw new HttpError(500, "Briefing run could not be queued");
        }

        return reply.code(202).send({ jobId, runId });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: DefinitionParams }>(
    "/api/briefings/definitions/:id/runs",
    { schema: listBriefingRunsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const definition = await repository.getDefinitionById(scopedDb, request.params.id);

            return definition
              ? {
                  definition,
                  runs: await repository.listRuns(scopedDb, definition.id)
                }
              : undefined;
          }
        );

        if (!result) {
          return reply.code(404).send({ error: "Briefing definition not found" });
        }

        return { runs: result.runs.map(serializeRun) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}

function parseCreateDefinitionBody(
  body: unknown,
  moduleManifests: readonly JarvisModuleManifest[]
): CreateBriefingDefinitionRequest {
  const value = requireObject(body);
  const selectedToolNames = requiredReadToolNames(
    value.selectedToolNames,
    "selectedToolNames",
    moduleManifests
  );

  return {
    title: requiredString(value.title, "title"),
    cadence: optionalBriefingCadence(value.cadence) ?? "manual",
    scheduleMetadata: optionalJsonObject(value.scheduleMetadata, "scheduleMetadata") ?? {},
    enabled: optionalBoolean(value.enabled, "enabled") ?? true,
    selectedToolNames
  };
}

function parseUpdateDefinitionBody(
  body: unknown,
  moduleManifests: readonly JarvisModuleManifest[]
): UpdateBriefingDefinitionRequest {
  const value = requireObject(body);
  const selectedToolNames =
    value.selectedToolNames === undefined
      ? undefined
      : requiredReadToolNames(value.selectedToolNames, "selectedToolNames", moduleManifests);

  return {
    title: optionalString(value.title, "title"),
    cadence: optionalBriefingCadence(value.cadence),
    scheduleMetadata: optionalJsonObject(value.scheduleMetadata, "scheduleMetadata"),
    enabled: optionalBoolean(value.enabled, "enabled"),
    selectedToolNames
  };
}

function parseRunDefinitionBody(body: unknown): RunBriefingDefinitionRequest {
  if (body === undefined) {
    return {};
  }

  const value = requireObject(body);

  return {
    idempotencyKey: optionalString(value.idempotencyKey, "idempotencyKey")
  };
}

function requiredReadToolNames(
  value: unknown,
  fieldName: string,
  moduleManifests: readonly JarvisModuleManifest[]
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty array`);
  }

  const toolsByName = new Map(
    listAssistantToolsFromManifests(moduleManifests).map((tool) => [tool.name, tool])
  );
  const selectedToolNames = [
    ...new Set(value.map((item, index) => requiredArrayString(item, fieldName, index)))
  ];

  if (selectedToolNames.some((name) => toolsByName.get(name)?.risk !== "read")) {
    throw new HttpError(400, "Briefings can only select declared read-risk assistant tools");
  }

  return selectedToolNames;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
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

function requiredArrayString(value: unknown, fieldName: string, index: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName}[${index}] must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new HttpError(400, `${fieldName}[${index}] must not be empty`);
  }

  return trimmed;
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

function optionalJsonObject(
  value: unknown,
  fieldName: string
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
}

function optionalBriefingCadence(value: unknown): BriefingCadence | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && BRIEFING_CADENCES.has(value as BriefingCadence)) {
    return value as BriefingCadence;
  }

  throw new HttpError(400, "cadence must be manual, daily, or weekly");
}

function serializeDefinition(definition: BriefingDefinition): BriefingDefinitionDto {
  return {
    id: definition.id,
    ownerUserId: definition.owner_user_id,
    title: definition.title,
    cadence: definition.cadence,
    scheduleMetadata: definition.schedule_metadata,
    enabled: definition.enabled,
    selectedToolNames: definition.selected_tool_names,
    lastRunAt: toNullableIsoString(definition.last_run_at),
    createdAt: toIsoString(definition.created_at),
    updatedAt: toIsoString(definition.updated_at)
  };
}

function serializeRun(run: BriefingRun): BriefingRunDto {
  return {
    id: run.id,
    definitionId: run.definition_id,
    ownerUserId: run.owner_user_id,
    status: run.status,
    runKind: run.run_kind,
    summaryText: run.summary_text,
    sourceMetadata: run.source_metadata,
    createdAt: toIsoString(run.created_at)
  };
}

function toNullableIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return toIsoString(value);
}

function toIsoString(value: Date | string): string {
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

  if (error instanceof Error) {
    if (error.message === "Session is missing or expired") {
      return reply.code(401).send({ error: error.message });
    }
    if (error.message === "Invalid bearer token") {
      return reply.code(401).send({ error: error.message });
    }
    if (
      error.message.includes("foreign key") ||
      error.message.includes("violates row-level security policy") ||
      error.message.includes("duplicate key")
    ) {
      return reply.code(400).send({ error: "Briefings request is invalid" });
    }
  }

  throw error;
}
