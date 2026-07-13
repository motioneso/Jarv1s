import { randomUUID } from "node:crypto";
import { hashPassword } from "@jarv1s/auth";
import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";

const UAT_ADMIN_EMAIL = "uat-admin@jarv1s.local";
const UAT_ADMIN_PASSWORD = "uat-admin-password-1025";

/**
 * #1025 spec §4.2: a genuinely loginable admin — real scrypt hash via
 * better-auth/crypto's hashPassword, real app.users + app.auth_accounts row
 * shapes, so Playwright (#1026) exercises the actual /login path rather than
 * a faked session. app.better_auth_sessions is deliberately NOT seeded here:
 * seeding a session would bypass the auth surface the epic exists to exercise.
 */
export async function seedSoloAdmin(
  migrationDb: Kysely<JarvisDatabase>
): Promise<{ userId: string; email: string; password: string }> {
  const userId = "00000000-0000-4000-8000-000000000001"; // #1025: fixed, not randomUUID() — deterministic across runs
  const passwordHash = await hashPassword(UAT_ADMIN_PASSWORD);

  await migrationDb
    .insertInto("app.users")
    .values({
      id: userId,
      email: UAT_ADMIN_EMAIL,
      name: "UAT Admin",
      email_verified: true,
      image: null,
      is_instance_admin: true,
      is_bootstrap_owner: true,
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
        account_id: userId, // better-auth convention: the user's own id, NOT the email
        provider_id: "credential",
        user_id: userId,
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

  return { userId, email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD };
}
