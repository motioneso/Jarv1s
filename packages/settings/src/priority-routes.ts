/**
 * Priority model API routes.
 *
 * GET /api/me/priority-model - fetch user's priority model
 * PATCH /api/me/priority-model - update with validation
 */

import type { FastifyInstance } from "fastify";
import { withObjectDataContext } from "@jarv1s/db";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";
import { PriorityPreferencesRepository } from "@jarv1s/priority";
import { handleRouteError } from "@jarv1s/module-sdk";

const VALID_MODES = new Set(["balanced", "deadline_first", "energy_protective"]);
const VALID_SOURCES = new Set(["tasks", "calendar", "email", "notes", "memory", "wellness"]);
const VALID_KINDS = new Set(["project", "person", "domain", "goal", "obligation"]);
const VALID_WEIGHTS = new Set([-2, -1, 0, 1, 2]);

const KEY = "priority.model.v1";

export async function priorityRoutes(app: FastifyInstance): Promise<void> {
  const repo = new PriorityPreferencesRepository();

  app.get("/api/me/priority-model", async (request, reply) => {
    try {
      const model = await withObjectDataContext(async (db) => {
        const raw = await db.appPreferences.get(db, KEY);
        return repo.get(raw);
      });
      return reply.send(model);
    } catch (error) {
      handleRouteError(error, { requestId: request.id });
      throw error;
    }
  });

  app.patch("/api/me/priority-model", async (request, reply) => {
    try {
      const input = request.body as PriorityModelPreferenceV1;
      validateModel(input);
      const model: PriorityModelPreferenceV1 = {
        ...input,
        updatedAt: new Date().toISOString()
      };
      await withObjectDataContext(async (db) => {
        await db.appPreferences.upsert(db, KEY, model);
      });
      return reply.send(model);
    } catch (error) {
      handleRouteError(error, { requestId: request.id });
      throw error;
    }
  });
}

function validateModel(input: unknown): asserts input is PriorityModelPreferenceV1 {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid model: must be an object");
  }

  const model = input as Record<string, unknown>;

  if (model.version !== 1) {
    throw new Error("Invalid model: version must be 1");
  }

  if (typeof model.mode !== "string" || !VALID_MODES.has(model.mode)) {
    throw new Error(`Invalid mode: must be one of ${Array.from(VALID_MODES).join(", ")}`);
  }

  if (!Array.isArray(model.anchors)) {
    throw new Error("Invalid anchors: must be an array");
  }

  if (model.anchors.length > 50) {
    throw new Error("Invalid anchors: maximum 50 anchors");
  }

  for (const anchor of model.anchors) {
    if (!anchor || typeof anchor !== "object") {
      throw new Error("Invalid anchor: must be an object");
    }
    const a = anchor as Record<string, unknown>;

    if (typeof a.id !== "string" || !a.id.trim()) {
      throw new Error("Invalid anchor: id required");
    }

    if (typeof a.kind !== "string" || !VALID_KINDS.has(a.kind)) {
      throw new Error(`Invalid anchor kind: must be one of ${Array.from(VALID_KINDS).join(", ")}`);
    }

    if (typeof a.label !== "string" || a.label.length > 120) {
      throw new Error("Invalid anchor label: max 120 characters");
    }

    if (!Array.isArray(a.aliases) || a.aliases.length > 10) {
      throw new Error("Invalid anchor aliases: max 10 aliases");
    }

    for (const alias of a.aliases) {
      if (typeof alias !== "string" || alias.length > 80) {
        throw new Error("Invalid alias: max 80 characters each");
      }
    }

    if (!VALID_WEIGHTS.has(a.weight as number)) {
      throw new Error(`Invalid anchor weight: must be one of ${Array.from(VALID_WEIGHTS).join(", ")}`);
    }

    if (typeof a.enabled !== "boolean") {
      throw new Error("Invalid anchor: enabled must be boolean");
    }
  }

  if (!Array.isArray(model.mutedSources)) {
    throw new Error("Invalid mutedSources: must be an array");
  }

  for (const source of model.mutedSources) {
    if (typeof source !== "string" || !VALID_SOURCES.has(source)) {
      throw new Error(`Invalid source: must be one of ${Array.from(VALID_SOURCES).join(", ")}`);
    }
  }

  const unknownKeys = Object.keys(model).filter(
    (k) => !["version", "mode", "anchors", "mutedSources", "updatedAt"].includes(k)
  );

  if (unknownKeys.length > 0) {
    throw new Error(`Unknown keys: ${unknownKeys.join(", ")}`);
  }
}
