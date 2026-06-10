/**
 * Integration tests for chat token budget feature (issue #81).
 * Tasks: migration column, trimToTokenBudget pure logic, listPriorTurns bounded
 * replay, recordTurn rolling summary, env-var overrides, launchSession injection.
 */
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  DataContextRunner,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import { ChatRepository } from "@jarv1s/chat";
import {
  estimateTokens,
  trimToTokenBudget,
  type EpisodicChunk
} from "../../packages/chat/src/live/recall-seed.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

function userAContext() {
  return { actorUserId: ids.userA, requestId: "test" };
}

// ─── Task 1: migration ────────────────────────────────────────────────────────

describe("chat-token-budgets migration (00NN)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("chat_threads has conversation_summary column", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app'
           AND table_name   = 'chat_threads'
           AND column_name  = 'conversation_summary'`
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

// ─── Task 2: estimateTokens + trimToTokenBudget (pure logic, no DB) ──────────

describe("estimateTokens", () => {
  it("estimates 1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("trimToTokenBudget", () => {
  it("returns all chunks when total tokens fit in budget", () => {
    const chunks: EpisodicChunk[] = [
      { text: "aaaa", date: "2026-01-01", threadId: "t1", hybridScore: 0.9 }, // 1 token
      { text: "bbbb", date: "2026-01-02", threadId: "t2", hybridScore: 0.8 } // 1 token
    ];
    const kept = trimToTokenBudget(chunks, 10);
    expect(kept).toHaveLength(2);
  });

  it("keeps highest-scoring chunks first when budget is tight", () => {
    const chunks: EpisodicChunk[] = [
      { text: "a".repeat(200), date: "2026-01-01", threadId: "t1", hybridScore: 0.3 }, // 50 tokens
      { text: "b".repeat(200), date: "2026-01-02", threadId: "t2", hybridScore: 0.9 }, // 50 tokens
      { text: "c".repeat(200), date: "2026-01-03", threadId: "t3", hybridScore: 0.6 } // 50 tokens
    ];
    // Budget of 80 tokens: high (0.9) fits (50), mid (0.6) total = 100 > 80 → stopped
    const kept = trimToTokenBudget(chunks, 80);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.hybridScore).toBe(0.9);
  });

  it("returns empty array when budget is 0", () => {
    const chunks: EpisodicChunk[] = [
      { text: "hello", date: "2026-01-01", threadId: "t1", hybridScore: 0.9 }
    ];
    expect(trimToTokenBudget(chunks, 0)).toHaveLength(0);
  });

  it("returns empty array when input is empty", () => {
    expect(trimToTokenBudget([], 1500)).toHaveLength(0);
  });
});

// ─── Task 3: ChatRepository.updateConversationSummary ─────────────────────────

describe("ChatRepository.updateConversationSummary", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: ChatRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new ChatRepository();
  });

  it("stores a summary on a thread and is readable back", async () => {
    const thread = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "summary test" })
    );

    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.updateConversationSummary(scopedDb, thread.id, "As of turn 2: I helped with X.")
    );

    const updated = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getThreadById(scopedDb, thread.id)
    );
    expect(updated?.conversation_summary).toBe("As of turn 2: I helped with X.");
  });

  it("conversation_summary is null on a freshly-created thread", async () => {
    const thread = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.openNewThread(scopedDb, { title: "fresh thread" })
    );
    expect(thread.conversation_summary).toBeNull();
  });
});
