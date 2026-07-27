// tests/integration/job-search-store.test.ts
// Task 13 (#1297): the store against a real database, before any handler depends on it. Mirrors
// tests/integration/job-search-tables-install.test.ts's fresh-install-per-`it` discipline (each
// case reinstalls, afterEach tears everything down), but adds a SECOND kind of fixture: cases 7-8
// exercise the sweep cursor, which `store-sql.ts` deliberately keeps in `ctx.kv`, not a job_search_*
// column (see store-port.ts's comment on getSweepCursor). `ctx.kv` is backed by app.module_kv — a
// CORE platform table (packages/settings/sql/0154, 0157), not a job-search-owned one — so it needs
// a different connection recipe than the job_search_* tables below (see asWorkerKv's comment).
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installModule } from "../../scripts/module-install.js";
import {
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/urls.js";
import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables.js";
import { createSqlStore } from "../../external-modules/job-search/src/worker/store-sql.js";
import type {
  FailureCause,
  Posting
} from "../../external-modules/job-search/src/domain/records.js";
import { resetEmptyFoundationDatabase } from "./test-database.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "job-search";
const runtimeRole = moduleRuntimeRoleName(moduleId);
const ownedTables = JOB_SEARCH_TABLES.map((table) => `app.${table}`);

// Fixed rather than random, same rationale as job-search-tables-install.test.ts: readable in
// failures, safe to reuse across `it`s because afterEach deletes it (CASCADE clears every owned
// row) after every test.
const ownerA = "50000000-0000-4000-8000-000000000011";

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
});

afterEach(async () => {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  for (const table of ownedTables) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  // Same ordering as job-search-tables-install.test.ts's afterEach — see its comments for why
  // CASCADE and this exact revoke order are both required.
  await client.query(
    `REVOKE ALL PRIVILEGES ON SCHEMA app FROM ${moduleInstallRoleName(moduleId)} CASCADE`
  );
  await client.query(`REVOKE ALL PRIVILEGES ON app.users FROM ${moduleInstallRoleName(moduleId)}`);
  await client.query(`REVOKE REFERENCES (id) ON app.users FROM ${moduleInstallRoleName(moduleId)}`);
  await client.query(
    `REVOKE EXECUTE ON FUNCTION app.current_actor_user_id() FROM ` +
      `${moduleInstallRoleName(moduleId)} CASCADE`
  );
  await client.query(`DROP ROLE IF EXISTS ${moduleInstallRoleName(moduleId)}`).catch(() => {});
  await client.query(`DROP ROLE IF EXISTS ${runtimeRole}`).catch(() => {});
  await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [moduleId]);
  // Cases 7-8's fixtures. The bootstrap connection is a superuser role for test setup/teardown
  // only (not a runtime app/worker role) — it bypasses RLS on both tables the way DROP ROLE and
  // the REVOKEs above already do.
  await client.query("DELETE FROM app.module_kv WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.external_modules WHERE id = $1", [moduleId]);
  await client.query("DELETE FROM app.users WHERE id = $1", [ownerA]);
  await client.end();
});

async function install(): Promise<void> {
  await installModule({
    moduleId,
    manifest: { database: { ownedTables } },
    bootstrapConnectionString: urls.bootstrap,
    migrationConnectionString: urls.migration,
    migrationsDirectory: "external-modules/job-search/sql"
  });
}

async function seedUser(id: string): Promise<void> {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, $2, false)",
      [id, `job-search-store-${id}@example.test`]
    );
  } finally {
    await client.end();
  }
}

// Cases 7-8 need `app.external_modules` to carry an enabled row for job-search — the
// module_kv_worker_* policies (0157) require `EXISTS (... module.status = 'enabled')` before any
// jarvis_worker_runtime read/write is allowed, and `installModule()` never touches this table (it
// only journals to app.module_installs, a different bookkeeping table entirely — confirmed by
// reading scripts/module-install.ts's journalUpsert). Real enablement is an admin-only write path
// (packages/settings/sql/0152); a test seeds it directly via the bootstrap superuser instead.
async function seedExternalModuleRow(): Promise<void> {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash)
       VALUES ($1, 'enabled', 'test-hash', 'test-hash')
       ON CONFLICT (id) DO UPDATE SET status = 'enabled'`,
      [moduleId]
    );
  } finally {
    await client.end();
  }
}

// The runtime role is NOLOGIN — connect as the parent role that has it granted WITH INHERIT
// FALSE (jarvis_worker_runtime, i.e. urls.worker), assume it for one transaction with SET LOCAL
// ROLE, and set the actor GUC the same way data-context.ts does in production. Every call opens
// its OWN connection/transaction — this is deliberate, not incidental: it mirrors one ctx.db.query
// call being one RPC round-trip in production (packages/module-sdk/src/worker.ts has no BEGIN),
// and it is what gives case 5's concurrent setResume calls two genuinely separate snapshots.
async function asRuntime<T>(actorUserId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urls.worker });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${runtimeRole}`);
    await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorUserId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

// app.module_kv is a CORE platform table, not a job-search-owned one — the per-module runtime
// role above has no grant on it at all (only jarvis_worker_runtime does, per migration 0157), so
// this does NOT do `SET LOCAL ROLE`. urls.worker already connects AS jarvis_worker_runtime
// (packages/db/src/urls.ts), which is exactly the role the real worker-rpc-host.ts's RPC-parent
// DataContext uses, and 0157's worker policies additionally require `app.current_module_id()` to
// match — the second GUC the real host also sets before every RPC (see 0157's own docstring).
async function asWorkerKv<T>(actorUserId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urls.worker });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorUserId]);
    await client.query("SELECT set_config('app.current_module_id', $1, true)", [moduleId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

// createSqlStore's `db`/`kv` parameter types are structural (SqlDb/SqlKv in store-sql.ts are not
// exported — deliberately: nothing outside that file should hand-roll a third implementation).
// TypeScript still checks these object literals against them at the createSqlStore(...) call
// site below, so a shape mismatch here is still a compile error, not a silent runtime gap.
function dbFor(actorUserId: string) {
  return {
    async query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const result = await asRuntime(actorUserId, (client) =>
        client.query(text, params ? [...params] : undefined)
      );
      // Mirrors the real RPC boundary: ctx.db.query's rows cross a JSON-serialized channel to
      // the module's child process, so a timestamptz column arrives as an ISO string, never a
      // JS Date — node-postgres's raw Client does not do this by itself, and store-sql.ts's row
      // types (e.g. ProfileRow.created_at: string) assume it already has.
      return { rows: JSON.parse(JSON.stringify(result.rows)) as T[] };
    }
  };
}

function kvFor(actorUserId: string) {
  return {
    async get(
      scope: "instance" | "user",
      namespace: string,
      key: string
    ): Promise<Record<string, unknown> | null> {
      const result = await asWorkerKv(actorUserId, (client) =>
        client.query(
          `SELECT value FROM app.module_kv
             WHERE module_id = $1 AND namespace = $2 AND scope = $3
               AND owner_user_id IS NOT DISTINCT FROM $4 AND key = $5`,
          [moduleId, namespace, scope, scope === "user" ? actorUserId : null, key]
        )
      );
      const row = result.rows[0] as { value: Record<string, unknown> } | undefined;
      return row ? row.value : null;
    },
    async set(
      scope: "instance" | "user",
      namespace: string,
      key: string,
      value: Record<string, unknown>
    ): Promise<void> {
      await asWorkerKv(actorUserId, (client) =>
        client.query(
          // Matches module_kv_user_uq's exact column list/predicate (0154) — an ON CONFLICT
          // arbiter must match a real index verbatim, and this test only ever writes scope
          // 'user' (the only scope job-search declares for job-search.meta).
          `INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (module_id, namespace, owner_user_id, key) WHERE scope = 'user' DO UPDATE
             SET value = excluded.value, updated_at = now()`,
          [
            moduleId,
            namespace,
            scope,
            scope === "user" ? actorUserId : null,
            key,
            JSON.stringify(value)
          ]
        )
      );
    }
  };
}

function storeFor(actorUserId: string) {
  return createSqlStore(dbFor(actorUserId), kvFor(actorUserId));
}

function posting(overrides: { sourceId: string; externalId: string } & Partial<Posting>): Posting {
  return {
    id: randomUUID(),
    title: "Staff Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://www.linkedin.com/jobs/1",
    body: "Job body text",
    postedAt: null,
    ...overrides
  };
}

describe("job-search store (#1297)", () => {
  it("orders listProfiles by created_at then id, even when created_at ties (case 1)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);

    // A fast install (or a fast test) can create several profiles inside the same millisecond —
    // created_at is NOT unique, so `id ASC` is the tiebreak Task 15's sweep cursor relies on.
    // Forcing a real tie needs a raw insert; store.createProfile() always uses now().
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const tiedAt = "2026-01-01T00:00:00.000Z";
    for (const id of ids) {
      await asRuntime(ownerA, (client) =>
        client.query(
          `INSERT INTO app.job_search_profiles (id, owner_user_id, name, state, created_at)
           VALUES ($1, $2, 'Same-millisecond profile', 'active', $3)`,
          [id, ownerA, tiedAt]
        )
      );
    }

    const profiles = await store.listProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual([...ids].sort());
  });

  it("upserts a posting twice on the same natural key: one row, updated fields, unchanged first_seen_at (case 2)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");

    const [created] = await store.upsertPostings(profile.id, [
      posting({ sourceId: "linkedin", externalId: "ext-1", title: "Old Title" })
    ]);
    expect(created).toBeDefined();

    const before = await asRuntime(ownerA, (client) =>
      client.query("SELECT first_seen_at FROM app.job_search_postings WHERE id = $1", [created!.id])
    );

    const [updated] = await store.upsertPostings(profile.id, [
      posting({ sourceId: "linkedin", externalId: "ext-1", title: "New Title" })
    ]);

    const after = await asRuntime(ownerA, (client) =>
      client.query("SELECT first_seen_at FROM app.job_search_postings WHERE id = $1", [created!.id])
    );
    const rows = await asRuntime(ownerA, (client) =>
      client.query("SELECT id FROM app.job_search_postings WHERE profile_id = $1", [profile.id])
    );

    expect(rows.rows).toHaveLength(1);
    expect(updated!.id).toBe(created!.id);
    expect(updated!.title).toBe("New Title");
    expect(after.rows[0]!.first_seen_at).toEqual(before.rows[0]!.first_seen_at);
  });

  it("round-trips a 768-dimension embedding through setEmbedding/listUnscoredPostingsWithEmbeddings (case 3)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");
    const [created] = await store.upsertPostings(profile.id, [
      posting({ sourceId: "linkedin", externalId: "ext-1" })
    ]);

    const vector = Array.from({ length: 768 }, (_, index) => index / 1000);
    await store.setEmbedding(created!.id, vector);

    const unscored = await store.listUnscoredPostingsWithEmbeddings(profile.id, 10);
    expect(unscored).toHaveLength(1);
    expect(unscored[0]!.embedding).toHaveLength(768);
    expect(unscored[0]!.embedding[0]).toBeCloseTo(vector[0]!);
    expect(unscored[0]!.embedding[767]).toBeCloseTo(vector[767]!);

    const dims = await asRuntime(ownerA, (client) =>
      client.query(
        "SELECT vector_dims(embedding) AS dims FROM app.job_search_postings WHERE id = $1",
        [created!.id]
      )
    );
    expect(dims.rows[0]!.dims).toBe(768);
  });

  it("excludes a posting once it has a match row, but keeps one that has none (case 4)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");

    const [withMatch] = await store.upsertPostings(profile.id, [
      posting({ sourceId: "linkedin", externalId: "ext-scored" })
    ]);
    const [withoutMatch] = await store.upsertPostings(profile.id, [
      posting({ sourceId: "linkedin", externalId: "ext-unscored" })
    ]);
    const vector = Array.from({ length: 768 }, () => 0.001);
    await store.setEmbedding(withMatch!.id, vector);
    await store.setEmbedding(withoutMatch!.id, vector);

    await asRuntime(ownerA, (client) =>
      client.query(
        `INSERT INTO app.job_search_matches (owner_user_id, profile_id, posting_id, state)
         VALUES ($1, $2, $3, 'unscored')`,
        [ownerA, profile.id, withMatch!.id]
      )
    );

    const unscored = await store.listUnscoredPostingsWithEmbeddings(profile.id, 10);
    expect(unscored.map((row) => row.id)).toEqual([withoutMatch!.id]);
  });

  it("allocates versions 1 and 2 for two concurrent setResume calls, and fails fast for a nonexistent profile (case 5)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");

    // Not awaited individually — Promise.all races two real, separate connections against the
    // same profile. Whichever order the DB actually resolves the lock/retry in, the two versions
    // allocated must be exactly {1, 2}, never a duplicate and never a thrown unique-violation.
    const [first, second] = await Promise.all([
      store.setResume(profile.id, "content-1"),
      store.setResume(profile.id, "content-2")
    ]);
    expect(new Set([first.version, second.version])).toEqual(new Set([1, 2]));

    // Zero rows from the allocation statement has two causes that must not be conflated (see
    // store-sql.ts's setResume comment) — a nonexistent profile must fail on the FIRST attempt's
    // ownership probe, with a message that says so, not "could not allocate ... after 5 attempts".
    await expect(store.setResume(randomUUID(), "orphan")).rejects.toThrow("no such profile");
  });

  it("preserves last_ok_at across a failure write via COALESCE (case 6)", async () => {
    await install();
    await seedUser(ownerA);
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");

    const lastOkAt = "2026-07-01T00:00:00.000Z";
    await store.setPortalState(profile.id, {
      sourceId: "linkedin",
      enabled: true,
      lastOkAt,
      cause: null
    });

    const failureCause: FailureCause = {
      kind: "network",
      sourceId: "linkedin",
      summary: "LinkedIn could not be reached.",
      retrieved: 0,
      expected: null,
      lastOkAt,
      nextAction: "Retrying on the next scheduled crawl.",
      retryAt: null,
      disabled: false
    };
    await store.setPortalState(profile.id, {
      sourceId: "linkedin",
      enabled: true,
      lastOkAt: null,
      cause: failureCause
    });

    const portals = await store.listPortals(profile.id);
    expect(portals).toHaveLength(1);
    // The failure write passed lastOkAt: null — COALESCE in the SQL must keep the previous
    // success timestamp rather than let a failure erase it.
    expect(portals[0]!.lastOkAt).toBe(lastOkAt);
    expect(portals[0]!.cause).toEqual(failureCause);
  });

  it("defaults the sweep cursor to 0 and survives setSweepCursor across a profile delete (case 7)", async () => {
    await install();
    await seedUser(ownerA);
    await seedExternalModuleRow();
    const store = storeFor(ownerA);
    const profile = await store.createProfile("Staff Engineer search");

    expect(await store.getSweepCursor()).toBe(0);

    await store.setSweepCursor(3);

    // The raw payload is an object, {index: 3}, never a bare number — ctx.kv is typed
    // Record<string, unknown> in both directions, so a bare 3 would not even be storable
    // against the real SDK even though it would pass a same-store round-trip test.
    const raw = await asWorkerKv(ownerA, (client) =>
      client.query(
        "SELECT value FROM app.module_kv WHERE module_id = $1 AND namespace = $2 AND key = $3",
        [moduleId, "job-search.meta", "sweep-cursor"]
      )
    );
    expect(raw.rows[0]!.value).toEqual({ index: 3 });

    // The cursor belongs to the sweep, not to whichever profile it happened to be pointing at —
    // deleting that profile must not reset or delete it.
    await asRuntime(ownerA, (client) =>
      client.query("DELETE FROM app.job_search_profiles WHERE id = $1", [profile.id])
    );
    expect(await store.getSweepCursor()).toBe(3);
  });

  it("degrades a corrupt cursor to 0, never NaN (case 8)", async () => {
    await install();
    await seedUser(ownerA);
    await seedExternalModuleRow();
    const store = storeFor(ownerA);

    // Written directly, bypassing setSweepCursor, to simulate a hand-edited or half-written
    // record a real deploy could still carry.
    await asWorkerKv(ownerA, (client) =>
      client.query(
        `INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
         VALUES ($1, $2, 'user', $3, $4, $5::jsonb)`,
        [moduleId, "job-search.meta", ownerA, "sweep-cursor", JSON.stringify({ index: "seven" })]
      )
    );

    expect(await store.getSweepCursor()).toBe(0);
  });
});
