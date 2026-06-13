import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("Phase 4 member onboarding — migration", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
  });

  it("creates app.member_onboarding(user_id uuid PK, completed_at timestamptz) with ENABLE+FORCE RLS", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const cols = await client.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'member_onboarding'
          ORDER BY column_name`
      );
      const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
      expect(byName.user_id?.data_type).toBe("uuid");
      expect(byName.user_id?.is_nullable).toBe("NO");
      expect(byName.completed_at?.data_type).toBe("timestamp with time zone");

      // PK on user_id (one row per member).
      const pk = await client.query(
        `SELECT a.attname
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'app.member_onboarding'::regclass AND i.indisprimary`
      );
      expect(pk.rows.map((r) => r.attname)).toEqual(["user_id"]);

      // RLS enabled AND forced (no bypass for the table owner role either).
      const rls = await client.query(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = 'member_onboarding' AND relnamespace = 'app'::regnamespace`
      );
      expect(rls.rows[0].relrowsecurity).toBe(true);
      expect(rls.rows[0].relforcerowsecurity).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("has self-row-only policies and NO admin SELECT/UPDATE policy (no-admin-bypass)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const policies = await client.query(
        `SELECT policyname, cmd, qual, with_check FROM pg_policies
          WHERE schemaname = 'app' AND tablename = 'member_onboarding'
          ORDER BY policyname`
      );
      const names = policies.rows.map((r) => r.policyname);
      // Exactly the self-row policy set — modelled on chat_memory_facts.
      expect(names).toEqual(
        expect.arrayContaining([
          "member_onboarding_select",
          "member_onboarding_insert",
          "member_onboarding_update"
        ])
      );
      // CRITICAL: no policy grants admin-wide access. Every policy must key on the actor's own id;
      // none may reference current_actor_is_admin (which would re-introduce the app.users leak).
      for (const row of policies.rows) {
        const clause = `${row.qual ?? ""} ${row.with_check ?? ""}`;
        expect(clause).toMatch(/current_actor_user_id/);
        expect(clause).not.toMatch(/current_actor_is_admin/);
      }
      // The app.users admin SELECT leak does not apply here: this table is NOT app.users.
      expect(names.some((n) => /admin/i.test(n))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("does NOT add any column or policy to app.users (onboarding state never rides the user row)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const col = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'users'
            AND column_name = 'onboarding_completed_at'`
      );
      expect(col.rows).toHaveLength(0); // the unsafe column must NOT exist
      const policies = await client.query(
        `SELECT policyname FROM pg_policies
          WHERE schemaname = 'app' AND tablename = 'users'`
      );
      expect(policies.rows.some((r) => /onboarding/i.test(r.policyname))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("keeps FORCE RLS on the auth-secret tables (0045/0046 posture not weakened)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const forced = await client.query(
        `SELECT relname, relforcerowsecurity
           FROM pg_class
          WHERE relname IN ('auth_accounts', 'better_auth_sessions')
            AND relnamespace = 'app'::regnamespace
          ORDER BY relname`
      );
      for (const row of forced.rows) {
        expect(row.relforcerowsecurity).toBe(true);
      }
    } finally {
      await client.end();
    }
  });
});
