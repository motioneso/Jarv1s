/**
 * Priority model preferences repository.
 *
 * Wraps generic PreferencesRepository for priority.model.v1 key with defaults.
 */

import type { PriorityModelPreferenceV1 } from "./types.js";

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

const DEFAULT_MODEL: PriorityModelPreferenceV1 = {
  version: 1,
  mode: "balanced",
  anchors: [],
  mutedSources: [],
  updatedAt: new Date().toISOString()
};

export class PriorityPreferencesRepository {
  get(raw: unknown): PriorityModelPreferenceV1 {
    return isPriorityModel(raw) ? raw : DEFAULT_MODEL;
  }

  defaults(): PriorityModelPreferenceV1 {
    return DEFAULT_MODEL;
  }
}

function isPriorityModel(value: unknown): value is PriorityModelPreferenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  if (Object.keys(model).some((key) => !MODEL_KEYS.has(key))) return false;
  if (model.version !== 1) return false;
  if (typeof model.mode !== "string" || !VALID_MODES.has(model.mode)) return false;
  if (!Array.isArray(model.anchors)) return false;
  if (!Array.isArray(model.mutedSources)) return false;
  if (typeof model.updatedAt !== "string") return false;

  return model.anchors.every(isAnchor) && model.mutedSources.every(isSource);
}

function isAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const anchor = value as Record<string, unknown>;
  if (Object.keys(anchor).some((key) => !ANCHOR_KEYS.has(key))) return false;
  return (
    typeof anchor.id === "string" &&
    typeof anchor.kind === "string" &&
    VALID_KINDS.has(anchor.kind) &&
    typeof anchor.label === "string" &&
    Array.isArray(anchor.aliases) &&
    anchor.aliases.every((alias) => typeof alias === "string") &&
    VALID_WEIGHTS.has(anchor.weight as number) &&
    typeof anchor.enabled === "boolean" &&
    typeof anchor.createdAt === "string" &&
    typeof anchor.updatedAt === "string"
  );
}

function isSource(value: unknown): boolean {
  return typeof value === "string" && VALID_SOURCES.has(value);
}
