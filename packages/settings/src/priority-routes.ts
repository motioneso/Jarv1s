/**
 * Priority model API routes.
 *
 * GET /api/me/priority-model - fetch user's priority model
 * PATCH /api/me/priority-model - update with validation
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";
import { PriorityPreferencesRepository } from "@jarv1s/priority";
import { HttpError } from "@jarv1s/module-sdk";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

const VALID_MODES = new Set(["balanced", "deadline_first", "energy_protective"]);
const VALID_SOURCES = new Set(["tasks", "calendar", "email", "notes", "memory", "wellness"]);
const VALID_KINDS = new Set(["project", "person", "domain", "goal", "obligation"]);
const VALID_WEIGHTS = new Set([-2, -1, 0, 1, 2]);
const MODEL_KEYS = new Set(["version", "mode", "anchors", "mutedSources", "updatedAt"]);
const ANCHOR_KEYS = new Set([
  "id",
  "kind",
  "label",
  "aliases",
  "weight",
  "enabled",
  "createdAt",
  "updatedAt"
]);

const KEY = "priority.model.v1";

interface PriorityRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function registerPriorityRoutes(
  server: FastifyInstance,
  dependencies: PriorityRoutesDependencies
): void {
  const repo = new PriorityPreferencesRepository();

  server.get("/api/me/priority-model", async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const model = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => repo.get(await dependencies.preferencesRepository.get(scopedDb, KEY))
      );
      return model;
    } catch (error) {
      return handleSettingsRouteError(error, reply);
    }
  });

  server.patch<{ Body: PriorityModelPreferenceV1 }>(
    "/api/me/priority-model",
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = request.body;
        validateModel(input);
        const model: PriorityModelPreferenceV1 = {
          ...input,
          updatedAt: new Date().toISOString()
        };
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(scopedDb, KEY, model)
        );
        return model;
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

function validateModel(input: unknown): asserts input is PriorityModelPreferenceV1 {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "Invalid model: must be an object");
  }

  const model = input as Record<string, unknown>;

  if (model.version !== 1) {
    throw new HttpError(400, "Invalid model: version must be 1");
  }

  if (typeof model.mode !== "string" || !VALID_MODES.has(model.mode)) {
    throw new HttpError(400, `Invalid mode: must be one of ${Array.from(VALID_MODES).join(", ")}`);
  }

  if (!Array.isArray(model.anchors)) {
    throw new HttpError(400, "Invalid anchors: must be an array");
  }

  if (model.anchors.length > 50) {
    throw new HttpError(400, "Invalid anchors: maximum 50 anchors");
  }

  for (const anchor of model.anchors) {
    if (!anchor || typeof anchor !== "object") {
      throw new HttpError(400, "Invalid anchor: must be an object");
    }
    const a = anchor as Record<string, unknown>;
    const unknownAnchorKeys = Object.keys(a).filter((key) => !ANCHOR_KEYS.has(key));
    if (unknownAnchorKeys.length > 0) {
      throw new HttpError(400, `Unknown anchor keys: ${unknownAnchorKeys.join(", ")}`);
    }

    if (typeof a.id !== "string" || !a.id.trim()) {
      throw new HttpError(400, "Invalid anchor: id required");
    }

    if (typeof a.kind !== "string" || !VALID_KINDS.has(a.kind)) {
      throw new HttpError(
        400,
        `Invalid anchor kind: must be one of ${Array.from(VALID_KINDS).join(", ")}`
      );
    }

    if (typeof a.label !== "string" || a.label.length > 120) {
      throw new HttpError(400, "Invalid anchor label: max 120 characters");
    }

    if (!Array.isArray(a.aliases) || a.aliases.length > 10) {
      throw new HttpError(400, "Invalid anchor aliases: max 10 aliases");
    }

    for (const alias of a.aliases) {
      if (typeof alias !== "string" || alias.length > 80) {
        throw new HttpError(400, "Invalid alias: max 80 characters each");
      }
    }

    if (!VALID_WEIGHTS.has(a.weight as number)) {
      throw new HttpError(
        400,
        `Invalid anchor weight: must be one of ${Array.from(VALID_WEIGHTS).join(", ")}`
      );
    }

    if (typeof a.enabled !== "boolean") {
      throw new HttpError(400, "Invalid anchor: enabled must be boolean");
    }
  }

  if (!Array.isArray(model.mutedSources)) {
    throw new HttpError(400, "Invalid mutedSources: must be an array");
  }

  for (const source of model.mutedSources) {
    if (typeof source !== "string" || !VALID_SOURCES.has(source)) {
      throw new HttpError(
        400,
        `Invalid source: must be one of ${Array.from(VALID_SOURCES).join(", ")}`
      );
    }
  }

  const unknownKeys = Object.keys(model).filter((key) => !MODEL_KEYS.has(key));

  if (unknownKeys.length > 0) {
    throw new HttpError(400, `Unknown keys: ${unknownKeys.join(", ")}`);
  }
}
