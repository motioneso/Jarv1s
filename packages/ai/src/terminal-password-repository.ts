import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import { hashPassword, verifyPassword } from "better-auth/crypto";

// #1059 — persists only the better-auth scrypt HASH of the owner's terminal step-up password
// (never the plaintext — Hard Invariant: secrets never escape). Singleton row in
// app.ai_terminal_password (migration 0165), admin-only via FORCE RLS on every verb.
//
// The `app.ai_terminal_password` table is intentionally NOT registered in the shared
// @jarv1s/db Kysely `Database` interface (packages/db/src/types.ts) — adding it there would
// widen the blast radius of this task to a shared type map every other package typechecks
// against. Instead we mirror the raw `sql`-tagged idiom already used elsewhere in this
// package (see `AiRepository.getUserById` in ./repository.ts) rather than Kysely's typed
// `.insertInto`/`.selectFrom` builders, which require the table to appear in that map.

interface TerminalPasswordRow {
  readonly password_hash: string;
}

/**
 * Upsert the singleton terminal-password row with a freshly scrypt-hashed value. Runs under
 * the caller's admin DataContextDb — the admin-only RLS policy (0165) denies this for any
 * non-admin actor, so no additional authorization check is needed here.
 */
export async function setTerminalPassword(db: DataContextDb, plaintext: string): Promise<void> {
  assertDataContextDb(db);
  const passwordHash = await hashPassword(plaintext);

  await sql`
    INSERT INTO app.ai_terminal_password (singleton, password_hash, updated_at)
    VALUES (true, ${passwordHash}, now())
    ON CONFLICT (singleton) DO UPDATE SET
      password_hash = excluded.password_hash,
      updated_at = now()
  `.execute(db.db);
}

/** Existence-only probe — never returns the hash itself, only whether one has been set. */
export async function hasTerminalPassword(db: DataContextDb): Promise<boolean> {
  assertDataContextDb(db);

  const result = await sql<{ singleton: boolean }>`
    SELECT singleton FROM app.ai_terminal_password LIMIT 1
  `.execute(db.db);

  return result.rows.length > 0;
}

/**
 * Constant-time verify of a plaintext attempt against the stored hash via better-auth's
 * scrypt compare. No row set yet ⇒ always false (there is nothing to step up against).
 */
export async function verifyTerminalPassword(
  db: DataContextDb,
  plaintext: string
): Promise<boolean> {
  assertDataContextDb(db);

  const result = await sql<TerminalPasswordRow>`
    SELECT password_hash FROM app.ai_terminal_password LIMIT 1
  `.execute(db.db);

  const row = result.rows[0];
  if (!row) return false;

  return verifyPassword({ hash: row.password_hash, password: plaintext });
}
