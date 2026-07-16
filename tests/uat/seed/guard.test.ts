// Requires a live dev Postgres (JARVIS_MIGRATION_DATABASE_URL) — run against the
// per-agent database used by the foundation gate.
import { afterEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import {
  UAT_ADMIN_EMAIL,
  UAT_ADMIN_ID,
  UAT_SECOND_OWNER_EMAIL,
  UAT_SECOND_OWNER_ID
} from "./admin.js";
import { createMigrationOwnerDb } from "./connections.js";
import { assertTargetIsEphemeral } from "./guard.js";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";

const REAL_BOOTSTRAP_ID = "00000000-0000-4000-8000-000000001082";
const REAL_USER_ID = "00000000-0000-4000-8000-000000001083";
const TEST_USER_IDS = [UAT_ADMIN_ID, UAT_SECOND_OWNER_ID, REAL_BOOTSTRAP_ID, REAL_USER_ID] as const;

async function insertUser(
  db: Kysely<JarvisDatabase>,
  input: { readonly id: string; readonly email: string; readonly bootstrapOwner?: boolean }
): Promise<void> {
  await db
    .insertInto("app.users")
    .values({
      id: input.id,
      email: input.email,
      name: "UAT guard test user",
      email_verified: true,
      image: null,
      is_instance_admin: input.bootstrapOwner ?? false,
      is_bootstrap_owner: input.bootstrapOwner ?? false,
      status: "active",
      created_at: UAT_SEED_BASE_TIMESTAMP,
      updated_at: UAT_SEED_BASE_TIMESTAMP
    })
    .execute();
}

async function deleteTestUsers(): Promise<void> {
  const db = createMigrationOwnerDb();
  try {
    await db.deleteFrom("app.users").where("id", "in", TEST_USER_IDS).execute();
  } finally {
    await db.destroy();
  }
}

afterEach(deleteTestUsers);

describe("assertTargetIsEphemeral", () => {
  it("allows an empty database", async () => {
    const db = createMigrationOwnerDb();
    try {
      await expect(assertTargetIsEphemeral(db)).resolves.toBeUndefined();
    } finally {
      await db.destroy();
    }
  });

  it("refuses a database with a real bootstrap owner", async () => {
    const db = createMigrationOwnerDb();
    try {
      await insertUser(db, {
        id: REAL_BOOTSTRAP_ID,
        email: "owner@example.com",
        bootstrapOwner: true
      });
      await expect(assertTargetIsEphemeral(db)).rejects.toThrow(
        "[uat-seed] refusing: target DB already has real/bootstrap users"
      );
    } finally {
      await db.destroy();
    }
  });

  it("refuses a database with a non-seed real user", async () => {
    const db = createMigrationOwnerDb();
    try {
      await insertUser(db, { id: REAL_USER_ID, email: "user@example.com" });
      await expect(assertTargetIsEphemeral(db)).rejects.toThrow(
        "[uat-seed] refusing: target DB already has real/bootstrap users"
      );
    } finally {
      await db.destroy();
    }
  });

  it("allows only the known UAT seed rows for re-seeding", async () => {
    const db = createMigrationOwnerDb();
    try {
      await insertUser(db, {
        id: UAT_ADMIN_ID,
        email: UAT_ADMIN_EMAIL,
        bootstrapOwner: true
      });
      await insertUser(db, { id: UAT_SECOND_OWNER_ID, email: UAT_SECOND_OWNER_EMAIL });
      await expect(assertTargetIsEphemeral(db)).resolves.toBeUndefined();
    } finally {
      await db.destroy();
    }
  });
});
