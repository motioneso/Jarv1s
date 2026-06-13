import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";

/**
 * Bootstrap helper — uses the raw root Kysely handle intentionally.
 *
 * `GET /api/bootstrap/status` is called before any user session exists, so
 * `withDataContext` cannot be used here (it requires an actorUserId). The
 * function `app.count_all_users()` is a SECURITY DEFINER function with no
 * private data — raw access is safe and intentional.
 *
 * This is the SOLE documented exemption for `Kysely<` in packages/settings/src/. (The
 * broader bounded "pre-auth non-secret instance-config reads" exemption — registration
 * gate + `chat.multiplexer` boot resolution — lives outside this package and is recorded
 * in DEVELOPMENT_STANDARDS.md.)
 */
export class BootstrapHelper {
  constructor(private readonly rootDb: Kysely<JarvisDatabase>) {}

  async countUsers(): Promise<number> {
    const result = await sql<{ count: string }>`SELECT app.count_all_users() AS count`.execute(
      this.rootDb
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
