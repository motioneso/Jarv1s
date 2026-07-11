import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// #953 (epic #954) News Slice 1 — schema-level RLS posture for the four personalization
// tables added by 0159_news_personalization.sql. Slice 1 is security-tier: owner-only FORCE
// RLS applies to every actor including admins, and the worker runtime gets NO access until
// Slice 2 proves it needs some. Repository behavior tests (owner isolation via DataContext)
// are added to this file in Task 3.
const PERSONALIZATION_TABLES = [
  "news_custom_sources",
  "news_custom_topics",
  "news_source_exclusions",
  "news_compilation_snapshots"
] as const;

describe("news personalization schema posture (#953)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    await resetFoundationDatabase();
    client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("all four tables exist with ENABLE + FORCE row-level security", async () => {
    const result = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = ANY($1)
        ORDER BY c.relname`,
      [[...PERSONALIZATION_TABLES]]
    );
    expect(result.rows).toEqual(
      [...PERSONALIZATION_TABLES].sort().map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true
      }))
    );
  });

  it("defines exactly SELECT/INSERT/UPDATE/DELETE app-runtime policies, all owner-scoped", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const result = await client.query<{
        policyname: string;
        roles: string[];
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname, roles::text[] AS roles, cmd, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'app' AND tablename = $1
          ORDER BY cmd`,
        [table]
      );
      expect(result.rows.map((row) => row.cmd).sort(), table).toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE"
      ]);
      for (const policy of result.rows) {
        expect(policy.roles, `${table}/${policy.policyname}`).toEqual(["jarvis_app_runtime"]);
        // INSERT policies carry only with_check; SELECT/DELETE only qual; UPDATE both.
        // The invariant: every predicate present is owner-scoped, never simply `true`.
        const predicates = [policy.qual, policy.with_check].filter(
          (predicate): predicate is string => predicate !== null
        );
        expect(predicates.length, `${table}/${policy.policyname}`).toBeGreaterThan(0);
        for (const predicate of predicates) {
          expect(predicate, `${table}/${policy.policyname}`).toContain("owner_user_id");
          expect(predicate, `${table}/${policy.policyname}`).toContain("current_actor_user_id()");
        }
      }
    }
  });

  it("grants jarvis_worker_runtime no privilege of any kind (Slice 1 has no worker path)", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT bool_or(has_table_privilege('jarvis_worker_runtime', $1, priv)) AS has_privilege
           FROM unnest(ARRAY[
             'select','insert','update','delete','truncate','references','trigger'
           ]) AS priv`,
        [`app.${table}`]
      );
      expect(result.rows[0]?.has_privilege, table).toBe(false);
    }
  });

  it("app runtime holds exactly SELECT/INSERT/UPDATE/DELETE and never owns the tables", async () => {
    for (const table of PERSONALIZATION_TABLES) {
      const grants = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'app' AND table_name = $1 AND grantee = 'jarvis_app_runtime'
          ORDER BY privilege_type`,
        [table]
      );
      expect(
        grants.rows.map((row) => row.privilege_type),
        table
      ).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);

      const owner = await client.query<{ tableowner: string }>(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'app' AND tablename = $1`,
        [table]
      );
      expect(owner.rows[0]?.tableowner, table).toBe("jarvis_migration_owner");
    }
  });

  it("news_custom_topics enforces case-insensitive owner+label uniqueness via expression index", async () => {
    const result = await client.query<{ indexdef: string }>(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = 'app' AND tablename = 'news_custom_topics'
          AND indexdef ILIKE '%lower(label)%'`
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toContain("UNIQUE");
    expect(result.rows[0]?.indexdef).toContain("owner_user_id");
  });
});
