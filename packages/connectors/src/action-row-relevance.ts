import type { DataContextDb } from "@moss/db";

export interface ActionRowRelevanceInput {
  readonly ownerUserId: string;
  readonly inferredSubject: string;
}

/** Composition-root seam: connectors receives a boolean, never memory text or excerpts. */
export interface ActionRowRelevancePort {
  hasRelevantContext(scopedDb: DataContextDb, input: ActionRowRelevanceInput): Promise<boolean>;
}

export function normalizedSubjectTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
  );
}

export function sharesSubjectToken(subject: string, text: string): boolean {
  const subjectTokens = normalizedSubjectTokens(subject);
  if (subjectTokens.size === 0) return false;
  return [...normalizedSubjectTokens(text)].some((token) => subjectTokens.has(token));
}
