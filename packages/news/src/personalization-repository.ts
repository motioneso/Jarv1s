// packages/news/src/personalization-repository.ts
// #953 Task 3 — DataContext-only persistence for the four personalization tables
// (0159_news_personalization.sql). Every method asserts the branded DataContextDb, so all
// SQL runs under the actor's RLS GUC: owner isolation is enforced by Postgres, not by
// WHERE clauses here. Custom source/topic WRITES are deliberately absent — Slice 2 owns
// them behind its validation pipeline; Slice 1 only reads/exports what exists.
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type {
  NewsCustomSourceDto,
  NewsCustomTopicDto,
  NewsSourceExclusionDto
} from "@jarv1s/shared";

import { assertSnapshotPayload } from "./personalization-domain.js";

/** Spec cap: at most 100 excluded domains per owner, enforced atomically in SQL. */
export const NEWS_MAX_SOURCE_EXCLUSIONS = 100;

export type NewsPersonalizationLimitResource = "source_exclusions";

/** Typed domain error so routes can map cap violations to a 4xx instead of a 500. */
export class NewsPersonalizationLimitError extends Error {
  constructor(
    readonly resource: NewsPersonalizationLimitResource,
    readonly limit: number
  ) {
    super(`news personalization limit reached: at most ${limit} ${resource} per user`);
    this.name = "NewsPersonalizationLimitError";
  }
}

/** Module-private snapshot record; the payload never crosses the module's public API. */
export interface NewsSnapshotRecord {
  readonly compiledAt: Date;
  readonly expiresAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface ReplaceSnapshotInput {
  readonly compiledAt: Date;
  readonly expiresAt: Date;
  readonly payload: unknown;
}

const EXCLUSION_COLUMNS = ["id", "canonical_domain", "created_at"] as const;

export class NewsPersonalizationRepository {
  async listCustomSources(scopedDb: DataContextDb): Promise<NewsCustomSourceDto[]> {
    assertDataContextDb(scopedDb);
    // validation_fingerprint is intentionally never selected: the opaque revalidation
    // marker must not exist on the DTO at all (see the shared contract).
    const rows = await scopedDb.db
      .selectFrom("app.news_custom_sources")
      .select([
        "id",
        "label",
        "canonical_domain",
        "homepage_url",
        "feed_url",
        "retrieval_method",
        "validation_status",
        "health_status",
        "created_at"
      ])
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      canonicalDomain: row.canonical_domain,
      homepageUrl: row.homepage_url,
      feedUrl: row.feed_url,
      retrievalMethod: row.retrieval_method,
      validationStatus: row.validation_status,
      healthStatus: row.health_status,
      createdAt: row.created_at.toISOString()
    }));
  }

  async countCustomSources(scopedDb: DataContextDb): Promise<number> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.news_custom_sources")
      .select(({ fn }) => fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async listCustomTopics(scopedDb: DataContextDb): Promise<NewsCustomTopicDto[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.news_custom_topics")
      .select(["id", "label", "guidance", "validation_status", "created_at"])
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      guidance: row.guidance,
      validationStatus: row.validation_status,
      createdAt: row.created_at.toISOString()
    }));
  }

  async countCustomTopics(scopedDb: DataContextDb): Promise<number> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.news_custom_topics")
      .select(({ fn }) => fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async listExclusions(scopedDb: DataContextDb): Promise<NewsSourceExclusionDto[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.news_source_exclusions")
      .select([...EXCLUSION_COLUMNS])
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(toExclusionDto);
  }

  /**
   * Idempotent, cap-guarded create. The count guard lives INSIDE the insert statement
   * (RLS scopes it to the actor's rows), so cap enforcement is atomic — no
   * count-then-insert race can overshoot it. `canonicalDomain` must already be the
   * output of normalizePublisherDomain; the table CHECKs are defense-in-depth only.
   */
  async createExclusion(
    scopedDb: DataContextDb,
    canonicalDomain: string
  ): Promise<NewsSourceExclusionDto> {
    assertDataContextDb(scopedDb);
    const inserted = await scopedDb.db
      .insertInto("app.news_source_exclusions")
      .columns(["owner_user_id", "canonical_domain"])
      .expression((eb) =>
        eb
          .selectFrom(sql`(SELECT 1)`.as("one"))
          .select([
            sql<string>`app.current_actor_user_id()`.as("owner_user_id"),
            sql<string>`${canonicalDomain}`.as("canonical_domain")
          ])
          .where(
            sql<boolean>`(SELECT count(*) FROM app.news_source_exclusions) < ${sql.lit(
              NEWS_MAX_SOURCE_EXCLUSIONS
            )}`
          )
      )
      .onConflict((oc) => oc.columns(["owner_user_id", "canonical_domain"]).doNothing())
      .returning([...EXCLUSION_COLUMNS])
      .executeTakeFirst();
    if (inserted) return toExclusionDto(inserted);

    // No row back means duplicate (conflict) or cap reached — the duplicate case must
    // stay idempotent even when the owner is at the cap, so check for it first.
    const existing = await scopedDb.db
      .selectFrom("app.news_source_exclusions")
      .select([...EXCLUSION_COLUMNS])
      .where("canonical_domain", "=", canonicalDomain)
      .executeTakeFirst();
    if (existing) return toExclusionDto(existing);

    throw new NewsPersonalizationLimitError("source_exclusions", NEWS_MAX_SOURCE_EXCLUSIONS);
  }

  async removeExclusion(scopedDb: DataContextDb, id: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .deleteFrom("app.news_source_exclusions")
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  async readLatestSnapshot(scopedDb: DataContextDb): Promise<NewsSnapshotRecord | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.news_compilation_snapshots")
      .select(["compiled_at", "expires_at", "payload"])
      .executeTakeFirst();
    if (!row) return null;
    return { compiledAt: row.compiled_at, expiresAt: row.expires_at, payload: row.payload };
  }

  /**
   * Atomic per-owner replace (single upsert on the owner_user_id primary key). The
   * payload guard runs BEFORE any SQL so an over-cap or non-JSON payload can never
   * clobber the stored snapshot.
   */
  async replaceLatestSnapshot(scopedDb: DataContextDb, input: ReplaceSnapshotInput): Promise<void> {
    assertSnapshotPayload(input.payload);
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.news_compilation_snapshots")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        compiled_at: input.compiledAt,
        expires_at: input.expiresAt,
        payload: sql`${JSON.stringify(input.payload)}::jsonb`
      })
      .onConflict((oc) =>
        oc.column("owner_user_id").doUpdateSet({
          compiled_at: (eb) => eb.ref("excluded.compiled_at"),
          expires_at: (eb) => eb.ref("excluded.expires_at"),
          payload: (eb) => eb.ref("excluded.payload"),
          updated_at: sql`now()`
        })
      )
      .execute();
  }
}

function toExclusionDto(row: {
  id: string;
  canonical_domain: string;
  created_at: Date;
}): NewsSourceExclusionDto {
  return {
    id: row.id,
    canonicalDomain: row.canonical_domain,
    createdAt: row.created_at.toISOString()
  };
}
