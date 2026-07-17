import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createJarvisAuthRuntime,
  type BootstrapSettings,
  type JarvisAuthRuntime
} from "@jarv1s/auth";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { recordBootstrapOwnerAuditEvent } from "@jarv1s/settings";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

describe("owner bootstrap recovery", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    // #1124: see multi-user-isolation.test.ts for rationale — override pg-boss's default
    // 10s connectionTimeoutMillis so a slow-but-healthy CI connection isn't killed early.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, authRuntime, boss, logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await Promise.allSettled([
      server?.close(),
      authRuntime?.close(),
      appDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  async function signUp(opts: { name: string; email: string; password: string }) {
    return server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: opts
    });
  }

  async function seedNonBootstrapOwnerUser(input: { id: string; email: string }): Promise<void> {
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `
          INSERT INTO app.users (id, email, name, is_instance_admin, is_bootstrap_owner, status)
          VALUES ($1, $2, 'Seeded Non Owner', false, false, 'active')
        `,
        [input.id, input.email]
      );
    } finally {
      await seed.end();
    }
  }

  async function seedStaleAdminUser(input: { id: string; email: string }): Promise<void> {
    const seed = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await seed.connect();
    try {
      await seed.query(
        `
          INSERT INTO app.users (id, email, name, is_instance_admin, is_bootstrap_owner, status)
          VALUES ($1, $2, 'Stale Admin', true, false, 'active')
        `,
        [input.id, input.email]
      );
    } finally {
      await seed.end();
    }
  }

  async function readUsersByEmailPrefix(prefix: string): Promise<
    Array<{
      email: string;
      is_instance_admin: boolean;
      is_bootstrap_owner: boolean;
      status: string;
    }>
  > {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{
        email: string;
        is_instance_admin: boolean;
        is_bootstrap_owner: boolean;
        status: string;
      }>(
        `
          SELECT email, is_instance_admin, is_bootstrap_owner, status
          FROM app.users
          WHERE email LIKE $1
          ORDER BY email
        `,
        [`${prefix}%`]
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  async function waitForUserCountByEmailPrefix(prefix: string, count: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const users = await readUsersByEmailPrefix(prefix);
      if (users.length === count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${count} users with prefix ${prefix}`);
  }

  async function readUserIdsByEmailPrefix(
    prefix: string
  ): Promise<Array<{ id: string; email: string }>> {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ id: string; email: string }>(
        `
          SELECT id, email
          FROM app.users
          WHERE email LIKE $1
          ORDER BY email
        `,
        [`${prefix}%`]
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  async function readRegistrationRejectedAudit(): Promise<
    Array<{
      actor_user_id: string | null;
      target_id: string | null;
      metadata: Record<string, unknown>;
    }>
  > {
    const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{
        actor_user_id: string | null;
        target_id: string | null;
        metadata: Record<string, unknown>;
      }>(
        `
          SELECT actor_user_id, target_id, metadata
          FROM app.admin_audit_events
          WHERE action = 'user.registration_rejected'
        `
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  it("bootstraps signup as owner when existing users have no bootstrap owner", async () => {
    await seedNonBootstrapOwnerUser({
      id: "00000000-0000-4000-8000-000000002601",
      email: "seeded-non-owner@example.com"
    });

    const signUpRes = await signUp({
      name: "Recovered Owner",
      email: "recovered-owner@example.com",
      password: "password12345"
    });

    expect(signUpRes.statusCode).toBe(200);
    const recoveredOwnerId = signUpRes.json<{ user: { id: string } }>().user.id;
    const rows = await sql<{
      is_instance_admin: boolean;
      is_bootstrap_owner: boolean;
      status: string;
    }>`SELECT is_instance_admin, is_bootstrap_owner, status FROM app.get_user_by_id(${recoveredOwnerId}::uuid)`.execute(
      appDb
    );

    expect(rows.rows[0]).toMatchObject({
      is_instance_admin: true,
      is_bootstrap_owner: true,
      status: "active"
    });
  });

  it("bootstraps signup as owner when registration is disabled but no bootstrap owner exists", async () => {
    await seedNonBootstrapOwnerUser({
      id: "00000000-0000-4000-8000-000000002603",
      email: "disabled-seeded-non-owner@example.com"
    });
    const statusRes = await server.inject({ method: "GET", url: "/api/bootstrap/status" });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toEqual({ needsBootstrap: true });

    await setInstanceSetting("registration.enabled", { value: false });

    const signUpRes = await signUp({
      name: "Disabled Recovery Owner",
      email: "disabled-recovered-owner@example.com",
      password: "password12345"
    });

    expect(signUpRes.statusCode).toBe(200);
    const recoveredOwnerId = signUpRes.json<{ user: { id: string } }>().user.id;
    const rows = await sql<{
      is_instance_admin: boolean;
      is_bootstrap_owner: boolean;
      status: string;
    }>`SELECT is_instance_admin, is_bootstrap_owner, status FROM app.get_user_by_id(${recoveredOwnerId}::uuid)`.execute(
      appDb
    );

    expect(rows.rows[0]).toMatchObject({
      is_instance_admin: true,
      is_bootstrap_owner: true,
      status: "active"
    });
  });

  it("deletes race-loser row and returns 403 (not 500) even when audit write throws", async () => {
    // This test exercises the after-hook race-loser path with a failing audit write.
    // The before-hook only blocks sign-ups when bootstrapOwnerExists=true, so to reach
    // the after-hook we must use the same advisory-lock race setup as the existing race
    // test: seed a non-owner, disable registration, hold the lock so both sign-ups create
    // their rows before either after-hook runs, then release and let one win/one lose.
    // The loser hits recordRegistrationRejectedAudit which throws (injected mock).
    // With the best-effort catch fix: (a) loser row is still deleted, (b) response is
    // 403 registration_disabled — NOT 500/masked by the audit error.

    // Build the server with the throwing audit override BEFORE sign-ups begin.
    await server.close();
    await authRuntime.close();
    const throwingSettings: BootstrapSettings = {
      recordBootstrapOwnerAuditEvent,
      recordAuditEvent: vi.fn().mockRejectedValue(new Error("simulated audit failure"))
    };
    authRuntime = createJarvisAuthRuntime({
      appDb,
      runner: new DataContextRunner(appDb),
      _settingsOverride: throwingSettings
    });
    // Reuse the same #1124 boss override created in beforeEach — no need for a fresh client.
    server = createApiServer({ appDb, authRuntime, boss, logger: false });
    await server.ready();

    // Seed a non-bootstrap-owner so bootstrapOwnerExists=false when before-hooks run
    // → both before-hooks pass even with registration.enabled=false.
    await seedNonBootstrapOwnerUser({
      id: "00000000-0000-4000-8000-000000002701",
      email: "audit-throw-seeded-non-owner@example.com"
    });
    await setInstanceSetting("registration.enabled", { value: false });

    // Hold advisory lock so both sign-ups create user rows before either after-hook
    // can acquire the xact lock, guaranteeing one will be the race loser.
    const lock = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await lock.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext('jarv1s:first-user-bootstrap'))");
      const first = signUp({
        name: "Audit Throw Racer One",
        email: "audit-throw-racer-one@example.com",
        password: "password12345"
      });
      const second = signUp({
        name: "Audit Throw Racer Two",
        email: "audit-throw-racer-two@example.com",
        password: "password12345"
      });

      await waitForUserCountByEmailPrefix("audit-throw-racer-", 2);
      const racerIds = await readUserIdsByEmailPrefix("audit-throw-racer-");
      await lock.query("SELECT pg_advisory_unlock(hashtext('jarv1s:first-user-bootstrap'))");

      const responses = await Promise.all([first, second]);

      // (b) Original error is preserved: winner → 200, loser → 403 registration_disabled
      // (not 500, which would indicate the audit error masked the original APIError).
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 403]);
      const loserRes = responses.find((r) => r.statusCode === 403)!;
      expect(loserRes.json<{ code?: string }>().code).toBe("registration_disabled");

      // (a) Loser user row deleted even though audit write threw.
      const winnerId = responses.find((r) => r.statusCode === 200)!.json<{ user: { id: string } }>()
        .user.id;
      const loserId = racerIds.find((r) => r.id !== winnerId)?.id;
      expect(loserId).toBeDefined();
      const remaining = await readUsersByEmailPrefix("audit-throw-racer-");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.is_bootstrap_owner).toBe(true);
    } finally {
      await lock.end();
    }
  });

  it("rejects disabled-registration bootstrap recovery racers that lose the owner lock", async () => {
    await seedNonBootstrapOwnerUser({
      id: "00000000-0000-4000-8000-000000002604",
      email: "race-seeded-non-owner@example.com"
    });
    await setInstanceSetting("registration.enabled", { value: false });

    const lock = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await lock.connect();
    let loserId: string | undefined;
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext('jarv1s:first-user-bootstrap'))");
      const first = signUp({
        name: "Disabled Racer One",
        email: "disabled-racer-one@example.com",
        password: "password12345"
      });
      const second = signUp({
        name: "Disabled Racer Two",
        email: "disabled-racer-two@example.com",
        password: "password12345"
      });

      await waitForUserCountByEmailPrefix("disabled-racer-", 2);
      const racerIds = await readUserIdsByEmailPrefix("disabled-racer-");
      await lock.query("SELECT pg_advisory_unlock(hashtext('jarv1s:first-user-bootstrap'))");

      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
      expect(
        responses
          .filter((response) => response.statusCode === 403)
          .map((response) => response.json<{ code?: string }>().code)
      ).toEqual(["registration_disabled"]);

      const winnerResponse = responses.find((response) => response.statusCode === 200);
      const winnerId = winnerResponse!.json<{ user: { id: string } }>().user.id;
      loserId = racerIds.find((racer) => racer.id !== winnerId)?.id;
    } finally {
      await lock.end();
    }

    const racers = await readUsersByEmailPrefix("disabled-racer-");
    expect(racers).toHaveLength(1);
    expect(racers[0]).toMatchObject({
      is_instance_admin: true,
      is_bootstrap_owner: true,
      status: "active"
    });

    expect(loserId).toBeDefined();
    const auditRows = await readRegistrationRejectedAudit();
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    expect(auditRow).toBeDefined();
    expect(auditRow!.target_id).toBe(loserId);
    expect(auditRow!.metadata).toMatchObject({ reason: "registration_disabled" });
  });

  it("deletes the orphaned row when the 0055 admin-flag guard denies bootstrap and lets retry succeed", async () => {
    // Live repro from the issue: a stale is_instance_admin=true row that is NOT the
    // bootstrap owner survives from earlier state. bootstrapOwnerExists() checks
    // is_bootstrap_owner (still false), so the new sign-up takes the
    // shouldBootstrapOwner=true branch and tries to set is_instance_admin=true on
    // itself. The 0055 trigger denies it (any_admin_exists()=true, actor not yet
    // admin) and the hook's transaction rolls back — but better-auth already
    // committed the user/account rows on its own connection before the hook ran.
    await seedStaleAdminUser({
      id: "00000000-0000-4000-8000-000000002801",
      email: "stale-admin@example.com"
    });

    const email = "bricked-owner@example.com";
    const firstAttempt = await signUp({
      name: "Bricked Owner",
      email,
      password: "password12345"
    });

    // The trigger denial surfaces as an unhandled error from the after-hook, not
    // an APIError — better-auth reports it as a 500, not the 422 USER_ALREADY_EXISTS
    // the issue describes on every *subsequent* attempt against the bricked row.
    expect(firstAttempt.statusCode).toBe(500);

    // The failed attempt's row must not survive — otherwise the email is
    // permanently taken (422 USER_ALREADY_EXISTS) with no way to complete setup,
    // exactly the brick described in the issue.
    const afterFailure = await readUsersByEmailPrefix("bricked-owner@");
    expect(afterFailure).toHaveLength(0);

    // Once the actual conflict is remediated (an operator clearing the stale
    // admin flag — a separate concern from this fix), retrying the exact same
    // email must succeed, proving it was never permanently bricked.
    const remediate = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await remediate.connect();
    try {
      await remediate.query(
        "UPDATE app.users SET is_instance_admin = false WHERE email = 'stale-admin@example.com'"
      );
    } finally {
      await remediate.end();
    }

    const retry = await signUp({
      name: "Bricked Owner",
      email,
      password: "password12345"
    });
    expect(retry.statusCode).toBe(200);
  });
});
