import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";

/**
 * Bootstrap helper — uses the raw root Kysely handle intentionally.
 *
 * `GET /api/bootstrap/status` is called before any user session exists, so
 * `withDataContext` cannot be used here (it requires an actorUserId). The function
 * `app.list_all_users()` is a SECURITY DEFINER function exposed to app runtime for
 * admin/user listing, and this helper reads only whether a bootstrap owner exists —
 * raw access is safe and intentional.
 *
 * This is the SOLE documented exemption for `Kysely<` in packages/settings/src/. (The
 * broader bounded "pre-auth non-secret instance-config reads" exemption — registration
 * gate + `chat.multiplexer` boot resolution — lives outside this package and is recorded
 * in DEVELOPMENT_STANDARDS.md.)
 */
export class BootstrapHelper {
  constructor(private readonly rootDb: Kysely<JarvisDatabase>) {}

  async bootstrapOwnerExists(): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM app.list_all_users()
        WHERE is_bootstrap_owner = true
      ) AS "exists"
    `.execute(this.rootDb);

    return result.rows[0]?.exists ?? false;
  }
}
