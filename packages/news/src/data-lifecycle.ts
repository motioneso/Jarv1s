import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ModuleLifecycleContext } from "@jarv1s/module-sdk";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
type ExportRow = Record<string, JsonValue>;

export interface NewsExportSectionData {
  readonly custom_sources: readonly ExportRow[];
  readonly custom_topics: readonly ExportRow[];
  readonly source_exclusions: readonly ExportRow[];
}

/**
 * Collects the `sections.newsPersonalization` full-account export section (#953 Task 6).
 * Exports only user-authored preference rows: custom sources, custom topics, and source
 * exclusions. Two deliberate omissions, both pinned by tests/integration/data-export.test.ts:
 *
 *   - `validation_fingerprint` (custom sources/topics) is an opaque revalidation marker, not
 *     user-authored data — the explicit column lists below are the exclusion mechanism, same
 *     as the repository's DTO reads (never SELECT *).
 *   - `app.news_compilation_snapshots` is derived/transient cache, never exported (spec:
 *     exportable-never); it is deleted with the user via dataLifecycle.deletion instead.
 *
 * Runs under the actor's own DataContextDb, so FORCE RLS owner-only policies bound the reads;
 * the owner_user_id predicate mirrors the wellness collector's belt-and-braces filtering.
 */
export async function collectNewsExportSection(
  scopedDb: unknown,
  ctx: ModuleLifecycleContext
): Promise<NewsExportSectionData> {
  assertDataContextDb(scopedDb as DataContextDb);
  const db = (scopedDb as DataContextDb).db;
  const userId = ctx.actorUserId;

  const customSources = await sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      label,
      canonical_domain AS "canonicalDomain",
      homepage_url AS "homepageUrl",
      feed_url AS "feedUrl",
      retrieval_method AS "retrievalMethod",
      validation_status AS "validationStatus",
      health_status AS "healthStatus",
      validated_at AS "validatedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.news_custom_sources
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id
  `.execute(db);

  const customTopics = await sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      label,
      guidance,
      validation_status AS "validationStatus",
      validated_at AS "validatedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.news_custom_topics
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id
  `.execute(db);

  const sourceExclusions = await sql<Record<string, unknown>>`
    SELECT
      id::text AS id,
      owner_user_id::text AS "ownerUserId",
      canonical_domain AS "canonicalDomain",
      created_at AS "createdAt"
    FROM app.news_source_exclusions
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at DESC, id
  `.execute(db);

  return {
    custom_sources: customSources.rows.map(normalizeRow),
    custom_topics: customTopics.rows.map(normalizeRow),
    source_exclusions: sourceExclusions.rows.map(normalizeRow)
  };
}

// Duplicated from packages/settings/src/data-export.ts's normalizeRow/normalizeValue (same
// rationale as packages/wellness/src/data-lifecycle.ts): no shared utility package exists,
// and importing @jarv1s/settings from a module (or vice versa) would create a package cycle.
function normalizeRow(row: Record<string, unknown>): ExportRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  ) as ExportRow;
}

function normalizeValue(value: unknown): JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalizeValue(nested)
      ])
    );
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  return String(value);
}
