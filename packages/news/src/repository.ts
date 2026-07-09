import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { CreateNewsPrefRequest, NewsPrefDto } from "@jarv1s/shared";

interface NewsPrefRow {
  id: string;
  kind: "source" | "source_exclude" | "topic";
  key: string;
  created_at: Date;
}

/** Map a persisted row to the public DTO (snake_case → camelCase, Date → ISO string). */
export function toDto(row: NewsPrefRow): NewsPrefDto {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    createdAt: row.created_at.toISOString()
  };
}

export class NewsPrefsRepository {
  async list(scopedDb: DataContextDb): Promise<NewsPrefDto[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.news_prefs")
      .select(["id", "kind", "key", "created_at"])
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(toDto);
  }

  async create(scopedDb: DataContextDb, input: CreateNewsPrefRequest): Promise<NewsPrefDto> {
    assertDataContextDb(scopedDb);
    // Idempotent create (same posture as sports follows): re-adding an existing pref returns the
    // existing row instead of surfacing the UNIQUE violation. No NULL column in the key here, so
    // the UNIQUE constraint alone would dedupe — the pre-check just keeps the API idempotent.
    const existing = await scopedDb.db
      .selectFrom("app.news_prefs")
      .select(["id", "kind", "key", "created_at"])
      .where("kind", "=", input.kind)
      .where("key", "=", input.key)
      .executeTakeFirst();
    if (existing) return toDto(existing);

    const row = await scopedDb.db
      .insertInto("app.news_prefs")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        kind: input.kind,
        key: input.key
      })
      .returning(["id", "kind", "key", "created_at"])
      .executeTakeFirstOrThrow();
    return toDto(row);
  }

  async remove(scopedDb: DataContextDb, id: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .deleteFrom("app.news_prefs")
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }
}
