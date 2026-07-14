import { randomUUID } from "node:crypto";
import { hashPassword } from "@jarv1s/auth";
import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";

export const UAT_ADMIN_EMAIL = "uat-admin@jarv1s.local";
export const UAT_ADMIN_PASSWORD = "uat-admin-password-1025";
export const UAT_SECOND_OWNER_EMAIL = "uat-owner2@jarv1s.local";
export const UAT_SECOND_OWNER_PASSWORD = "uat-owner2-password-1030";

const UAT_ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const UAT_SECOND_OWNER_ID = "00000000-0000-4000-8000-000000000002";

interface SeedLoginableUserInput {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly isInstanceAdmin: boolean;
  readonly isBootstrapOwner: boolean;
}

export function logUatAdminCredentials(
  credentials: { readonly email: string; readonly password: string },
  writeStdout: (text: string) => void = (text) => {
    process.stdout.write(text);
  }
): void {
  // #1040 SECURITY HARD FENCE: the UAT stack is prod-shaped and intentionally runs with
  // NODE_ENV=production, so environment mode cannot distinguish it. Reuse the exact seed-only
  // confirmation token that composeSeedHook sets and cli.ts already requires; real production
  // bootstrap never sets this token or calls this fixture-only module.
  if (process.env.JARVIS_UAT_SEED_CONFIRM !== "1") return;

  writeStdout(
    `[uat-seed] owner/admin login: email=${credentials.email} password=${credentials.password}\n`
  );
}

/**
 * #1025/#1030: genuinely loginable seed users — real scrypt hashes via
 * better-auth/crypto's hashPassword, real app.users + app.auth_accounts row
 * shapes, so UAT exercises the actual /login path rather than
 * a faked session. app.better_auth_sessions is deliberately NOT seeded here:
 * seeding a session would bypass the auth surface the epic exists to exercise.
 */
async function seedLoginableUser(
  migrationDb: Kysely<JarvisDatabase>,
  input: SeedLoginableUserInput
): Promise<{ userId: string; email: string; password: string }> {
  const passwordHash = await hashPassword(input.password);

  await migrationDb
    .insertInto("app.users")
    .values({
      id: input.userId,
      email: input.email,
      name: input.name,
      email_verified: true,
      image: null,
      is_instance_admin: input.isInstanceAdmin,
      is_bootstrap_owner: input.isBootstrapOwner,
      status: "active",
      created_at: UAT_SEED_BASE_TIMESTAMP,
      updated_at: UAT_SEED_BASE_TIMESTAMP
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  // #1025 hard invariant: app.auth_accounts is FORCE-RLS'd TO jarvis_auth_runtime
  // (spec §4.1). jarvis_migration_owner can satisfy that policy because it is a
  // member of jarvis_auth_runtime (infra/postgres/bootstrap/0000_roles.sql, added
  // for migration 0045's SECURITY DEFINER ownership) — SET LOCAL ROLE, not BYPASSRLS.
  // SET LOCAL only holds for the lifetime of an explicit transaction (Postgres
  // discards it at the end of a statement's implicit transaction, and a
  // pool-backed connection can't be relied on to stay pinned across separate
  // .execute() calls otherwise) — the role switch and the insert must share one
  // transaction/connection.
  await migrationDb.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE jarvis_auth_runtime`.execute(trx);
    await trx
      .insertInto("app.auth_accounts")
      .values({
        id: randomUUID(),
        account_id: input.userId, // better-auth convention: the user's own id, NOT the email
        provider_id: "credential",
        user_id: input.userId,
        access_token: null,
        refresh_token: null,
        id_token: null,
        access_token_expires_at: null,
        refresh_token_expires_at: null,
        scope: null,
        password: passwordHash,
        created_at: UAT_SEED_BASE_TIMESTAMP,
        updated_at: UAT_SEED_BASE_TIMESTAMP
      })
      // Conflict target must be the real unique constraint
      // (provider_id, account_id) — id is a fresh randomUUID() every call, so an
      // id-keyed target would never actually catch a rerun against the fixed
      // (credential, userId) pair and would violate the unique constraint instead.
      .onConflict((oc) => oc.columns(["provider_id", "account_id"]).doNothing())
      .execute();
  });

  return { userId: input.userId, email: input.email, password: input.password };
}

export async function seedSoloAdmin(
  migrationDb: Kysely<JarvisDatabase>
): Promise<{ userId: string; email: string; password: string }> {
  const credentials = await seedLoginableUser(migrationDb, {
    userId: UAT_ADMIN_ID,
    email: UAT_ADMIN_EMAIL,
    password: UAT_ADMIN_PASSWORD,
    name: "UAT Admin",
    isInstanceAdmin: true,
    isBootstrapOwner: true
  });
  logUatAdminCredentials(credentials);
  return credentials;
}

export function seedSecondOwner(
  migrationDb: Kysely<JarvisDatabase>
): Promise<{ userId: string; email: string; password: string }> {
  return seedLoginableUser(migrationDb, {
    userId: UAT_SECOND_OWNER_ID,
    email: UAT_SECOND_OWNER_EMAIL,
    password: UAT_SECOND_OWNER_PASSWORD,
    name: "UAT Owner Two",
    isInstanceAdmin: false,
    isBootstrapOwner: false
  });
}
