/**
 * Integration tests for chat token budget feature (issue #81).
 * Tasks: migration column, trimToTokenBudget pure logic, listPriorTurns bounded
 * replay, recordTurn rolling summary, env-var overrides, launchSession injection.
 */
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

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
