import type { MemoryCorrection, MemoryFact } from "@jarv1s/memory";
import type { UserMemorySettings } from "./memory-settings-repository.js";

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeSettings(s: UserMemorySettings) {
  return {
    recallEnabled: s.recallEnabled,
    factsEnabled: s.factsEnabled,
    updatedAt: toIsoString(s.updatedAt)
  };
}

export function serializeFact(f: MemoryFact) {
  return {
    id: f.id,
    category: f.category,
    content: f.content,
    importance: f.importance,
    provenance: f.provenance,
    sourceThreadId: f.sourceThreadId,
    createdAt: toIsoString(f.createdAt)
  };
}

export function serializeCorrection(c: MemoryCorrection) {
  return {
    id: c.id,
    category: c.category,
    content: c.content,
    reason: c.reason,
    source: c.source,
    factId: c.factId,
    beforeContent: c.beforeContent,
    afterContent: c.afterContent,
    createdAt: toIsoString(c.createdAt)
  };
}

export function parsePagination(query: unknown): { limit: number; offset: number } {
  const q = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const rawLimit = Number(q.limit ?? 25);
  const rawOffset = Number(q.offset ?? 0);
  return {
    limit: Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25,
    offset: Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0
  };
}

export function parseSettingsPatch(body: unknown): {
  recallEnabled?: boolean;
  factsEnabled?: boolean;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const b = body as Record<string, unknown>;
  const patch: { recallEnabled?: boolean; factsEnabled?: boolean } = {};
  if (typeof b.recallEnabled === "boolean") patch.recallEnabled = b.recallEnabled;
  if (typeof b.factsEnabled === "boolean") patch.factsEnabled = b.factsEnabled;
  return patch;
}
