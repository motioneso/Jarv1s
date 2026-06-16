import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import type { PgBoss } from "pg-boss";
import pg from "pg";

import {
  AuthSessionResolver,
  DataContextRunner,
  assertUniqueMigrationVersions,
  createDatabase,
  type AccessContext,
  type JarvisDatabase,
  type MigrationFile
} from "@jarv1s/db";
import { RlsProbeRepository } from "@jarv1s/db/probes";
import {
  RLS_PROBE_QUEUE,
  createPgBossClient,
  registerDataContextWorker,
  sendJob,
  type ActorScopedJobPayload,
  type RlsProbeJobPayload
} from "@jarv1s/jobs";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// Test-only RLS-bypass read of the probe table via a root Kysely handle. This deliberately
// skips `withDataContext`, so it lives in the test harness — never on the shipped
// `DataContextRunner` — to assert that RLS denies rows when no actor context is set.
async function selectVisibleProbeIds(rootDb: Kysely<JarvisDatabase>): Promise<string[]> {
  const rows = await rootDb.selectFrom("app.rls_probe_items").select("id").orderBy("id").execute();

  return rows.map((row) => row.id);
}

describe("MVP foundation scaffold", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: RlsProbeRepository;
  let appBoss: PgBoss;
  let workerBoss: PgBoss;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });

    workerDb = createDatabase({
      connectionString: connectionStrings.worker,
      maxConnections: 1
    });

    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new RlsProbeRepository();

    // Seed app.shares for itemBGrantedToA: userB shares 'view' to userA so the
    // new owner-or-share RLS policy grants userA access (replacing resource_grants).
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "setup:seed-share" },
      async (scopedDb) => {
        await sql`
          insert into app.shares
            (resource_type, resource_id, owner_user_id, grantee_user_id, level)
          values
            ('rls_probe_item', ${ids.itemBGrantedToA}::uuid, ${ids.userB}::uuid, ${ids.userA}::uuid, 'view')
          on conflict (resource_type, resource_id, grantee_user_id) do nothing
        `.execute(scopedDb.db);
      }
    );

    appBoss = createPgBossClient(connectionStrings.app);
    workerBoss = createPgBossClient(connectionStrings.worker);

    await appBoss.start();
    await workerBoss.start();
  });

  afterAll(async () => {
    await Promise.allSettled([
      appBoss?.stop({ graceful: false }),
      workerBoss?.stop({ graceful: false }),
      appDb?.destroy(),
      workerDb?.destroy()
    ]);
  });

  it("applies versioned SQL migrations from an empty database", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          ORDER BY version
        `
      );

      expect(migrations.rows).toEqual([
        { version: "0001", name: "0001_app_schema.sql" },
        { version: "0002", name: "0002_app_rls.sql" },
        { version: "0003", name: "0003_tasks_module.sql" },
        { version: "0004", name: "0004_auth_workspaces_settings.sql" },
        { version: "0005", name: "0005_admin_audit_events.sql" },
        { version: "0006", name: "0006_tasks_drop_workspace_grants.sql" },
        { version: "0008", name: "0008_notifications_module.sql" },
        { version: "0009", name: "0009_connectors_module.sql" },
        { version: "0010", name: "0010_connector_admin_safe_metadata.sql" },
        { version: "0011", name: "0011_calendar_module.sql" },
        { version: "0012", name: "0012_email_module.sql" },
        { version: "0013", name: "0013_ai_module.sql" },
        { version: "0014", name: "0014_chat_module.sql" },
        { version: "0015", name: "0015_briefings_module.sql" },
        { version: "0016", name: "0016_ai_assistant_actions.sql" },
        { version: "0017", name: "0017_shares.sql" },
        { version: "0018", name: "0018_probe_owner_or_share.sql" },
        { version: "0019", name: "0019_tasks_owner_or_share.sql" },
        { version: "0020", name: "0020_calendar_owner_or_share.sql" },
        { version: "0021", name: "0021_email_owner_or_share.sql" },
        { version: "0022", name: "0022_connectors_owner_only.sql" },
        { version: "0023", name: "0023_ai_action_requests_owner_only.sql" },
        { version: "0024", name: "0024_notifications_owner_only.sql" },
        { version: "0025", name: "0025_chat_owner_or_share.sql" },
        { version: "0026", name: "0026_briefings_owner_or_share.sql" },
        { version: "0027", name: "0027_notes_teardown.sql" },
        { version: "0028", name: "0028_workspace_teardown.sql" },
        { version: "0029", name: "0029_fix_notifications_insert_policy.sql" },
        { version: "0030", name: "0030_memory_index.sql" },
        { version: "0031", name: "0031_structured_state.sql" },
        { version: "0032", name: "0032_memory_embedding_768.sql" },
        { version: "0033", name: "0033_ai_auth_method.sql" },
        { version: "0034", name: "0034_chat_status_activity.sql" },
        { version: "0035", name: "0035_chat_messages_update_grant.sql" },
        { version: "0036", name: "0036_chat_worker_runtime_grants.sql" },
        { version: "0037", name: "0037_ai_worker_read_grants.sql" },
        { version: "0038", name: "0038_chat_live_runtime.sql" },
        { version: "0039", name: "0039_tasks_foundation.sql" },
        { version: "0040", name: "0040_memory_chat_source.sql" },
        { version: "0041", name: "0041_memory_facts.sql" },
        { version: "0042", name: "0042_chat_memory_settings.sql" },
        { version: "0043", name: "0043_connector_google_enum.sql" },
        { version: "0044", name: "0044_google_unified_connection.sql" },
        { version: "0045", name: "0045_auth_secret_rls.sql" },
        { version: "0046", name: "0046_auth_sessions_rls.sql" },
        { version: "0047", name: "0047_users_rls_tighten.sql" },
        { version: "0048", name: "0048_ai_model_tier.sql" },
        { version: "0049", name: "0049_chat_conversation_summary.sql" },
        { version: "0050", name: "0050_multi_user_accounts.sql" },
        { version: "0051", name: "0051_fix_current_actor_user_id_grant.sql" },
        { version: "0052", name: "0052_fix_admin_select_policy.sql" },
        { version: "0053", name: "0053_users_guard_admin_flag.sql" },
        { version: "0054", name: "0054_worker_memory_rls.sql" },
        { version: "0055", name: "0055_users_guard_admin_flag_v2.sql" },
        { version: "0056", name: "0056_drop_dead_workspace_subsystem.sql" },
        { version: "0057", name: "0057_revoke_app_runtime_chat_update.sql" },
        { version: "0058", name: "0058_chat_threads_incognito_immutable.sql" },
        { version: "0059", name: "0059_admin_tables_rls.sql" },
        { version: "0060", name: "0060_chat_memory_settings_to_role.sql" },
        { version: "0061", name: "0061_memory_facts_to_role.sql" },
        { version: "0062", name: "0062_task_tag_assignments_ownership.sql" },
        { version: "0063", name: "0063_tasks_fk_indexes.sql" },
        { version: "0064", name: "0064_chat_memory_facts_source_thread_idx.sql" },
        { version: "0065", name: "0065_module_enablement.sql" },
        { version: "0066", name: "0066_calendar_worker_grants_and_google_insert.sql" },
        { version: "0067", name: "0067_email_summary_signals_columns.sql" },
        { version: "0068", name: "0068_email_worker_grants_and_google_insert.sql" },
        { version: "0069", name: "0069_connector_worker_runtime_grants.sql" },
        { version: "0070", name: "0070_commitments_worker_grant.sql" },
        { version: "0071", name: "0071_notifications_worker_insert_grant.sql" },
        { version: "0075", name: "0075_tasks_worker_recurrence_grant.sql" },
        { version: "0079", name: "0079_member_onboarding.sql" },
        { version: "0082", name: "0082_wellness_checkins.sql" },
        { version: "0083", name: "0083_wellness_medications.sql" },
        { version: "0084", name: "0084_wellness_medication_logs.sql" },
        { version: "0085", name: "0085_briefing_runs_owner_only_select.sql" },
        {
          version: "0086",
          name: "0086_module_enablement_instance_select_actor_guard.sql"
        },
        {
          version: "0087",
          name: "0087_calendar_events_update_connector_scope.sql"
        },
        { version: "0088", name: "0088_wellness_emotion_taxonomy.sql" },
        { version: "0089", name: "0089_wellness_therapy_notes.sql" },
        { version: "0090", name: "0090_chat_memory_facts_provenance.sql" },
        { version: "0092", name: "0092_inferred_patterns_suppression.sql" },
        { version: "0093", name: "0093_preferences_worker_runtime_grants.sql" }
      ]);
    } finally {
      await client.end();
    }
  });

  it("keeps runtime roles from owning protected tables or bypassing RLS", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });

    await client.connect();
    try {
      const roles = await client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `
          SELECT rolname, rolsuper, rolbypassrls
          FROM pg_roles
          WHERE rolname IN ('jarvis_app_runtime', 'jarvis_worker_runtime')
          ORDER BY rolname
        `
      );

      const owner = await client.query<{ tableowner: string }>(
        `
          SELECT tableowner
          FROM pg_tables
          WHERE schemaname = 'app'
            AND tablename = 'rls_probe_items'
        `
      );

      expect(roles.rows).toEqual([
        { rolname: "jarvis_app_runtime", rolsuper: false, rolbypassrls: false },
        { rolname: "jarvis_worker_runtime", rolsuper: false, rolbypassrls: false }
      ]);
      expect(owner.rows[0]?.tableowner).toBe("jarvis_migration_owner");
    } finally {
      await client.end();
    }
  });

  it("denies protected rows when no app context is set", async () => {
    await expect(selectVisibleProbeIds(appDb)).resolves.toEqual([]);
    await expect(selectVisibleProbeIds(workerDb)).resolves.toEqual([]);
  });

  it("resolves a session to app authz context and lets a user read their own private row", async () => {
    const accessContext = await auth.resolveAccessContext(ids.sessionA, "request:user-a");

    const item = await dataContext.withDataContext(accessContext, (scopedDb) =>
      repository.getById(scopedDb, ids.itemAOwnPrivate)
    );

    expect(accessContext.actorUserId).toBe(ids.userA);
    expect(item?.id).toBe(ids.itemAOwnPrivate);
  });

  it("prevents a user from reading another user's unshared private row", async () => {
    const item = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBPrivate)
    );

    expect(item).toBeUndefined();
  });

  describe("transient view share (isolated)", () => {
    afterAll(async () => {
      // Delete only the specific share created by this test; the beforeAll-seeded
      // share for itemBGrantedToA (resource_id = ids.itemBGrantedToA) is untouched.
      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "request:share-teardown" },
        async (scopedDb) => {
          await scopedDb.db
            .deleteFrom("app.shares")
            .where("resource_type", "=", "rls_probe_item")
            .where("resource_id", "=", ids.itemAOwnPrivate)
            .where("grantee_user_id", "=", ids.userB)
            .execute();
        }
      );
    });

    it("allows probe access through a view share", async () => {
      // userA owns a probe row; share 'view' to userB so the new owner-or-share
      // policy grants userB SELECT access.
      await dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "request:share-setup" },
        async (scopedDb) => {
          await sql`
            insert into app.shares
              (resource_type, resource_id, owner_user_id, grantee_user_id, level)
            values
              ('rls_probe_item', ${ids.itemAOwnPrivate}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, 'view')
          `.execute(scopedDb.db);
        }
      );

      const visibleToB = await dataContext.withDataContext(
        { actorUserId: ids.userB, requestId: "request:user-b" },
        (scopedDb) =>
          scopedDb.db
            .selectFrom("app.rls_probe_items")
            .selectAll()
            .where("id", "=", ids.itemAOwnPrivate)
            .executeTakeFirst()
      );

      expect(visibleToB?.id).toBe(ids.itemAOwnPrivate);
    });
  });

  it("share isolation: seeded itemBGrantedToA survives and transient itemAOwnPrivate share is gone", async () => {
    // (a) The teardown in the transient-share describe deletes only the itemAOwnPrivate
    // share — the beforeAll-seeded itemBGrantedToA share must remain, so userA still sees it.
    const seededStillVisible = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBGrantedToA)
    );
    expect(seededStillVisible?.id).toBe(ids.itemBGrantedToA);

    // (b) The transient share for itemAOwnPrivate was removed — userB must no longer see it.
    // If the targeted afterAll delete silently fails or its where-clause drifts, this fails.
    const transientGone = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "request:user-b-isolation" },
      (scopedDb) =>
        scopedDb.db
          .selectFrom("app.rls_probe_items")
          .selectAll()
          .where("id", "=", ids.itemAOwnPrivate)
          .executeTakeFirst()
    );
    expect(transientGone).toBeUndefined();
  });

  it("does not let an instance admin read another user's private row by role alone", async () => {
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin");

    const item = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, ids.itemBPrivate)
    );

    expect(item).toBeUndefined();
  });

  it("allows access through an app.shares view grant", async () => {
    // itemBGrantedToA is owned by userB; a view share to userA was seeded in
    // beforeAll — the new owner-or-share policy must honour it.
    const item = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, ids.itemBGrantedToA)
    );

    expect(item?.id).toBe(ids.itemBGrantedToA);
  });

  it("does not leak SET LOCAL identity across pooled requests", async () => {
    await dataContext.withDataContext(userAContext(), async (scopedDb) => {
      const visibleIds = (await repository.listVisible(scopedDb)).map((item) => item.id);
      expect(visibleIds).toContain(ids.itemAOwnPrivate);
    });

    await expect(selectVisibleProbeIds(appDb)).resolves.toEqual([]);
  });

  it("clears transaction-local context after rollback", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), async (scopedDb) => {
        await expect(repository.getById(scopedDb, ids.itemAOwnPrivate)).resolves.toBeDefined();
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");

    await expect(selectVisibleProbeIds(appDb)).resolves.toEqual([]);
  });

  it("fails loudly when a repository is called without the data-context wrapper", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  it("runs pg-boss clients without runtime migration privileges", async () => {
    await expect(appBoss.schemaVersion()).resolves.toBeGreaterThan(0);
    await expect(workerBoss.schemaVersion()).resolves.toBeGreaterThan(0);

    await expect(appBoss.createQueue("runtime-created-queue")).rejects.toThrow(
      /permission denied/i
    );
  });

  it("processes a metadata-only job through stored actor context without bypassing RLS", async () => {
    const resultPromise = handleNextProbeJob(workerBoss, ids.itemBPrivate);

    const jobId = await appBoss.send(RLS_PROBE_QUEUE, {
      actorUserId: ids.userA,
      targetItemId: ids.itemBPrivate
    } satisfies RlsProbeJobPayload);

    const result = await resultPromise;

    expect(jobId).toBeTypeOf("string");
    expect(result.targetItemVisible).toBe(false);
    expect(result.ownItemVisible).toBe(true);
    // itemBGrantedToA is visible via an app.shares 'view' row seeded in beforeAll
    expect(result.grantedItemVisible).toBe(true);
    // itemBWorkspacePrivate has no share to userA — must remain invisible
    expect(result.workspacePrivateItemVisible).toBe(false);
  });

  it("confirms workspace/grant tables are absent after DROP migration", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'app'
           AND table_name IN ('workspaces','workspace_memberships','resource_grants')`
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it("keeps pg-boss metadata outside protected app tables and payloads minimal", async () => {
    await appBoss.send(RLS_PROBE_QUEUE, {
      actorUserId: ids.userA,
      targetItemId: ids.itemBPrivate
    } satisfies RlsProbeJobPayload);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const metadata = await client.query<{
        schema_name: string;
        table_name: string;
      }>(
        `
          SELECT table_schema AS schema_name, table_name
          FROM information_schema.tables
          WHERE table_schema IN ('app', 'pgboss')
            AND table_name IN ('rls_probe_items', 'job_common')
          ORDER BY table_schema, table_name
        `
      );

      const payloads = await client.query<{ data: Record<string, unknown> }>(
        `
          SELECT data
          FROM pgboss.job_common
          WHERE name = $1
          ORDER BY created_on DESC
          LIMIT 1
        `,
        [RLS_PROBE_QUEUE]
      );

      expect(metadata.rows).toEqual([
        { schema_name: "app", table_name: "rls_probe_items" },
        { schema_name: "pgboss", table_name: "job_common" }
      ]);
      expect(payloads.rows[0]?.data).toEqual({
        actorUserId: ids.userA,
        targetItemId: ids.itemBPrivate
      });
      expect(payloads.rows[0]?.data).not.toHaveProperty("body");
    } finally {
      await client.end();
    }
  });
});

describe("sendJob send-side guard (#157)", () => {
  it("throws when payload contains a forbidden key 'content'", async () => {
    const fakeBoss = { send: async () => "fake-id" } as unknown as PgBoss;
    await expect(
      sendJob(fakeBoss, "test-queue", {
        actorUserId: "00000000-0000-4000-8000-000000000001",
        content: "secret"
      } as unknown as ActorScopedJobPayload)
    ).rejects.toThrow("Job payload contains non-metadata keys: content");
  });

  it("does not throw for a valid metadata-only payload", async () => {
    let sent = false;
    const fakeBoss = {
      send: async () => {
        sent = true;
        return "fake-id";
      }
    } as unknown as PgBoss;
    await sendJob(fakeBoss, "test-queue", {
      actorUserId: "00000000-0000-4000-8000-000000000001",
      taskId: "some-task-id",
      requestedStatus: "done",
      idempotencyKey: "k1"
    } as unknown as ActorScopedJobPayload);
    expect(sent).toBe(true);
  });
});

describe("assertUniqueMigrationVersions (#124)", () => {
  it("throws when two migration files from different directories share the same version prefix", () => {
    const files: MigrationFile[] = [
      { version: "0055", name: "0055_foo.sql", checksum: "aaa", sql: "SELECT 1;" },
      { version: "0055", name: "0055_bar.sql", checksum: "bbb", sql: "SELECT 2;" }
    ];
    expect(() => assertUniqueMigrationVersions(files)).toThrow(
      "Duplicate migration version numbers across directories: 0055"
    );
  });

  it("does not throw when all version prefixes are unique", () => {
    const files: MigrationFile[] = [
      { version: "0054", name: "0054_a.sql", checksum: "aaa", sql: "SELECT 1;" },
      { version: "0055", name: "0055_b.sql", checksum: "bbb", sql: "SELECT 2;" }
    ];
    expect(() => assertUniqueMigrationVersions(files)).not.toThrow();
  });
});

describe("chat_threads incognito immutability trigger (#135)", () => {
  const threadId = "99000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    await resetFoundationDatabase();
    // Seed via bootstrap (superuser) to bypass FORCE RLS on chat_threads.
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.chat_threads (id, owner_user_id, title, incognito)
         VALUES ($1, $2, 'Test Thread', false)`,
        [threadId, ids.userA]
      );
    } finally {
      await client.end();
    }
  });

  it("raises 42501 when attempting to UPDATE incognito on an existing chat_thread", async () => {
    // Trigger fires for all roles including superuser.
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await expect(
        client.query(`UPDATE app.chat_threads SET incognito = true WHERE id = $1`, [threadId])
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.end();
    }
  });

  it("does NOT raise on UPDATE of a non-incognito column (title)", async () => {
    // Must set actor context so enforce_chat_thread_update_scope allows the owner to rename.
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_user_id', $1, true)", [ids.userA]);
      const result = await client.query(
        `UPDATE app.chat_threads SET title = 'Renamed Thread' WHERE id = $1`,
        [threadId]
      );
      await client.query("COMMIT");
      expect(result.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe("pgboss narrowed grants (#174)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("jarvis_app_runtime cannot UPDATE pgboss.job after narrowing", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'update') AS has_privilege`
      );
      expect(result.rows[0]?.has_privilege).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("jarvis_worker_runtime can UPDATE pgboss.job after narrowing", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('jarvis_worker_runtime', 'pgboss.job', 'update') AS has_privilege`
      );
      expect(result.rows[0]?.has_privilege).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("jarvis_app_runtime can SELECT pgboss.queue (required for boss.send)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.queue', 'select') AS has_privilege`
      );
      expect(result.rows[0]?.has_privilege).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("jarvis_app_runtime cannot DELETE from pgboss.job", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'delete') AS has_privilege`
      );
      expect(result.rows[0]?.has_privilege).toBe(false);
    } finally {
      await client.end();
    }
  });
});

describe("chat_messages UPDATE grant revoked + policy narrowed (#134)", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("jarvis_app_runtime cannot UPDATE app.chat_messages after migration", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('jarvis_app_runtime', 'app.chat_messages', 'update') AS has_privilege`
      );
      expect(result.rows[0]?.has_privilege).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("chat_messages_update policy targets only jarvis_worker_runtime and keeps owner scoping", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const result = await client.query<{
        roles: string[];
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT roles, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'app'
            AND tablename = 'chat_messages'
            AND policyname = 'chat_messages_update'`
      );
      const policy = result.rows[0];
      expect(policy).toBeDefined();
      expect(policy?.roles).toContain("jarvis_worker_runtime");
      expect(policy?.roles).not.toContain("jarvis_app_runtime");
      // Postgres may print qualified form (app.current_actor_user_id) or unqualified.
      // The invariant: predicate is owner-scoped, NOT simply `true`.
      expect(policy?.qual).toContain("owner_user_id");
      expect(policy?.qual).toContain("current_actor_user_id()");
      expect(policy?.with_check).toContain("owner_user_id");
      expect(policy?.with_check).toContain("current_actor_user_id()");
    } finally {
      await client.end();
    }
  });
});

interface ProbeJobResult {
  readonly targetItemVisible: boolean;
  readonly ownItemVisible: boolean;
  readonly grantedItemVisible: boolean;
  readonly workspacePrivateItemVisible: boolean;
}

async function handleNextProbeJob(
  workerBoss: PgBoss,
  expectedTargetItemId: string
): Promise<ProbeJobResult> {
  const workerDb = createDatabase({
    connectionString: connectionStrings.worker,
    maxConnections: 1
  });
  const dataContext = new DataContextRunner(workerDb);
  const repository = new RlsProbeRepository();
  let workId: string | undefined;

  try {
    const resultPromise = new Promise<ProbeJobResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for pg-boss worker"));
      }, 10_000);

      registerDataContextWorker<RlsProbeJobPayload, ProbeJobResult>(
        workerBoss,
        RLS_PROBE_QUEUE,
        dataContext,
        async (job, scopedDb) => {
          try {
            expect(job.data.targetItemId).toBe(expectedTargetItemId);

            const [targetItem, ownItem, grantedItem, workspacePrivateItem] = await Promise.all([
              repository.getById(scopedDb, job.data.targetItemId),
              repository.getById(scopedDb, ids.itemAOwnPrivate),
              repository.getById(scopedDb, ids.itemBGrantedToA),
              repository.getById(scopedDb, ids.itemBWorkspacePrivate)
            ]);

            const result = {
              targetItemVisible: targetItem !== undefined,
              ownItemVisible: ownItem !== undefined,
              grantedItemVisible: grantedItem !== undefined,
              workspacePrivateItemVisible: workspacePrivateItem !== undefined
            };

            clearTimeout(timeout);
            resolve(result);
            return result;
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
            throw error;
          }
        },
        { pollingIntervalSeconds: 0.5 }
      )
        .then((registeredWorkId) => {
          workId = registeredWorkId;
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });

    return await resultPromise;
  } finally {
    if (workId) {
      await workerBoss.offWork(RLS_PROBE_QUEUE, { id: workId, wait: true });
    }
    await workerDb.destroy();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a"
  };
}
