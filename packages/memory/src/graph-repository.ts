import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type {
  MemoryAliasRecord,
  MemoryEntityKind,
  MemoryEntityRecord,
  MemoryEntityStatus,
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
  async ensureSelfEntity(scopedDb: DataContextDb, ownerUserId: string): Promise<MemoryEntityRecord> {
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
    await this.upsertSearchDocument(
      scopedDb,
      ownerUserId,
      "episode",
      source.id,
      source.excerpt
    );

    return mapFact(factRow, [mapSource(source)]);
  }

  async upsertSearchDocument(
    scopedDb: DataContextDb,
    ownerUserId: string,
    targetKind: MemorySearchTargetKind,
    targetId: string,
    searchText: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
      INSERT INTO app.memory_search_documents (
        owner_user_id,
        target_kind,
        target_id,
        search_text,
        status,
        updated_at
      )
      VALUES (${ownerUserId}::uuid, ${targetKind}, ${targetId}::uuid, ${searchText}, 'active', now())
      ON CONFLICT (owner_user_id, target_kind, target_id) DO UPDATE SET
        search_text = EXCLUDED.search_text,
        status = 'active',
        updated_at = now()
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
}

function normalizeAlias(alias: string): string {
  return alias.trim().toLocaleLowerCase();
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
