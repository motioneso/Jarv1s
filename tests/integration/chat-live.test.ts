import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";
const { Client } = pg;

describe("chat live runtime migration (0038)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });
  it("0038: chat_threads has last_active_at", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const col = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='app' AND table_name='chat_threads' AND column_name='last_active_at'`
      );
      expect(col.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});
