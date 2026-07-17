import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const memoryGraphIds = {
  aSelf: "78000000-0000-4000-8000-000000000001",
  aFact: "78000000-0000-4000-8000-000000000002",
  aEpisode: "78000000-0000-4000-8000-000000000003",
  bSelf: "78000000-0000-4000-8000-000000000004",
  bFact: "78000000-0000-4000-8000-000000000005",
  bEpisode: "78000000-0000-4000-8000-000000000006"
} as const;

interface InvocationResponse {
  readonly invocation: {
    readonly moduleId: string;
    readonly name: string;
    readonly risk: "read" | "write" | "destructive";
    readonly status: "succeeded" | "blocked";
    readonly blockedReason: string | null;
    readonly actionRequestId: string | null;
    readonly result: Record<string, unknown> | null;
  };
}

describe("memory graph assistant tools", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;
  let originalEmbedProvider: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    originalEmbedProvider = process.env.JARVIS_EMBED_PROVIDER;
    process.env.JARVIS_AI_SECRET_KEY = "test-memory-graph-tools-secret-key";
    process.env.JARVIS_EMBED_PROVIDER = "stub";

    await resetFoundationDatabase();
    await seedMemoryGraphToolData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
    if (originalEmbedProvider === undefined) {
      delete process.env.JARVIS_EMBED_PROVIDER;
    } else {
      process.env.JARVIS_EMBED_PROVIDER = originalEmbedProvider;
    }
  });

  it("executes memory.recall through owner-scoped graph memory", async () => {
    const recall = await invokeReadTool("memory.recall", {
      query: "mobile responses"
    });

    expect(recall.result).toBeTruthy();
    expect(JSON.stringify(recall.result)).toContain("mobile responses");
    expect(JSON.stringify(recall.result)).not.toContain("User B graph memory");
  });

  it("requires confirmation for memory.remember and memory.forget", async () => {
    const rememberResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/memory.remember/invoke",
      headers: userAHeaders(),
      payload: {
        input: {
          predicate: "prefers",
          objectText: "quiet confirmations",
          source: {
            sourceKind: "manual",
            sourceRef: "manual:tool-test",
            excerpt: "User asked for quiet confirmations."
          }
        }
      }
    });
    const forgetResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/memory.forget/invoke",
      headers: userAHeaders(),
      payload: {
        input: { factId: memoryGraphIds.aFact }
      }
    });

    for (const response of [rememberResponse, forgetResponse]) {
      expect(response.statusCode).toBe(403);
      expect(response.json<InvocationResponse>().invocation).toMatchObject({
        moduleId: "memory",
        status: "blocked",
        blockedReason: "confirmation_required",
        result: null
      });
    }
    expect(rememberResponse.json<InvocationResponse>().invocation.risk).toBe("write");
    expect(forgetResponse.json<InvocationResponse>().invocation.risk).toBe("destructive");
  });

  async function invokeReadTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<InvocationResponse["invocation"]> {
    const response = await server.inject({
      method: "POST",
      url: `/api/ai/assistant-tools/${toolName}/invoke`,
      headers: userAHeaders(),
      payload: { input }
    });

    expect(response.statusCode).toBe(200);

    const invocation = response.json<InvocationResponse>().invocation;

    expect(invocation).toMatchObject({
      name: toolName,
      risk: "read",
      status: "succeeded",
      blockedReason: null
    });

    return invocation;
  }
});

async function seedMemoryGraphToolData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.memory_entities (id, owner_user_id, kind, name, summary)
        VALUES
          ($1, $2, 'self', 'Self', 'User A self'),
          ($3, $4, 'self', 'Self', 'User B self')
      `,
      [memoryGraphIds.aSelf, ids.userA, memoryGraphIds.bSelf, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.memory_facts (
          id,
          owner_user_id,
          subject_entity_id,
          predicate,
          object_text,
          confidence,
          provenance,
          importance,
          pinned
        )
        VALUES
          ($1, $2, $3, 'prefers', 'user A mobile responses', 0.95, 'confirmed', 0.90, true),
          ($4, $5, $6, 'related_to', 'User B graph memory', 0.95, 'confirmed', 0.90, true)
      `,
      [
        memoryGraphIds.aFact,
        ids.userA,
        memoryGraphIds.aSelf,
        memoryGraphIds.bFact,
        ids.userB,
        memoryGraphIds.bSelf
      ]
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
          ($1, $2, 'manual', 'manual:tool-a', 'Tool seed', 'User A prefers mobile responses.'),
          ($3, $4, 'manual', 'manual:tool-b', 'Tool seed', 'User B private graph memory.')
      `,
      [memoryGraphIds.aEpisode, ids.userA, memoryGraphIds.bEpisode, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.memory_fact_sources (owner_user_id, fact_id, episode_id)
        VALUES
          ($1, $2, $3),
          ($4, $5, $6)
      `,
      [
        ids.userA,
        memoryGraphIds.aFact,
        memoryGraphIds.aEpisode,
        ids.userB,
        memoryGraphIds.bFact,
        memoryGraphIds.bEpisode
      ]
    );
    await client.query(
      `
        INSERT INTO app.memory_search_documents (owner_user_id, target_kind, target_id, search_text)
        VALUES
          ($1, 'fact', $2, 'prefers user A mobile responses'),
          ($3, 'fact', $4, 'related_to User B graph memory')
      `,
      [ids.userA, memoryGraphIds.aFact, ids.userB, memoryGraphIds.bFact]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function userAHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionA}`
  };
}
