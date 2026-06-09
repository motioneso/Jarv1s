import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext
} from "@jarv1s/db";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// ── Task 1: Schema assertions ─────────────────────────────────────────────────

describe("Phase 3 Recall migrations", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
  });

  it("0040: memory_chunks allows source_kind='chat'", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.constraint_column_usage
         WHERE table_schema = 'app' AND table_name = 'memory_chunks'
           AND constraint_name = 'memory_chunks_source_kind_check'`
      );
      // Verify the constraint exists (we know it does if ALTER succeeded)
      const check = await client.query(
        `SELECT check_clause FROM information_schema.check_constraints
         WHERE constraint_name = 'memory_chunks_source_kind_check'`
      );
      const clause = check.rows[0]?.check_clause ?? "";
      expect(clause).toContain("chat");
    } finally {
      await client.end();
    }
  });

  it("0040: jarvis_worker_runtime has INSERT on memory_chunks", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.role_table_grants
         WHERE grantee = 'jarvis_worker_runtime'
           AND table_schema = 'app'
           AND table_name = 'memory_chunks'
           AND privilege_type = 'INSERT'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("0041: chat_memory_facts table exists with expected columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_memory_facts'
         ORDER BY column_name`
      );
      const cols = res.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain("id");
      expect(cols).toContain("owner_user_id");
      expect(cols).toContain("category");
      expect(cols).toContain("content");
      expect(cols).toContain("status");
      expect(cols).toContain("importance");
    } finally {
      await client.end();
    }
  });

  it("0042: chat_user_memory_settings table exists", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'app' AND table_name = 'chat_user_memory_settings'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("0042: chat_threads has incognito column", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const res = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'chat_threads'
           AND column_name = 'incognito'`
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});
