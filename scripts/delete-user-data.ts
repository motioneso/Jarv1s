import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { getJarvisDatabaseUrls } from "@jarv1s/db";
import { deleteUserVaultDir, getVaultBaseDir } from "@jarv1s/vault";

const { Client } = pg;

export interface DeleteUserDataOptions {
  readonly actorUserId?: string | null;
  readonly bootstrapConnectionString?: string;
  readonly confirmUserId?: string;
  readonly dryRun?: boolean;
  readonly requestId?: string;
  readonly userId: string;
}

export interface DeleteUserDataResult {
  readonly auditEventId: string | null;
  readonly countsBeforeDelete: Readonly<Record<string, number>>;
  readonly deleted: boolean;
  readonly dryRun: boolean;
  readonly userId: string;
}

const userScopedCountQueries: ReadonlyArray<readonly [table: string, predicate: string]> = [
  ["app.users", "id = $1::uuid"],
  ["app.auth_sessions", "user_id = $1::uuid"],
  ["app.auth_accounts", "user_id = $1::uuid"],
  ["app.better_auth_sessions", "user_id = $1::uuid"],
  ["app.workspace_memberships", "user_id = $1::uuid"],
  ["app.resource_grants", "grantee_user_id = $1::uuid OR granted_by_user_id = $1::uuid"],
  ["app.tasks", "owner_user_id = $1::uuid"],
  ["app.task_activity", "actor_user_id = $1::uuid"],
  ["app.notifications", "recipient_user_id = $1::uuid OR actor_user_id = $1::uuid"],
  ["app.notification_reads", "user_id = $1::uuid"],
  ["app.connector_accounts", "owner_user_id = $1::uuid"],
  ["app.calendar_events", "owner_user_id = $1::uuid"],
  ["app.email_messages", "owner_user_id = $1::uuid"],
  ["app.ai_provider_configs", "owner_user_id = $1::uuid"],
  ["app.ai_configured_models", "owner_user_id = $1::uuid"],
  ["app.ai_assistant_action_requests", "owner_user_id = $1::uuid"],
  ["app.chat_threads", "owner_user_id = $1::uuid"],
  ["app.chat_messages", "owner_user_id = $1::uuid"],
  ["app.briefing_definitions", "owner_user_id = $1::uuid"],
  ["app.briefing_runs", "owner_user_id = $1::uuid"]
];

export async function deleteUserData(
  options: DeleteUserDataOptions
): Promise<DeleteUserDataResult> {
  const dryRun = options.dryRun ?? true;

  if (!dryRun && options.confirmUserId !== options.userId) {
    throw new Error("Confirmation user id must match the target user id");
  }

  const client = new Client({
    connectionString: options.bootstrapConnectionString ?? getJarvisDatabaseUrls().bootstrap
  });

  await client.connect();
  try {
    await client.query("BEGIN");

    const counts = await readCounts(client, options.userId);

    if (dryRun) {
      await client.query("ROLLBACK");
      return {
        auditEventId: null,
        countsBeforeDelete: counts,
        deleted: false,
        dryRun,
        userId: options.userId
      };
    }

    const auditEventId = randomUUID();
    await client.query(
      `
        INSERT INTO app.admin_audit_events (
          id,
          actor_user_id,
          action,
          target_type,
          target_id,
          metadata,
          request_id
        )
        VALUES (
          $1,
          $2,
          'user.delete',
          'user',
          $3,
          $4::jsonb,
          $5
        )
      `,
      [
        auditEventId,
        options.actorUserId ?? null,
        options.userId,
        JSON.stringify({
          countsBeforeDelete: counts,
          script: "scripts/delete-user-data.ts"
        }),
        options.requestId ?? `maintenance:user-delete:${auditEventId}`
      ]
    );

    const deleted = await client.query("DELETE FROM app.users WHERE id = $1::uuid", [
      options.userId
    ]);

    await client.query("COMMIT");

    // Delete the user's vault filesystem directory AFTER the DB commit.
    // Ordering rationale: if the DB delete fails the vault is untouched; if
    // the vault rm fails the user rows are already gone (effectively deleted)
    // and the orphan can be retried manually without risk of data inconsistency.
    // The operation is idempotent — no error if the directory does not exist.
    await deleteUserVaultDir(getVaultBaseDir(), options.userId);

    return {
      auditEventId,
      countsBeforeDelete: counts,
      deleted: (deleted.rowCount ?? 0) > 0,
      dryRun,
      userId: options.userId
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.userId) {
    throw new Error(
      "Usage: pnpm delete:user -- --user-id <uuid> [--actor-user-id <uuid>] [--execute --confirm-user-id <uuid>]"
    );
  }

  const result = await deleteUserData({
    actorUserId: args.actorUserId,
    confirmUserId: args.confirmUserId,
    dryRun: !args.execute,
    userId: args.userId
  });

  console.log(JSON.stringify(result, null, 2));
}

async function readCounts(
  client: pg.Client,
  userId: string
): Promise<Readonly<Record<string, number>>> {
  const entries: Array<readonly [string, number]> = [];

  for (const [table, predicate] of userScopedCountQueries) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM ${table} WHERE ${predicate}`,
      [userId]
    );
    entries.push([table, Number(result.rows[0]?.count ?? 0)]);
  }

  return Object.fromEntries(entries);
}

function parseArgs(args: readonly string[]): {
  readonly actorUserId?: string;
  readonly confirmUserId?: string;
  readonly execute: boolean;
  readonly userId?: string;
} {
  return {
    actorUserId: readFlag(args, "--actor-user-id"),
    confirmUserId: readFlag(args, "--confirm-user-id"),
    execute: args.includes("--execute"),
    userId: readFlag(args, "--user-id")
  };
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
