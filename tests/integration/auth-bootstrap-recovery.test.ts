import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createJarvisAuthRuntime, type JarvisAuthRuntime } from "@jarv1s/auth";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

describe("owner bootstrap recovery", () => {
  let appDb: Kysely<JarvisDatabase>;
  let authRuntime: JarvisAuthRuntime;
  let server: ReturnType<typeof createApiServer>;

  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    authRuntime = createJarvisAuthRuntime({ appDb, runner: new DataContextRunner(appDb) });
    server = createApiServer({ appDb, authRuntime, logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await Promise.allSettled([server?.close(), authRuntime?.close(), appDb?.destroy()]);
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
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const users = await readUsersByEmailPrefix(prefix);
      if (users.length === count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${count} users with prefix ${prefix}`);
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

  it("rejects disabled-registration bootstrap recovery racers that lose the owner lock", async () => {
    await seedNonBootstrapOwnerUser({
      id: "00000000-0000-4000-8000-000000002604",
      email: "race-seeded-non-owner@example.com"
    });
    await setInstanceSetting("registration.enabled", { value: false });

    const lock = new pg.Client({ connectionString: connectionStrings.bootstrap });
    await lock.connect();
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
      await lock.query("SELECT pg_advisory_unlock(hashtext('jarv1s:first-user-bootstrap'))");

      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
      expect(
        responses
          .filter((response) => response.statusCode === 403)
          .map((response) => response.json<{ code?: string }>().code)
      ).toEqual(["registration_disabled"]);
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
  });
});
