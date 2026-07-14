// Requires a live dev Postgres (JARVIS_MIGRATION_DATABASE_URL) — run against the
// standard dev compose stack, not the ephemeral UAT one, for fast local iteration.
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { createMigrationOwnerDb } from "./connections.js";
import { seedSoloAdmin } from "./admin.js";

describe("seedSoloAdmin", () => {
  it("creates a loginable admin via the real credential-account shape", async () => {
    const db = createMigrationOwnerDb();
    try {
      const { userId, email, password } = await seedSoloAdmin(db);
      expect(email).toBe("uat-admin@jarv1s.local");
      expect(password).toBe("uat-admin-password-1025");

      const user = await db
        .selectFrom("app.users")
        .select(["id", "email", "is_instance_admin", "is_bootstrap_owner", "status"])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow();
      expect(user.is_instance_admin).toBe(true);
      expect(user.status).toBe("active");

      // app.auth_accounts is FORCE-RLS'd TO jarvis_auth_runtime only (migration 0045);
      // jarvis_migration_owner is NOINHERIT/NOBYPASSRLS, so reading it back — like
      // writing it in seedSoloAdmin — needs the same in-transaction role switch.
      const account = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE jarvis_auth_runtime`.execute(trx);
        return trx
          .selectFrom("app.auth_accounts")
          .select(["account_id", "provider_id", "user_id"])
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();
      });
      expect(account.account_id).toBe(userId); // real better-auth convention, not email
      expect(account.provider_id).toBe("credential");
    } finally {
      await db.destroy();
    }
  });
});
