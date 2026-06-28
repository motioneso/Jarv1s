import { sql } from "kysely";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type { ProactiveMonitorStateRow } from "./types.js";

export class MonitorStateRepository {
  async get(
    scopedDb: DataContextDb,
    ownerUserId: string,
    source: string
  ): Promise<ProactiveMonitorStateRow | undefined> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.proactive_monitor_state")
      .selectAll()
      .where("owner_user_id", "=", ownerUserId)
      .where("source", "=", source)
      .executeTakeFirst() as Promise<ProactiveMonitorStateRow | undefined>;
  }

  async advanceCursor(
    scopedDb: DataContextDb,
    ownerUserId: string,
    source: string,
    nextCursor: Record<string, unknown>
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
      INSERT INTO app.proactive_monitor_state (owner_user_id, source, cursor_json, last_checked_at, failure_count, updated_at)
      VALUES (${ownerUserId}::uuid, ${source}, ${JSON.stringify(nextCursor)}::jsonb, now(), 0, now())
      ON CONFLICT (owner_user_id, source) DO UPDATE
      SET cursor_json = EXCLUDED.cursor_json,
          last_checked_at = now(),
          failure_count = 0,
          last_error_class = NULL,
          updated_at = now()
    `.execute(scopedDb.db);
  }

  async recordFailure(
    scopedDb: DataContextDb,
    ownerUserId: string,
    source: string,
    errorClass: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
      INSERT INTO app.proactive_monitor_state (owner_user_id, source, last_checked_at, failure_count, last_error_class, updated_at)
      VALUES (${ownerUserId}::uuid, ${source}, now(), 1, ${errorClass}, now())
      ON CONFLICT (owner_user_id, source) DO UPDATE
      SET last_checked_at = now(),
          failure_count = app.proactive_monitor_state.failure_count + 1,
          last_error_class = ${errorClass},
          updated_at = now()
    `.execute(scopedDb.db);
  }
}
