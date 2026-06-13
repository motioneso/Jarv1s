import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
});

afterAll(async () => {
  await appDb.destroy();
});

describe("email_messages summary/signals columns (0067)", () => {
  it("has nullable summary and a jsonb signals column defaulting to {}", async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
        AND column_name IN ('summary', 'signals')
      ORDER BY column_name
    `.execute(appDb);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(byName.summary?.data_type).toBe("text");
    expect(byName.summary?.is_nullable).toBe("YES");
    expect(byName.signals?.data_type).toBe("jsonb");
    expect(byName.signals?.is_nullable).toBe("NO");
  });

  it("declares a CHECK constraint that pins signals to a jsonb object", async () => {
    // A WHERE-false UPDATE never evaluates a CHECK, so assert the constraint EXISTS in the
    // catalog here; a real rejecting INSERT (signals = '[]') is exercised in C1 where a
    // valid connector account FK is available to reach the row insert at all.
    const checks = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'app' AND t.relname = 'email_messages' AND c.contype = 'c'
    `.execute(appDb);
    const defs = checks.rows.map((r) => r.definition).join(" | ");
    expect(defs).toMatch(/jsonb_typeof\(signals\)\s*=\s*'object'/);
  });
});

// DEVIATION (vs plan A2 step 1): the plan's A2 tests call CalendarRepository.upsertCachedEvent,
// which (a) does not exist until Task B1 and (b) cannot SUCCEED at A2 time even once it exists —
// the relaxed INSERT WITH CHECK runs an EXISTS subquery over app.connector_accounts JOIN
// app.connector_definitions as the worker role, but the worker's SELECT grant on those tables
// only lands in Task A4 (0069). The plan masked this by ordering A2→A3→A4 BEFORE B1, so the
// end-to-end worker INSERT first executes under A4's grants. To keep A2 a self-contained,
// gate-green commit that genuinely verifies ITS OWN security-critical deliverable, A2 asserts
// the relaxation at the catalog level: the worker grant is present, the INSERT policy now
// applies to the worker role, owner-equality is preserved verbatim, and the EXISTS is relaxed
// to provider_type IN ('calendar','google') with the google branch scope-gated on the Calendar
// scope. The end-to-end worker INSERT (success + scope-guard rejection) is exercised once the
// connector grants exist (Task A4 / the F2 handler integration test).
describe("calendar RLS — worker role + google INSERT relax (0066)", () => {
  it("grants the worker role SELECT/INSERT/UPDATE on app.calendar_events", async () => {
    // aclexplode(relacl) is readable from any role and surfaces grants to OTHER roles
    // (information_schema.role_table_grants is filtered to the current role only).
    const grants = await sql<{ privilege_type: string }>`
      SELECT a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app' AND c.relname = 'calendar_events'
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    const privileges = grants.rows.map((r) => r.privilege_type);
    expect(privileges).toContain("SELECT");
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("UPDATE");
  });

  it("applies the INSERT policy to both the app and worker runtime roles", async () => {
    // One row per granted role (unnest of polroles) avoids array-literal serialization.
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.calendar_events'::regclass
        AND p.polname = 'calendar_events_insert'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
  });

  it("preserves owner-equality and adds a scope-gated google branch in the INSERT WITH CHECK", async () => {
    const policy = await sql<{ withcheck: string }>`
      SELECT pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
      FROM pg_policy p
      WHERE p.polrelid = 'app.calendar_events'::regclass AND p.polname = 'calendar_events_insert'
    `.execute(appDb);
    const withCheck = policy.rows[0]?.withcheck ?? "";
    // Owner-equality preserved verbatim (the M-B1 owner-only guarantee is NOT weakened).
    expect(withCheck).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Relaxed to accept the unified google account in addition to a native calendar account.
    expect(withCheck).toMatch(/provider_type = 'calendar'/);
    expect(withCheck).toMatch(/provider_type = 'google'/);
    // The google branch is scope-gated: only an account holding the Calendar scope qualifies.
    expect(withCheck).toMatch(/https:\/\/www\.googleapis\.com\/auth\/calendar/);
    expect(withCheck).toMatch(/ANY \(accounts\.scopes\)/);
  });
});
