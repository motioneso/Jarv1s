import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Kysely } from "kysely";
import pg from "pg";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";

import { createApiServer } from "../../apps/api/src/server.js";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

const { Client } = pg;

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

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

describe("Phase 4 member onboarding — repository methods", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let dataContext: DataContextRunner;
  let memberAId: string;
  let memberBId: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();

    // First sign-up becomes the bootstrap owner + admin. Turn approval off so members
    // become active immediately (so their AccessContext resolves for the data-context calls).
    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Owner", email: "owner@p4.test", password: "correct horse battery staple" }
    });
    void owner;
    await setInstanceSetting("registration.requires_approval", { value: false });

    const memberA = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member A", email: "a@p4.test", password: "correct horse battery staple" }
    });
    memberAId = memberA.json<{ user: { id: string } }>().user.id;

    const memberB = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member B", email: "b@p4.test", password: "correct horse battery staple" }
    });
    memberBId = memberB.json<{ user: { id: string } }>().user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  let ownerId: string;

  it("getMemberOnboardingState returns completedAt: null for a fresh member", async () => {
    const repo = new SettingsRepository();
    const state = await dataContext.withDataContext(
      { actorUserId: memberAId, requestId: "p4-r1" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(state.completedAt).toBeNull();
  });

  it("setMemberOnboardingComplete stamps the actor's own row and a re-read returns non-null", async () => {
    const repo = new SettingsRepository();
    await dataContext.withDataContext({ actorUserId: memberAId, requestId: "p4-r2" }, (scopedDb) =>
      repo.setMemberOnboardingComplete(scopedDb, { actorUserId: memberAId, requestId: "p4-r2" })
    );
    const state = await dataContext.withDataContext(
      { actorUserId: memberAId, requestId: "p4-r3" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(state.completedAt).toBeInstanceOf(Date);
  });

  it("stamping is per-actor: completing as A does not stamp B (no row for B)", async () => {
    const repo = new SettingsRepository();
    // A is already stamped above. B has never completed, so B reads null — proving the
    // write was GUC-scoped to A's row only (no caller-supplied target id exists).
    const bState = await dataContext.withDataContext(
      { actorUserId: memberBId, requestId: "p4-r4" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(bState.completedAt).toBeNull();
  });

  it("an ADMIN cannot read another member's onboarding state (no admin SELECT policy on member_onboarding)", async () => {
    // The bootstrap owner is an admin. Acting under the owner's GUC, a self-row read of
    // member_onboarding returns ONLY the owner's row (none), NEVER member A's stamped row.
    // This is the regression test that proves the no-admin-bypass fix: had onboarding state
    // ridden app.users, the 0052 admin SELECT policy would have leaked A's value here.
    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json" },
      payload: { email: "owner@p4.test", password: "correct horse battery staple" }
    });
    ownerId = owner.json<{ user: { id: string } }>().user.id;
    const repo = new SettingsRepository();
    const adminView = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "p4-r5" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    // The admin reads its OWN (absent) onboarding row, never member A's stamped one.
    expect(adminView.completedAt).toBeNull();

    // Direct raw assertion: under the admin GUC, the member_onboarding table exposes only
    // the admin's own rows — A's row is NOT visible. Use a raw count via the data context.
    const rowsVisibleToAdmin = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "p4-r6" },
      (scopedDb) =>
        scopedDb.db
          .selectFrom("app.member_onboarding")
          .select("user_id")
          .where("user_id", "=", memberAId)
          .execute()
    );
    expect(rowsVisibleToAdmin).toEqual([]); // A's row invisible to the admin → no leak
  });
});

describe("Phase 4 member onboarding — route branch (status/complete/skip per actor)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();

    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Owner", email: "owner2@p4.test", password: "correct horse battery staple" }
    });
    ownerCookie = cookieHeader(owner.headers);
    await setInstanceSetting("registration.requires_approval", { value: false });

    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member", email: "m2@p4.test", password: "correct horse battery staple" }
    });
    memberCookie = cookieHeader(member.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
  });

  it("founder GET /status returns role: founder (unchanged founder shape)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { role: string }).role).toBe("founder");
  });

  it("active member GET /status returns role: member with completed:false (admit via requireKnownUser)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      role: string;
      completed: boolean;
      steps: { apiKeyOptOut: { done: boolean }; connectors: { done: boolean } };
    };
    expect(body.role).toBe("member");
    expect(body.completed).toBe(false);
    expect(body.steps.apiKeyOptOut.done).toBe(false);
    expect(body.steps.connectors.done).toBe(false);
    // No secret-shaped field.
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|credential/i);
  });

  it("member POST /complete stamps completed and does NOT leak completion to the admin audit log", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { completed: boolean }).completed).toBe(true);

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect((status.json() as { completed: boolean }).completed).toBe(true);

    // SECURITY REGRESSION GUARD (no-admin-bypass): member onboarding completion is PRIVATE
    // per-user state ("not even an admin may read"). app.admin_audit_events SELECT is admin-wide
    // (0059), so an "onboarding.member_complete" row keyed to the member would re-leak that exact
    // fact (member X onboarded at time T) to any admin via the admin audit log — a side channel
    // defeating the owner-only app.member_onboarding table. The member's durable completion record
    // is app.member_onboarding.completed_at, NOT an admin-readable audit row. Assert the admin
    // audit log carries NO member-onboarding action at all.
    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).not.toContain("onboarding.member_complete");
    expect(actions.some((a) => /member.*onboard|onboard.*member/i.test(a))).toBe(false);
  });

  it("member POST /skip == complete (terminal onboarded state)", async () => {
    // Fresh member to assert /skip stamps completion.
    const m = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Skipper", email: "skip@p4.test", password: "correct horse battery staple" }
    });
    const skipperCookie = cookieHeader(m.headers);
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: skipperCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { completed: boolean }).completed).toBe(true);
  });
});
