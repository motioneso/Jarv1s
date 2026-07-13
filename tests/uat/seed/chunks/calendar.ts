import { randomUUID } from "node:crypto";
import type { DataContextRunner } from "@jarv1s/db";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { CalendarRepository } from "@jarv1s/calendar";
import { UAT_SEED_BASE_TIMESTAMP, daysAfter, daysBefore } from "../timestamps.js";

/**
 * #1025: calendar_events are connector-synced cached rows (packages/calendar/src/
 * repository.ts's upsertCachedEvent), not directly user-authored — a real
 * calendar UI has no events without a connector_account. `'google'` is a
 * pre-seeded connector_provider_type enum value (migration 0043) so this needs no new
 * definition, only a fake account under it.
 */
export async function seedCalendarChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const connectors = new ConnectorsRepository();
  const calendar = new CalendarRepository();
  const cipher = createConnectorSecretCipher();

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const account = await connectors.createAccount(scopedDb, {
      providerId: "google",
      // #1025: calendar_events_insert RLS (packages/calendar/sql/0066) requires this
      // exact scope string for provider_type='google' accounts — 'calendar.read' fails
      // the WITH CHECK's scope EXISTS clause.
      scopes: ["https://www.googleapis.com/auth/calendar"],
      encryptedSecret: cipher.encryptJson({ cli: true }) // #1025: fake, never a real OAuth token
    });

    const events: ReadonlyArray<{ title: string; startsAt: Date; endsAt: Date }> = [
      {
        title: "Team standup",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1)
      },
      {
        title: "Dentist appointment",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 5),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 5)
      },
      {
        title: "Quarterly review",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 12),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 12)
      },
      {
        title: "Past: Project kickoff",
        startsAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 20),
        endsAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 20)
      }
    ];
    for (const [index, event] of events.entries()) {
      await calendar.upsertCachedEvent(scopedDb, {
        id: randomUUID(), // acceptable: not asserted-against content, only a DB PK
        connectorAccountId: account.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        externalId: `uat-seed-event-${index}` // #1025: stable external id keeps upsertCachedEvent's onConflict idempotent across re-seeds
      });
    }
  });
}
