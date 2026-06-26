import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type CalendarEvent, type DataContextDb } from "@jarv1s/db";

export interface CreateCachedCalendarEventInput {
  readonly id?: string;
  readonly connectorAccountId: string;
  readonly title: string;
  readonly startsAt: Date | string;
  readonly endsAt: Date | string;
  readonly location?: string | null;
  readonly summary?: string | null;
  readonly bodyExcerpt?: string | null;
  readonly externalId: string;
  readonly externalMetadata?: Record<string, unknown>;
}

export class CalendarRepository {
  async listVisible(scopedDb: DataContextDb): Promise<CalendarEvent[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.calendar_events")
      .selectAll()
      .orderBy("starts_at", "asc")
      .orderBy("id")
      .execute();
  }

  async getById(scopedDb: DataContextDb, eventId: string): Promise<CalendarEvent | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.calendar_events")
      .selectAll()
      .where("id", "=", eventId)
      .executeTakeFirst();
  }

  async upsertCachedEvent(
    scopedDb: DataContextDb,
    input: CreateCachedCalendarEventInput
  ): Promise<CalendarEvent> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.calendar_events")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        location: input.location ?? null,
        summary: input.summary ?? null,
        body_excerpt: input.bodyExcerpt ?? null,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["connector_account_id", "external_id"]).doUpdateSet({
          title: input.title,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          location: input.location ?? null,
          summary: input.summary ?? null,
          body_excerpt: input.bodyExcerpt ?? null,
          external_metadata: input.externalMetadata ?? {},
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteStaleCachedEvents(
    scopedDb: DataContextDb,
    input: { readonly connectorAccountId: string; readonly keepExternalIds: readonly string[] }
  ): Promise<number> {
    assertDataContextDb(scopedDb);

    const query = scopedDb.db
      .deleteFrom("app.calendar_events")
      .where("connector_account_id", "=", input.connectorAccountId)
      .$if(input.keepExternalIds.length > 0, (qb) =>
        qb.where("external_id", "not in", input.keepExternalIds)
      );

    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
