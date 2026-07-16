import type { Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import {
  UAT_ADMIN_EMAIL,
  UAT_ADMIN_ID,
  UAT_SECOND_OWNER_EMAIL,
  UAT_SECOND_OWNER_ID
} from "./admin.js";

const UAT_SEED_IDS = [UAT_ADMIN_ID, UAT_SECOND_OWNER_ID] as const;
const UAT_SEED_EMAILS = [UAT_ADMIN_EMAIL, UAT_SECOND_OWNER_EMAIL] as const;

/**
 * #1082 SECURITY HARD FENCE: the caller's env token proves only intent, not that
 * the connected database is ephemeral. Refuse every user identity except the
 * fixed UAT fixtures so a copied token cannot seed a loginable bootstrap owner
 * into a real instance. The known UAT owner remains allowed for safe re-seeding.
 */
export async function assertTargetIsEphemeral(db: Kysely<JarvisDatabase>): Promise<void> {
  const realOrBootstrapUser = await db
    .selectFrom("app.users")
    .select("id")
    .where((eb) =>
      eb.or([eb("id", "not in", UAT_SEED_IDS), eb("email", "not in", UAT_SEED_EMAILS)])
    )
    .executeTakeFirst();

  if (realOrBootstrapUser) {
    throw new Error("[uat-seed] refusing: target DB already has real/bootstrap users");
  }
}
