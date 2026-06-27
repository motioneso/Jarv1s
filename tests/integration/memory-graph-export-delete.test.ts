import { describe, expect, it } from "vitest";
import pg from "pg";

import { deleteUserData } from "../../scripts/delete-user-data.js";
import { exportUserData } from "../../scripts/export-user-data.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const graphIds = {
  chatMemoryFact: "88000000-0000-4000-8000-000000000001",
  aEntity: "88000000-0000-4000-8000-000000000002",
  aFact: "88000000-0000-4000-8000-000000000003",
  aEpisode: "88000000-0000-4000-8000-000000000004",
  aAlias: "88000000-0000-4000-8000-000000000005",
  aSearchDocument: "88000000-0000-4000-8000-000000000006",
  bEntity: "88000000-0000-4000-8000-000000000007",
  bFact: "88000000-0000-4000-8000-000000000008",
  bEpisode: "88000000-0000-4000-8000-000000000009",
  aCandidate: "88000000-0000-4000-8000-000000000010",
  bCandidate: "88000000-0000-4000-8000-000000000011",
  aConflictGroup: "88000000-0000-4000-8000-000000000012",
  bConflictGroup: "88000000-0000-4000-8000-000000000013"
} as const;

describe("memory graph export and deletion", () => {
  it("exports graph tables without embeddings and deletes only the target owner", async () => {
    await resetFoundationDatabase();
    await seedMemoryGraphRows();

    const userExport = await exportUserData({
      appConnectionString: connectionStrings.app,
      exportedAt: new Date("2026-06-26T12:00:00.000Z"),
      userId: ids.userA
    });
    const exportedJson = JSON.stringify(userExport);

    expect(userExport.tables.memoryEntities).toEqual([
      expect.objectContaining({
        id: graphIds.aEntity,
        kind: "project",
        name: "Graph export project"
      })
    ]);
    expect(userExport.tables.memoryFacts).toEqual([
      expect.objectContaining({
        id: graphIds.aFact,
        predicate: "has_constraint",
        objectText: "graph budget sentinel",
        recordKind: "constraint",
        staleAt: null,
        supersededByFactId: null,
        conflictGroupId: null
      })
    ]);
    expect(userExport.tables.memoryConflictGroups).toEqual([
      expect.objectContaining({
        id: graphIds.aConflictGroup,
        status: "open"
      })
    ]);
    expect(userExport.tables.memoryEpisodes).toEqual([
      expect.objectContaining({
        id: graphIds.aEpisode,
        sourceKind: "manual",
        excerpt: "graph source excerpt sentinel"
      })
    ]);
    expect(userExport.tables.memoryFactSources).toEqual([
      expect.objectContaining({
        factId: graphIds.aFact,
        episodeId: graphIds.aEpisode
      })
    ]);
    expect(userExport.tables.memoryAliases).toEqual([
      expect.objectContaining({
        id: graphIds.aAlias,
        alias: "graph project"
      })
    ]);
    expect(userExport.tables.memorySearchDocuments).toEqual([
      expect.objectContaining({
        id: graphIds.aSearchDocument,
        targetKind: "fact",
        searchText: "graph budget sentinel"
      })
    ]);
    expect(userExport.tables.memoryLegacyFactMigrations).toEqual([
      expect.objectContaining({
        legacyFactId: graphIds.chatMemoryFact,
        memoryFactId: graphIds.aFact
      })
    ]);
    expect(userExport.tables.memoryCandidates).toEqual([
      expect.objectContaining({
        id: graphIds.aCandidate,
        kind: "fact",
        candidateSignature: "candidate-a"
      })
    ]);
    expect(Object.keys(userExport.tables.memorySearchDocuments[0] ?? {})).not.toContain(
      "embedding"
    );
    expect(exportedJson).not.toContain("User B graph memory");

    const dryRun = await deleteUserData({
      actorUserId: ids.userB,
      bootstrapConnectionString: connectionStrings.bootstrap,
      dryRun: true,
      userId: ids.userA
    });
    expect(dryRun.countsBeforeDelete["app.memory_entities"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_facts"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_episodes"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_fact_sources"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_aliases"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_search_documents"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_legacy_fact_migrations"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_conflict_groups"]).toBeGreaterThan(0);
    expect(dryRun.countsBeforeDelete["app.memory_candidates"]).toBeGreaterThan(0);

    const deleted = await deleteUserData({
      actorUserId: ids.userB,
      bootstrapConnectionString: connectionStrings.bootstrap,
      confirmUserId: ids.userA,
      dryRun: false,
      userId: ids.userA
    });
    const counts = await readMemoryGraphCounts();

    expect(deleted.deleted).toBe(true);
    expect(counts.userAGraphRows).toBe(0);
    expect(counts.userBGraphRows).toBeGreaterThan(0);
  });
});

async function seedMemoryGraphRows(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.chat_memory_facts (id, owner_user_id, category, content, importance)
        VALUES ($1, $2, 'fact', 'user likes coffee', 0.80)
      `,
      [graphIds.chatMemoryFact, ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.memory_entities (id, owner_user_id, kind, name, summary)
        VALUES
          ($1, $2, 'project', 'Graph export project', 'exported graph project'),
          ($3, $4, 'project', 'User B graph project', 'private graph project')
      `,
      [graphIds.aEntity, ids.userA, graphIds.bEntity, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.memory_conflict_groups (owner_user_id, id, status)
        VALUES
          ($1, $2, 'open'),
          ($3, $4, 'open')
      `,
      [ids.userA, graphIds.aConflictGroup, ids.userB, graphIds.bConflictGroup]
    );
    await client.query(
      `
        INSERT INTO app.memory_facts (
          id,
          owner_user_id,
          subject_entity_id,
          predicate,
          object_text,
          record_kind,
          confidence,
          provenance,
          conflict_group_id,
          importance
        )
        VALUES
          ($1, $2, $3, 'has_constraint', 'graph budget sentinel', 'constraint', 0.95, 'confirmed', NULL, 0.80),
          ($4, $5, $6, 'related_to', 'User B graph memory', 'relationship', 0.95, 'confirmed', NULL, 0.80)
      `,
      [graphIds.aFact, ids.userA, graphIds.aEntity, graphIds.bFact, ids.userB, graphIds.bEntity]
    );
    await client.query(
      `
        INSERT INTO app.memory_episodes (
          id,
          owner_user_id,
          source_kind,
          source_ref,
          source_label,
          excerpt
        )
        VALUES
          ($1, $2, 'manual', 'manual:export-a', 'Export seed', 'graph source excerpt sentinel'),
          ($3, $4, 'manual', 'manual:export-b', 'Export seed', 'User B graph memory')
      `,
      [graphIds.aEpisode, ids.userA, graphIds.bEpisode, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.memory_fact_sources (owner_user_id, fact_id, episode_id)
        VALUES
          ($1, $2, $3),
          ($4, $5, $6)
      `,
      [ids.userA, graphIds.aFact, graphIds.aEpisode, ids.userB, graphIds.bFact, graphIds.bEpisode]
    );
    await client.query(
      `
        INSERT INTO app.memory_aliases (id, owner_user_id, entity_id, alias, normalized_alias)
        VALUES ($1, $2, $3, 'graph project', 'graph project')
      `,
      [graphIds.aAlias, ids.userA, graphIds.aEntity]
    );
    await client.query(
      `
        INSERT INTO app.memory_search_documents (
          id,
          owner_user_id,
          target_kind,
          target_id,
          search_text,
          embed_model_name,
          embed_model_version
        )
        VALUES ($1, $2, 'fact', $3, 'graph budget sentinel', 'stub', '0')
      `,
      [graphIds.aSearchDocument, ids.userA, graphIds.aFact]
    );
    await client.query(
      `
        INSERT INTO app.memory_legacy_fact_migrations (
          owner_user_id,
          legacy_fact_id,
          memory_fact_id
        )
        VALUES ($1, $2, $3)
      `,
      [ids.userA, graphIds.chatMemoryFact, graphIds.aFact]
    );
    await client.query(
      `
        INSERT INTO app.memory_candidates (
          id,
          owner_user_id,
          episode_id,
          kind,
          action,
          payload_json,
          candidate_signature,
          status,
          confidence,
          importance,
          provenance
        )
        VALUES
          ($1, $2, $3, 'fact', 'create', '{"kind":"fact"}', 'candidate-a', 'pending', 0.900, 0.800, 'volunteered'),
          ($4, $5, $6, 'fact', 'create', '{"kind":"fact"}', 'candidate-b', 'pending', 0.900, 0.800, 'volunteered')
      `,
      [
        graphIds.aCandidate,
        ids.userA,
        graphIds.aEpisode,
        graphIds.bCandidate,
        ids.userB,
        graphIds.bEpisode
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function readMemoryGraphCounts(): Promise<{
  readonly userAGraphRows: number;
  readonly userBGraphRows: number;
}> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    const result = await client.query<{
      user_a_graph_rows: string;
      user_b_graph_rows: string;
    }>(
      `
        SELECT ${memoryGraphCountSql("$1")} AS user_a_graph_rows,
               ${memoryGraphCountSql("$2")} AS user_b_graph_rows
      `,
      [ids.userA, ids.userB]
    );
    return {
      userAGraphRows: Number(result.rows[0]?.user_a_graph_rows ?? 0),
      userBGraphRows: Number(result.rows[0]?.user_b_graph_rows ?? 0)
    };
  } finally {
    await client.end();
  }
}

function memoryGraphCountSql(userPlaceholder: "$1" | "$2"): string {
  return [
    "memory_entities",
    "memory_facts",
    "memory_episodes",
    "memory_fact_sources",
    "memory_aliases",
    "memory_search_documents",
    "memory_legacy_fact_migrations",
    "memory_conflict_groups",
    "memory_candidates"
  ]
    .map((table) => `(SELECT count(*) FROM app.${table} WHERE owner_user_id = ${userPlaceholder})`)
    .join(" + ");
}
