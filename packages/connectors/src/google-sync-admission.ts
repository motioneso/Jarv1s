import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";

export async function hasInFlightGoogleSyncLineage(
  rootDb: Kysely<JarvisDatabase>,
  actorUserId: string
): Promise<boolean> {
  const result = await sql<{ in_flight: boolean }>`
    select exists (
      select 1
      from pgboss.job
      where name = 'connectors.google-sync-continuation'
        and state in ('created', 'retry', 'active')
        and data->>'actorUserId' = ${actorUserId}
    ) as in_flight
  `.execute(rootDb);
  return result.rows[0]?.in_flight ?? false;
}
