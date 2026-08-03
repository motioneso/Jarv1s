import { describe, expect, it } from "vitest";
import {
  handles,
  ids,
  runGoogleSync,
  seedGoogleAccount
} from "./helpers/google-sync-orchestration.js";

describe("runGoogleSync persistence orchestration", () => {
  it("a single DB-level upsert failure does NOT roll back OTHER upserts or fabricate counts", async () => {
    // HIGH: the whole sync runs in ONE outer transaction. Without per-item SAVEPOINTs, a single
    // DB-level error (here a CHECK violation: a calendar event whose start is AFTER its end) would
    // abort the transaction; the email upsert would then fail 25P02 (swallowed), yet the handler
    // returned non-zero counts and the outer COMMIT became a silent ROLLBACK — total data loss with
    // fabricated success. With SAVEPOINTs the bad event is confined: it's counted as an error, the
    // email upsert COMMITS, and the reported counts MATCH what is actually persisted.
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const result = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar", "gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [
            {
              id: "bad-evt",
              summary: "Inverted times (CHECK violation)",
              // start AFTER end → ends_at >= starts_at CHECK fails on upsert.
              start: { dateTime: "2026-06-13T10:00:00Z" },
              end: { dateTime: "2026-06-13T09:00:00Z" }
            },
            {
              id: "good-evt",
              summary: "Valid event",
              start: { dateTime: "2026-06-13T11:00:00Z" },
              end: { dateTime: "2026-06-13T11:30:00Z" }
            }
          ],
          listMessageIds: async ({ query }) =>
            query?.includes("older_than:1d") ? [] : [{ id: "txn-msg-1" }],
          getMessage: async () => ({
            id: "txn-msg-1",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "Survives the bad calendar event" },
                { name: "From", value: "a@b.com" }
              ],
              body: { data: Buffer.from("hi").toString("base64") }
            }
          })
        },
        emailExtractDeps: {
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );

    // The bad event is recorded as an error, not silently dropped; the good event + the email are
    // upserted. Crucially the handler did NOT throw and did NOT fabricate counts.
    expect(result.errors).toContain("calendar-item-error");
    expect(result.calendarUpserted).toBe(1);
    expect(result.emailUpserted).toBe(1);

    // The reported counts MATCH the rows that actually committed (no silent rollback). Query the
    // specific external_ids this test created — the connector account is a singleton per user, so
    // events from sibling tests share the same account id.
    const persisted = await handles.dataContext.withDataContext(ctx, (db) =>
      Promise.all([
        db.db
          .selectFrom("app.calendar_events")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "good-evt")
          .executeTakeFirstOrThrow(),
        db.db
          .selectFrom("app.calendar_events")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "bad-evt")
          .executeTakeFirstOrThrow(),
        db.db
          .selectFrom("app.email_messages")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "txn-msg-1")
          .executeTakeFirstOrThrow()
      ])
    );
    expect(Number(persisted[0].n)).toBe(1); // the good event committed
    expect(Number(persisted[1].n)).toBe(0); // the bad event's savepoint rolled back — not persisted
    expect(Number(persisted[2].n)).toBe(1); // the email survived the bad calendar upsert
  });
});
