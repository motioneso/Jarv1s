import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let workerDb: Kysely<JarvisDatabase>;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  dataContext = new DataContextRunner(appDb);
  workerDb = createDatabase({ connectionString: connectionStrings.worker });
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb.destroy();
  await workerDb.destroy();
});

// IMPORTANT — test isolation. `upsertGoogleAccount` is a SINGLETON per user (keyed on
// provider_id = GOOGLE_PROVIDER_ID): every call for the same actor OVERWRITES that user's
// one google account (id + scopes). The connector-account row is seeded via the APP
// DataContext (the worker has no INSERT grant on connector_accounts — see 0069 note); the
// worker DataContext only ever READS it. Seed POSITIVE cases under `ids.userA`; the A4
// cross-user invisibility case uses `ids.adminUser`, which no test ever gives an account.
async function seedGoogleAccount(
  scopes: string[],
  actorUserId: string = ids.userA
): Promise<string> {
  const cipher = createConnectorSecretCipher();
  const repo = new ConnectorsRepository();
  return dataContext.withDataContext({ actorUserId, requestId: "test" }, async (scopedDb) => {
    const account = await repo.upsertGoogleAccount(scopedDb, {
      scopes,
      encryptedSecret: cipher.encryptJson({ kind: "google-oauth" })
    });
    // Prove the precondition: the stored scopes are exactly what this test seeded.
    const stored = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("scopes")
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();
    expect(new Set(stored.scopes)).toEqual(new Set(scopes));
    return account.id;
  });
}

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

// DEVIATION (vs plan A3 step 1): mirrors the A2 deviation above. The plan's A3 tests call
// EmailRepository.upsertCachedMessage as the worker role, but that method does not exist until
// Task C1, AND a worker INSERT cannot succeed until A4 (0069) grants the worker SELECT on
// app.connector_accounts/app.connector_definitions (the relaxed INSERT WITH CHECK joins both in
// its EXISTS subquery, evaluated as the worker role). To keep A3 a self-contained, gate-green
// commit that genuinely verifies ITS OWN security-critical deliverable, A3 asserts the relaxation
// at the catalog level: the worker grant is present, the INSERT policy now applies to the worker
// role, owner-equality is preserved verbatim, and the EXISTS is relaxed to provider_type IN
// ('email','google') with the google branch scope-gated on the Gmail scope. The end-to-end worker
// INSERT (success + scope-guard rejection) is exercised once the connector grants exist (Task A4 /
// the F2 handler integration test).
describe("email RLS — worker role + google INSERT relax (0068)", () => {
  it("grants the worker role SELECT/INSERT/UPDATE on app.email_messages", async () => {
    // aclexplode(relacl) is readable from any role and surfaces grants to OTHER roles
    // (information_schema.role_table_grants is filtered to the current role only).
    const grants = await sql<{ privilege_type: string }>`
      SELECT a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app' AND c.relname = 'email_messages'
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
      WHERE p.polrelid = 'app.email_messages'::regclass
        AND p.polname = 'email_messages_insert'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
  });

  it("preserves owner-equality and adds a scope-gated google branch in the INSERT WITH CHECK", async () => {
    const policy = await sql<{ withcheck: string }>`
      SELECT pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
      FROM pg_policy p
      WHERE p.polrelid = 'app.email_messages'::regclass AND p.polname = 'email_messages_insert'
    `.execute(appDb);
    const withCheck = policy.rows[0]?.withcheck ?? "";
    // Owner-equality preserved verbatim (the M-B1 owner-only guarantee is NOT weakened).
    expect(withCheck).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Relaxed to accept the unified google account in addition to a native email account.
    expect(withCheck).toMatch(/provider_type = 'email'/);
    expect(withCheck).toMatch(/provider_type = 'google'/);
    // The google branch is scope-gated: only an account holding the Gmail scope qualifies.
    expect(withCheck).toMatch(/https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
    expect(withCheck).toMatch(/ANY \(accounts\.scopes\)/);
  });
});

// Task A4 (was plan-placeholder 0068; re-derived to 0069 — 0068 was taken by the email
// worker-grants migration that landed in A3). The google-sync worker (jarvis_worker_runtime)
// must SELECT the actor's encrypted Google OAuth bundle and UPDATE the re-encrypted refreshed
// token, while connector_accounts stay OWNER-ONLY (secrets are never shared cross-user).
describe("connector_accounts RLS — worker role (0069)", () => {
  it("the worker role reads the actor's active google account secret", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret?.id).toBe(accountId);
  });

  it("the worker role cannot see another user's connector account", async () => {
    // Use ids.adminUser here: it is a third authenticated user (test-database.ts) that no test
    // ever gives a connector account, so cross-user invisibility is asserted cleanly regardless
    // of run order.
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret).toBeUndefined();
  });

  it("grants the worker role SELECT/UPDATE on connector_accounts and SELECT on connector_definitions", async () => {
    // aclexplode(relacl) surfaces grants to OTHER roles (information_schema is current-role only).
    const grants = await sql<{ relname: string; privilege_type: string }>`
      SELECT c.relname, a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app'
        AND c.relname IN ('connector_accounts', 'connector_definitions')
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    const byTable = grants.rows.reduce<Record<string, Set<string>>>((acc, r) => {
      (acc[r.relname] ??= new Set()).add(r.privilege_type);
      return acc;
    }, {});
    expect(byTable.connector_accounts).toContain("SELECT");
    expect(byTable.connector_accounts).toContain("UPDATE");
    // OWNER-ONLY secrets: the worker is deliberately NOT granted INSERT on connector_accounts
    // (connection creation stays app-runtime only).
    expect(byTable.connector_accounts?.has("INSERT")).toBe(false);
    expect(byTable.connector_definitions).toContain("SELECT");
  });

  it("keeps connector_accounts SELECT owner-only (no app.has_share arm) for both runtimes", async () => {
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.connector_accounts'::regclass
        AND p.polname = 'connector_accounts_select'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
    const policy = await sql<{ qual: string }>`
      SELECT pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_policy p
      WHERE p.polrelid = 'app.connector_accounts'::regclass
        AND p.polname = 'connector_accounts_select'
    `.execute(appDb);
    const qual = policy.rows[0]?.qual ?? "";
    expect(qual).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Secrets are never shared: no share-based read arm.
    expect(qual).not.toMatch(/has_share/);
  });
});
