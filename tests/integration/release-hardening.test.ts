import { beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import pg from "pg";

import { AuthSessionResolver, createDatabase } from "@jarv1s/db";
import { createBackupPlan } from "../../scripts/backup-database.js";
import { auditReleaseHardening } from "../../scripts/audit-release-hardening.js";
import { deleteUserData } from "../../scripts/delete-user-data.js";
import { createComposeSmokePlan } from "../../scripts/smoke-compose.js";
import { exportUserData } from "../../scripts/export-user-data.js";
import { createRestorePlan } from "../../scripts/restore-database.js";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const releaseIds = {
  userATask: "81000000-0000-4000-8000-000000000001",
  userBTask: "81000000-0000-4000-8000-000000000002",
  connectorAccount: "83000000-0000-4000-8000-000000000001",
  calendarEvent: "84000000-0000-4000-8000-000000000001",
  emailMessage: "85000000-0000-4000-8000-000000000001",
  aiProvider: "86000000-0000-4000-8000-000000000001",
  aiModel: "87000000-0000-4000-8000-000000000001"
} as const;

describe("M7 release hardening lifecycle scripts", () => {
  beforeEach(async () => {
    await resetEmptyFoundationDatabase();
    await seedLifecycleData();
  });

  it("exports user-owned data through the app role without secret material or shared private rows", async () => {
    const userExport = await exportUserData({
      appConnectionString: connectionStrings.app,
      exportedAt: new Date("2026-06-06T12:00:00.000Z"),
      userId: ids.userA
    });
    const exportedJson = JSON.stringify(userExport);

    expect(userExport).toMatchObject({
      exportedAt: "2026-06-06T12:00:00.000Z",
      userId: ids.userA
    });
    expect(userExport.tables.users).toEqual([
      expect.objectContaining({
        email: "user-a@example.test",
        id: ids.userA
      })
    ]);
    expect(userExport.tables.tasks).toEqual([
      expect.objectContaining({
        id: releaseIds.userATask,
        title: "User A exportable task"
      })
    ]);
    expect(userExport.tables.connectorAccounts).toEqual([
      expect.objectContaining({
        hasSecret: true,
        id: releaseIds.connectorAccount,
        providerId: "google-calendar"
      })
    ]);
    expect(userExport.tables.aiProviderConfigs).toEqual([
      expect.objectContaining({
        hasCredential: true,
        id: releaseIds.aiProvider
      })
    ]);
    expect(exportedJson).not.toContain("connector-ciphertext-sentinel");
    expect(exportedJson).not.toContain("ai-ciphertext-sentinel");
    expect(exportedJson).not.toContain("auth-access-token-sentinel");
    expect(exportedJson).not.toContain("auth-refresh-token-sentinel");
    expect(exportedJson).not.toContain("auth-id-token-sentinel");
    expect(exportedJson).not.toContain("auth-password-sentinel");
    expect(exportedJson).not.toContain("better-auth-session-token-sentinel");
    expect(exportedJson).not.toContain("User B private task granted to A");
    expect(Object.keys(userExport.tables.connectorAccounts[0] ?? {})).not.toContain(
      "encryptedSecret"
    );
    expect(Object.keys(userExport.tables.aiProviderConfigs[0] ?? {})).not.toContain(
      "encryptedCredential"
    );
  });

  it("deletes one user only after exact confirmation and records metadata-only audit", async () => {
    const result = await deleteUserData({
      actorUserId: ids.userB,
      bootstrapConnectionString: connectionStrings.bootstrap,
      confirmUserId: ids.userA,
      dryRun: false,
      userId: ids.userA
    });
    const rows = await readLifecycleRows();
    const auditJson = JSON.stringify(rows.auditMetadata);

    expect(result.dryRun).toBe(false);
    expect(result.deleted).toBe(true);
    expect(result.countsBeforeDelete["app.users"]).toBe(1);
    expect(rows.userAExists).toBe(false);
    expect(rows.userBExists).toBe(true);
    expect(rows.userBTaskExists).toBe(true);
    expect(rows.userAConnectorRows).toBe(0);
    expect(rows.userAAiProviderRows).toBe(0);
    expect(rows.auditAction).toBe("user.delete");
    expect(rows.auditTargetId).toBe(ids.userA);
    expect(auditJson).not.toContain("connector-ciphertext-sentinel");
    expect(auditJson).not.toContain("ai-ciphertext-sentinel");
    expect(auditJson).not.toContain("User A exportable task");
  });

  it("refuses destructive user deletion when the confirmation does not match", async () => {
    await expect(
      deleteUserData({
        actorUserId: ids.userB,
        bootstrapConnectionString: connectionStrings.bootstrap,
        confirmUserId: ids.userB,
        dryRun: false,
        userId: ids.userA
      })
    ).rejects.toThrow("Confirmation user id must match the target user id");
  });

  it("keeps app and worker roles without DELETE on protected product and secret tables", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });

    await client.connect();
    try {
      const privileges = await client.query<{
        app_can_delete: boolean;
        table_name: string;
        worker_can_delete: boolean;
      }>(
        `
          SELECT
            c.relname AS table_name,
            has_table_privilege('jarvis_app_runtime', c.oid, 'DELETE') AS app_can_delete,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname = ANY($1::text[])
          ORDER BY c.relname
        `,
        [
          [
            "ai_configured_models",
            "ai_provider_configs",
            "briefing_definitions",
            "briefing_runs",
            "calendar_events",
            "chat_messages",
            "chat_threads",
            "connector_accounts",
            "email_messages",
            "notifications",
            "tasks"
          ]
        ]
      );

      expect(privileges.rows).toHaveLength(11);
      expect(privileges.rows).toEqual(
        privileges.rows.map((row) => ({
          ...row,
          app_can_delete: false,
          worker_can_delete: false
        }))
      );
    } finally {
      await client.end();
    }
  });

  it("audits runtime roles, forced RLS, protected DELETE grants, and admin audit privileges", async () => {
    const report = await auditReleaseHardening({
      bootstrapConnectionString: connectionStrings.bootstrap
    });

    expect(report.passed).toBe(true);
    expect(report.roles).toEqual([
      {
        bypassRls: false,
        canCreateDb: false,
        canCreateRole: false,
        isSuperuser: false,
        roleName: "jarvis_app_runtime"
      },
      {
        bypassRls: false,
        canCreateDb: false,
        canCreateRole: false,
        isSuperuser: false,
        roleName: "jarvis_auth_runtime"
      },
      {
        bypassRls: false,
        canCreateDb: false,
        canCreateRole: false,
        isSuperuser: false,
        roleName: "jarvis_migration_owner"
      },
      {
        bypassRls: false,
        canCreateDb: false,
        canCreateRole: false,
        isSuperuser: false,
        roleName: "jarvis_worker_runtime"
      }
    ]);
    expect(report.protectedTables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appCanDelete: false,
          forceRls: true,
          tableName: "tasks",
          workerCanDelete: false
        }),
        expect.objectContaining({
          appCanDelete: false,
          forceRls: true,
          tableName: "connector_accounts",
          workerCanDelete: false
        }),
        expect.objectContaining({
          appCanDelete: false,
          forceRls: true,
          tableName: "ai_provider_configs",
          workerCanDelete: false
        }),
        expect.objectContaining({
          appCanDelete: false,
          forceRls: true,
          tableName: "ai_assistant_action_requests",
          workerCanDelete: false
        })
      ])
    );
    expect(report.transientTables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          forceRls: true,
          rlsEnabled: true,
          tableName: "connector_oauth_pending"
        })
      ])
    );
    expect(report.authSecretTables).toEqual(
      expect.arrayContaining([
        {
          appCanSelect: false,
          forceRls: true,
          rlsEnabled: true,
          tableName: "auth_accounts"
        },
        {
          appCanSelect: false,
          forceRls: true,
          rlsEnabled: true,
          tableName: "auth_sessions"
        },
        {
          appCanSelect: false,
          forceRls: true,
          rlsEnabled: true,
          tableName: "auth_verifications"
        },
        {
          appCanSelect: false,
          forceRls: true,
          rlsEnabled: true,
          tableName: "better_auth_sessions"
        }
      ])
    );
    expect(report.authOwnerTable).toEqual(
      expect.arrayContaining([
        {
          appCanSelect: true,
          // ENABLE but not FORCE: owner (jarvis_migration_owner) must bypass for SECURITY DEFINER
          // functions that query users for admin checks (e.g. list_connector_account_safe_metadata).
          forceRls: false,
          rlsEnabled: true,
          tableName: "users"
        }
      ])
    );
    expect(report.adminAuditPrivileges).toEqual({
      appCanDelete: false,
      appCanInsert: true,
      appCanSelect: true,
      appCanUpdate: false,
      workerCanDelete: false,
      workerCanInsert: false,
      workerCanSelect: false,
      workerCanUpdate: false
    });
    expect(report.failures).toEqual([]);
  });

  it("builds backup, restore, and Docker Compose smoke plans without exposing database passwords", () => {
    const backupPlan = createBackupPlan({
      connectionString: "postgres://postgres:super-secret@db.example.test:5432/jarv1s",
      outputFile: "backups/jarv1s-test.dump"
    });
    const restorePlan = createRestorePlan({
      backupFile: "backups/jarv1s-test.dump",
      confirmRestore: true,
      connectionString: "postgres://postgres:super-secret@db.example.test:5432/jarv1s",
      execute: true
    });
    const composePlan = createComposeSmokePlan({
      apiPort: "3900",
      composeFile: "infra/docker-compose.yml"
    });

    expect(backupPlan.command).toBe("pg_dump");
    expect(backupPlan.args).toContain("backups/jarv1s-test.dump");
    expect(backupPlan.env.PGPASSWORD).toBe("super-secret");
    expect(`${backupPlan.command} ${backupPlan.args.join(" ")}`).not.toContain("super-secret");
    expect(restorePlan.command).toBe("pg_restore");
    expect(restorePlan.args).toContain("--clean");
    expect(restorePlan.args).toContain("--if-exists");
    expect(restorePlan.args).toContain("--no-owner");
    expect(restorePlan.args).toContain("--no-privileges");
    expect(restorePlan.args).toContain("backups/jarv1s-test.dump");
    expect(restorePlan.env.PGPASSWORD).toBe("super-secret");
    expect(`${restorePlan.command} ${restorePlan.args.join(" ")}`).not.toContain("super-secret");
    expect(composePlan.healthUrl).toBe("http://localhost:3900/health");
    expect(JSON.stringify(composePlan.commands)).toContain("infra/docker-compose.yml");
    expect(JSON.stringify(composePlan.commands)).not.toContain("postgres://");
    expect(
      composePlan.commands.some((c) => c.args.includes("api") && c.args.includes("--wait"))
    ).toBe(true);
  });

  it("requires explicit restore confirmation before destructive execution", () => {
    expect(() =>
      createRestorePlan({
        backupFile: "backups/jarv1s-test.dump",
        confirmRestore: false,
        connectionString: "postgres://postgres:super-secret@db.example.test:5432/jarv1s",
        execute: true
      })
    ).toThrow("Restore execution requires --confirm-restore");
  });

  it("keeps Docker Compose node installs isolated from host node_modules", async () => {
    const composeFile = await readFile("infra/docker-compose.yml", "utf8");

    expect(composeFile).toContain("- /workspace/node_modules");
    expect(composeFile).toContain("- /workspace/apps/api/node_modules");
    expect(composeFile).toContain("- /workspace/apps/web/node_modules");
    expect(composeFile).toContain("- /workspace/apps/worker/node_modules");
    expect(composeFile).toContain("- /workspace/packages/ai/node_modules");
    expect(composeFile).toContain('CI: "true"');
    expect(composeFile).toContain("--store-dir /tmp/pnpm-store");
  });

  it("documents production environment variables without development secrets", async () => {
    const envExample = await readFile("infra/env.production.example", "utf8");
    const operationsDoc = await readFile("docs/operations/release-hardening.md", "utf8");

    for (const variable of [
      "NODE_ENV=production",
      "JARVIS_BOOTSTRAP_DATABASE_URL=",
      "JARVIS_MIGRATION_DATABASE_URL=",
      "JARVIS_APP_DATABASE_URL=",
      "JARVIS_AUTH_DATABASE_URL=",
      "JARVIS_WORKER_DATABASE_URL=",
      "BETTER_AUTH_SECRET=",
      "JARVIS_AUTH_BASE_URL=",
      "JARVIS_AUTH_TRUSTED_ORIGINS=",
      "JARVIS_CONNECTOR_SECRET_KEY=",
      "JARVIS_AI_SECRET_KEY=",
      "JARVIS_API_PORT=",
      "JARVIS_WEB_PORT=",
      "JARVIS_DOCKER_SUBNET=",
      "JARVIS_AUTH_GOOGLE_CLIENT_ID=",
      "JARVIS_AUTH_GITHUB_CLIENT_ID=",
      "JARVIS_AUTH_MICROSOFT_CLIENT_ID=",
      "JARVIS_AUTH_OIDC_DISCOVERY_URL="
    ]) {
      expect(envExample).toContain(variable);
    }

    expect(envExample).not.toContain("postgres:postgres");
    expect(envExample).not.toContain("migration_password");
    expect(envExample).not.toContain("app_password");
    expect(envExample).not.toContain("worker_password");
    expect(envExample).not.toContain("dev-only");
    expect(operationsDoc).toContain("infra/env.production.example");
    expect(operationsDoc).toContain("BETTER_AUTH_SECRET");
    expect(operationsDoc).toContain("JARVIS_CONNECTOR_SECRET_KEY");
    expect(operationsDoc).toContain("JARVIS_AI_SECRET_KEY");
  });

  it("denies app_runtime and worker_runtime direct SELECT on auth_sessions and auth_verifications", async () => {
    const appClient = new pg.Client({ connectionString: connectionStrings.app });
    const workerClient = new pg.Client({ connectionString: connectionStrings.worker });

    await Promise.all([appClient.connect(), workerClient.connect()]);
    try {
      await expect(appClient.query("SELECT id FROM app.auth_sessions LIMIT 1")).rejects.toThrow();
      await expect(
        workerClient.query("SELECT id FROM app.auth_sessions LIMIT 1")
      ).rejects.toThrow();
      await expect(
        appClient.query("SELECT id FROM app.auth_verifications LIMIT 1")
      ).rejects.toThrow();
      await expect(
        workerClient.query("SELECT id FROM app.auth_verifications LIMIT 1")
      ).rejects.toThrow();
    } finally {
      await Promise.all([appClient.end(), workerClient.end()]);
    }
  });

  it("enforces self-row restriction on users SELECT for jarvis_app_runtime (GUC set = own row only)", async () => {
    // users userA and userB are already seeded by beforeEach (seedLifecycleData).
    // Connect as jarvis_app_runtime, set GUC to userA (session-level).
    // self-row policy: only userA visible → count of {userA, userB} = 1.
    // On origin/main: USING(true) → both visible → count = 2 → test FAILS (RED).
    // After migration 0047: self-row → count = 1 → test PASSES (GREEN).
    const appClient = new Client({ connectionString: connectionStrings.app });

    await appClient.connect();
    try {
      await appClient.query("SELECT set_config('app.actor_user_id', $1, false)", [ids.userA]);
      const result = await appClient.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.users WHERE id IN ($1::uuid, $2::uuid)",
        [ids.userA, ids.userB]
      );
      expect(result.rows[0]?.count).toBe("1");
    } finally {
      await appClient.end();
    }
  });

  it("AuthSessionResolver resolves bearer tokens via the security definer function", async () => {
    const testSessionId = "40000000-ffff-4000-8000-999999999999";
    const bootstrapClient = new pg.Client({ connectionString: connectionStrings.bootstrap });

    await bootstrapClient.connect();
    try {
      await bootstrapClient.query(
        "INSERT INTO app.auth_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [testSessionId, ids.userA]
      );
    } finally {
      await bootstrapClient.end();
    }

    const appDb = createDatabase({ connectionString: connectionStrings.app });
    try {
      const resolver = new AuthSessionResolver(appDb);
      const context = await resolver.resolveAccessContext(testSessionId, "request:test");

      expect(context.actorUserId).toBe(ids.userA);
      expect(context.requestId).toBe("request:test");
    } finally {
      await appDb.destroy();
    }
  });

  it("defines CI automation for foundation, release hardening, audit, web, and Compose smoke", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("pnpm verify:foundation");
    expect(workflow).toContain("pnpm test:release-hardening");
    expect(workflow).toContain("pnpm audit:release-hardening");
    expect(workflow).toContain("pnpm build:web");
    expect(workflow).toContain("pnpm test:e2e");
    expect(workflow).toContain("pnpm smoke:compose -- --api-port 3099");
    expect(workflow).toContain('JARVIS_API_PORT: "3099"');
    expect(workflow).toContain('JARVIS_WEB_PORT: "5180"');
    expect(workflow).toContain("docker compose -f infra/docker-compose.yml down -v");
  });
});

async function seedLifecycleData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.users (id, email, name, is_instance_admin)
        VALUES
          ($1, 'user-a@example.test', 'User A', false),
          ($2, 'user-b@example.test', 'User B', false)
      `,
      [ids.userA, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.auth_accounts (
          account_id,
          provider_id,
          user_id,
          access_token,
          refresh_token,
          id_token,
          password,
          scope
        )
        VALUES (
          'account-a',
          'credential',
          $1,
          'auth-access-token-sentinel',
          'auth-refresh-token-sentinel',
          'auth-id-token-sentinel',
          'auth-password-sentinel',
          'openid email'
        )
      `,
      [ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.better_auth_sessions (expires_at, token, user_id)
        VALUES (now() + interval '1 hour', 'better-auth-session-token-sentinel', $1)
      `,
      [ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.task_lists (owner_user_id, name)
        VALUES ($1, 'Personal'), ($2, 'Personal')
        ON CONFLICT DO NOTHING
      `,
      [ids.userA, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.tasks (id, owner_user_id, title, description, list_id)
        VALUES
          ($1, $2, 'User A exportable task', 'User A private task body',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $2 AND name = 'Personal' LIMIT 1)),
          ($3, $4, 'User B private task granted to A', 'User B private task body',
            (SELECT id FROM app.task_lists WHERE owner_user_id = $4 AND name = 'Personal' LIMIT 1))
      `,
      [releaseIds.userATask, ids.userA, releaseIds.userBTask, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.resource_grants (
          resource_type,
          resource_id,
          grantee_user_id,
          grant_level,
          granted_by_user_id
        )
        VALUES ('task', $1, $2, 'view', $3)
      `,
      [releaseIds.userBTask, ids.userA, ids.userB]
    );
    await client.query(
      `
        INSERT INTO app.connector_accounts (
          id,
          provider_id,
          owner_user_id,
          scopes,
          encrypted_secret
        )
        VALUES ($1, 'google-calendar', $2, ARRAY['calendar.readonly'], $3::jsonb)
      `,
      [
        releaseIds.connectorAccount,
        ids.userA,
        JSON.stringify({
          ciphertext: "connector-ciphertext-sentinel",
          iv: "iv",
          tag: "tag",
          version: 1
        })
      ]
    );
    await client.query(
      `
        INSERT INTO app.calendar_events (
          id,
          connector_account_id,
          owner_user_id,
          title,
          starts_at,
          ends_at,
          external_id
        )
        VALUES ($1, $2, $3, 'Calendar item', now(), now() + interval '1 hour', 'event-a')
      `,
      [releaseIds.calendarEvent, releaseIds.connectorAccount, ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.email_messages (
          id,
          connector_account_id,
          owner_user_id,
          sender,
          subject,
          received_at,
          external_id
        )
        VALUES ($1, $2, $3, 'sender@example.test', 'Email item', now(), 'message-a')
      `,
      [releaseIds.emailMessage, releaseIds.connectorAccount, ids.userA]
    );
    await client.query(
      `
        INSERT INTO app.ai_provider_configs (
          id,
          owner_user_id,
          provider_kind,
          display_name,
          encrypted_credential
        )
        VALUES ($1, $2, 'custom', 'Test AI', $3::jsonb)
      `,
      [
        releaseIds.aiProvider,
        ids.userA,
        JSON.stringify({
          ciphertext: "ai-ciphertext-sentinel",
          iv: "iv",
          tag: "tag",
          version: 1
        })
      ]
    );
    await client.query(
      `
        INSERT INTO app.ai_configured_models (
          id,
          provider_config_id,
          owner_user_id,
          provider_model_id,
          display_name,
          capabilities
        )
        VALUES ($1, $2, $3, 'test-model', 'Test Model', ARRAY['chat'])
      `,
      [releaseIds.aiModel, releaseIds.aiProvider, ids.userA]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function readLifecycleRows(): Promise<{
  readonly auditAction: string | null;
  readonly auditMetadata: Record<string, unknown>;
  readonly auditTargetId: string | null;
  readonly userAAiProviderRows: number;
  readonly userAConnectorRows: number;
  readonly userAExists: boolean;
  readonly userBExists: boolean;
  readonly userBTaskExists: boolean;
}> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    const result = await client.query<{
      audit_action: string | null;
      audit_metadata: Record<string, unknown> | null;
      audit_target_id: string | null;
      user_a_ai_provider_rows: string;
      user_a_connector_rows: string;
      user_a_exists: boolean;
      user_b_exists: boolean;
      user_b_task_exists: boolean;
    }>(
      `
        SELECT
          EXISTS (SELECT 1 FROM app.users WHERE id = $1) AS user_a_exists,
          EXISTS (SELECT 1 FROM app.users WHERE id = $2) AS user_b_exists,
          EXISTS (SELECT 1 FROM app.tasks WHERE id = $3) AS user_b_task_exists,
          (SELECT count(*) FROM app.connector_accounts WHERE owner_user_id = $1) AS user_a_connector_rows,
          (SELECT count(*) FROM app.ai_provider_configs WHERE owner_user_id = $1) AS user_a_ai_provider_rows,
          (
            SELECT action
            FROM app.admin_audit_events
            WHERE action = 'user.delete'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS audit_action,
          (
            SELECT target_id
            FROM app.admin_audit_events
            WHERE action = 'user.delete'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS audit_target_id,
          (
            SELECT metadata
            FROM app.admin_audit_events
            WHERE action = 'user.delete'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS audit_metadata
      `,
      [ids.userA, ids.userB, releaseIds.userBTask]
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Lifecycle row read returned no result");
    }

    return {
      auditAction: row.audit_action,
      auditMetadata: row.audit_metadata ?? {},
      auditTargetId: row.audit_target_id,
      userAAiProviderRows: Number(row.user_a_ai_provider_rows),
      userAConnectorRows: Number(row.user_a_connector_rows),
      userAExists: row.user_a_exists,
      userBExists: row.user_b_exists,
      userBTaskExists: row.user_b_task_exists
    };
  } finally {
    await client.end();
  }
}
