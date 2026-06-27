import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type {
  MemoryAliasRecord,
  MemoryEntityKind,
  MemoryEntityRecord,
  MemoryEntityStatus,
  MemoryFactRecallCandidate,
  MemoryEpisodeKind,
  MemoryFactPredicate,
  MemoryFactProvenance,
  MemoryFactRecord,
  MemoryFactStatus,
  MemorySearchDocumentRecord,
  MemorySearchTargetKind,
  MemorySourceSummary,
  NewMemoryEntity,
  NewMemoryFact
} from "./graph-types.js";

interface EntityRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly kind: MemoryEntityKind;
  readonly name: string;
  readonly summary: string;
  readonly status: MemoryEntityStatus;
  readonly importance: string | number;
  readonly pinned: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface FactRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly subject_entity_id: string;
  readonly predicate: MemoryFactPredicate;
  readonly object_entity_id: string | null;
  readonly object_text: string | null;
  readonly confidence: string | number;
  readonly provenance: MemoryFactProvenance;
  readonly status: MemoryFactStatus;
  readonly valid_from: Date | null;
  readonly valid_to: Date | null;
  readonly last_confirmed_at: Date | null;
  readonly importance: string | number;
  readonly pinned: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface SourceRow {
  readonly id: string;
  readonly source_kind: MemoryEpisodeKind;
  readonly source_ref: string;
  readonly source_label: string;
  readonly occurred_at: Date | null;
  readonly excerpt: string;
}

export class MemoryGraphRepository {
  async ensureSelfEntity(
    scopedDb: DataContextDb,
    ownerUserId: string
  ): Promise<MemoryEntityRecord> {
    assertDataContextDb(scopedDb);
    await sql`
      INSERT INTO app.memory_entities (owner_user_id, kind, name, summary)
      VALUES (${ownerUserId}::uuid, 'self', 'Self', 'Owner self memory root')
      ON CONFLICT (owner_user_id) WHERE kind = 'self' DO NOTHING
    `.execute(scopedDb.db);

    const result = await sql<EntityRow>`
      SELECT *
      FROM app.memory_entities
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND kind = 'self'
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("self memory entity was not created");
    return mapEntity(row);
  }

  async createEntity(
    scopedDb: DataContextDb,
    ownerUserId: string,
    input: NewMemoryEntity
  ): Promise<MemoryEntityRecord> {
    assertDataContextDb(scopedDb);
    const result = await sql<EntityRow>`
      INSERT INTO app.memory_entities (
        owner_user_id,
        kind,
        name,
        summary,
        importance,
        pinned
      )
      VALUES (
        ${ownerUserId}::uuid,
        ${input.kind},
        ${input.name},
        ${input.summary ?? ""},
        ${input.importance ?? 0.5},
        ${input.pinned ?? false}
      )
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("createEntity returned no row");
    const entity = mapEntity(row);
    await this.upsertSearchDocument(
      scopedDb,
      ownerUserId,
      "entity",
      entity.id,
      `${entity.name} ${entity.summary}`.trim()
    );
    return entity;
  }

  async addAlias(
    scopedDb: DataContextDb,
    ownerUserId: string,
    entityId: string,
    alias: string,
    ambiguous: boolean
  ): Promise<MemoryAliasRecord> {
    assertDataContextDb(scopedDb);
    const normalizedAlias = normalizeAlias(alias);
    const result = await sql<{
      id: string;
      owner_user_id: string;
      entity_id: string;
      alias: string;
      normalized_alias: string;
      ambiguous: boolean;
      created_at: Date;
      updated_at: Date;
    }>`
      INSERT INTO app.memory_aliases (
        owner_user_id,
        entity_id,
        alias,
        normalized_alias,
        ambiguous
      )
      VALUES (${ownerUserId}::uuid, ${entityId}::uuid, ${alias}, ${normalizedAlias}, ${ambiguous})
      RETURNING *
    `.execute(scopedDb.db);

    const row = result.rows[0];
    if (!row) throw new Error("addAlias returned no row");
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      entityId: row.entity_id,
      alias: row.alias,
      normalizedAlias: row.normalized_alias,
      ambiguous: row.ambiguous,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async createFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    input: NewMemoryFact
  ): Promise<MemoryFactRecord> {
    assertDataContextDb(scopedDb);
    if (Boolean(input.objectEntityId) === Boolean(input.objectText)) {
      throw new Error("memory fact requires exactly one object target");
    }

    const factResult = await sql<FactRow>`
      INSERT INTO app.memory_facts (
        owner_user_id,
        subject_entity_id,
        predicate,
        object_entity_id,
        object_text,
        confidence,
        provenance,
        importance,
        pinned
      )
      VALUES (
        ${ownerUserId}::uuid,
        ${input.subjectEntityId}::uuid,
        ${input.predicate},
        ${input.objectEntityId ?? null}::uuid,
        ${input.objectText ?? null},
        ${input.confidence ?? 0.6},
        ${input.provenance ?? "inferred"},
        ${input.importance ?? 0.5},
        ${input.pinned ?? false}
      )
      RETURNING *
    `.execute(scopedDb.db);
    const factRow = factResult.rows[0];
    if (!factRow) throw new Error("createFact returned no row");

    const episodeResult = await sql<SourceRow>`
      INSERT INTO app.memory_episodes (
        owner_user_id,
        source_kind,
        source_ref,
        source_label,
        occurred_at,
        excerpt
      )
      VALUES (
        ${ownerUserId}::uuid,
        ${input.source.sourceKind},
        ${input.source.sourceRef},
        ${input.source.sourceLabel ?? ""},
        ${input.source.occurredAt ?? null},
        ${input.source.excerpt}
      )
      RETURNING id, source_kind, source_ref, source_label, occurred_at, excerpt
    `.execute(scopedDb.db);
    const source = episodeResult.rows[0];
    if (!source) throw new Error("createFact source insert returned no row");

    await sql`
      INSERT INTO app.memory_fact_sources (owner_user_id, fact_id, episode_id)
      VALUES (${ownerUserId}::uuid, ${factRow.id}::uuid, ${source.id}::uuid)
    `.execute(scopedDb.db);

    await this.upsertSearchDocument(
      scopedDb,
      ownerUserId,
      "fact",
      factRow.id,
      [factRow.predicate, factRow.object_text].filter(Boolean).join(" ")
    );
    await this.upsertSearchDocument(scopedDb, ownerUserId, "episode", source.id, source.excerpt);

    return mapFact(factRow, [mapSource(source)]);
  }

  async upsertSearchDocument(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: MemorySearchTargetKind,
    targetId: string,
    searchText: string,
    embedding?: readonly number[],
    embedModelName?: string,
    embedModelVersion?: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    const vectorSql = embedding ? sql`${toVectorLiteral(embedding)}::vector` : sql`NULL`;
    await sql`
      INSERT INTO app.memory_search_documents (
        owner_user_id,
        target_kind,
        target_id,
        search_text,
        embedding,
        embed_model_name,
        embed_model_version,
        status,
        updated_at
      )
      VALUES (
        ${ownerUserId}::uuid,
        ${targetKind},
        ${targetId}::uuid,
        ${searchText},
        ${vectorSql},
        ${embedModelName ?? null},
        ${embedModelVersion ?? null},
        'active',
        now()
      )
      ON CONFLICT (owner_user_id, target_kind, target_id) DO UPDATE SET
        search_text = EXCLUDED.search_text,
        embedding = EXCLUDED.embedding,
        embed_model_name = EXCLUDED.embed_model_name,
        embed_model_version = EXCLUDED.embed_model_version,
        status = 'active',
        updated_at = now()
    `.execute(scopedDb.db);
  }

  async deactivateSearchDocument(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: MemorySearchTargetKind,
    targetId: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
      UPDATE app.memory_search_documents
      SET status = 'inactive', updated_at = now()
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND target_kind = ${targetKind}
        AND target_id = ${targetId}::uuid
    `.execute(scopedDb.db);
  }

  async listSearchDocumentsForOwner(
    scopedDb: DataContextDb,
    ownerUserId: string
  ): Promise<MemorySearchDocumentRecord[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<{
      id: string;
      owner_user_id: string;
      target_kind: MemorySearchTargetKind;
      target_id: string;
      search_text: string;
      embed_model_name: string | null;
      embed_model_version: string | null;
      status: "active" | "inactive";
      created_at: Date;
      updated_at: Date;
    }>`
      SELECT id,
             owner_user_id,
             target_kind,
             target_id,
             search_text,
             embed_model_name,
             embed_model_version,
             status,
             created_at,
             updated_at
      FROM app.memory_search_documents
      WHERE owner_user_id = ${ownerUserId}::uuid
      ORDER BY created_at, id
    `.execute(scopedDb.db);

    return result.rows.map((row) => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      searchText: row.search_text,
      embedModelName: row.embed_model_name,
      embedModelVersion: row.embed_model_version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async listFactRecallCandidates(
    scopedDb: DataContextDb,
    ownerUserId: string,
    queryEmbedding: readonly number[],
    options: { readonly includeInactive?: boolean } = {}
  ): Promise<MemoryFactRecallCandidate[]> {
    assertDataContextDb(scopedDb);
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const result = await sql<
      FactRow & {
        search_text: string | null;
        vector_similarity: string | number | null;
      }
    >`
      SELECT f.*,
             d.search_text,
             CASE
               WHEN d.embedding IS NULL THEN 0
               ELSE 1 - (d.embedding <=> ${vectorLiteral}::vector)
             END AS vector_similarity
      FROM app.memory_facts f
      LEFT JOIN app.memory_search_documents d
        ON d.owner_user_id = f.owner_user_id
       AND d.target_kind = 'fact'
       AND d.target_id = f.id
       AND d.status = 'active'
      WHERE f.owner_user_id = ${ownerUserId}::uuid
        AND (
          ${options.includeInactive ?? false}
          OR (
            f.status = 'active'
            AND (f.valid_to IS NULL OR f.valid_to > now())
          )
        )
      ORDER BY f.pinned DESC, f.importance DESC, f.updated_at DESC
      LIMIT 100
    `.execute(scopedDb.db);

    return Promise.all(
      result.rows.map(async (row) => ({
        fact: mapFact(row, await this.listSourcesForFact(scopedDb, ownerUserId, row.id)),
        searchText: row.search_text ?? [row.predicate, row.object_text].filter(Boolean).join(" "),
        vectorSimilarity: clamp01(Number(row.vector_similarity ?? 0))
      }))
    );
  }

  async listCoreFacts(
    scopedDb: DataContextDb,
    ownerUserId: string,
    limit: number
  ): Promise<MemoryFactRecord[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<FactRow>`
      SELECT *
      FROM app.memory_facts
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND status = 'active'
        AND (valid_to IS NULL OR valid_to > now())
        AND (pinned = true OR provenance IN ('confirmed', 'volunteered'))
      ORDER BY pinned DESC, importance DESC, last_confirmed_at DESC NULLS LAST, updated_at DESC
      LIMIT ${limit}
    `.execute(scopedDb.db);

    return Promise.all(
      result.rows.map(async (row) =>
        mapFact(row, await this.listSourcesForFact(scopedDb, ownerUserId, row.id))
      )
    );
  }

  async supersedeFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    factId: string,
    validTo: Date | null = new Date()
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ id: string }>`
      UPDATE app.memory_facts
      SET status = 'superseded',
          valid_to = ${validTo},
          updated_at = now()
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${factId}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    if (result.rows.length > 0) {
      await this.deactivateSearchDocument(scopedDb, ownerUserId, "fact", factId);
    }
    return result.rows.length > 0;
  }

  async forgetFact(scopedDb: DataContextDb, ownerUserId: string, factId: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    await this.deactivateSearchDocument(scopedDb, ownerUserId, "fact", factId);
    const result = await sql<{ id: string }>`
      DELETE FROM app.memory_facts
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${factId}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }

  async pinFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    factId: string,
    pinned: boolean
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ id: string }>`
      UPDATE app.memory_facts
      SET pinned = ${pinned}, updated_at = now()
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${factId}::uuid
      RETURNING id
    `.execute(scopedDb.db);
    return result.rows.length > 0;
  }

  private async listSourcesForFact(
    scopedDb: DataContextDb,
    ownerUserId: string,
    factId: string
  ): Promise<MemorySourceSummary[]> {
    const result = await sql<SourceRow>`
      SELECT e.id, e.source_kind, e.source_ref, e.source_label, e.occurred_at, e.excerpt
      FROM app.memory_episodes e
      JOIN app.memory_fact_sources s
        ON s.owner_user_id = e.owner_user_id
       AND s.episode_id = e.id
      WHERE s.owner_user_id = ${ownerUserId}::uuid
        AND s.fact_id = ${factId}::uuid
      ORDER BY e.occurred_at DESC NULLS LAST, e.created_at DESC
    `.execute(scopedDb.db);
    return result.rows.map(mapSource);
  }
}

function normalizeAlias(alias: string): string {
  return alias.trim().toLocaleLowerCase();
}

function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function mapEntity(row: EntityRow): MemoryEntityRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    status: row.status,
    importance: Number(row.importance),
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFact(row: FactRow, sources: readonly MemorySourceSummary[]): MemoryFactRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    subjectEntityId: row.subject_entity_id,
    predicate: row.predicate,
    objectEntityId: row.object_entity_id,
    objectText: row.object_text,
    confidence: Number(row.confidence),
    provenance: row.provenance,
    status: row.status,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    lastConfirmedAt: row.last_confirmed_at,
    importance: Number(row.importance),
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sources
  };
}

function mapSource(row: SourceRow): MemorySourceSummary {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    occurredAt: row.occurred_at,
    excerpt: row.excerpt
  };
}
