import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// I1.E self-review gap-fill (split out of google-sync.test.ts to stay under the 1000-line file
// limit). The A2/A3 deviation notes in google-sync.test.ts promise the "end-to-end worker INSERT
// (success + scope-guard rejection)" is exercised once the 0069 connector grants exist, but no
// test actually drove a real INSERT through the WORKER role (jarvis_worker_runtime — the production
// sync principal) and proved the relaxed `provider_type='google'` INSERT policy FAILS CLOSED on a
// missing scope; the catalog tests only regex-match the policy text. The spec testing strategy and
// the I1.E checklist both require: "without the relevant scope, INSERT is rejected". These tests
// close that gap with real worker-role inserts (positive + negative, calendar + email).

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

let appDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let workerDb: Kysely<JarvisDatabase>;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  appDataContext = new DataContextRunner(appDb);
  workerDb = createDatabase({ connectionString: connectionStrings.worker });
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb.destroy();
  await workerDb.destroy();
});

// `upsertGoogleAccount` is a SINGLETON per user (keyed on provider_id = GOOGLE_PROVIDER_ID): every
// call for the same actor OVERWRITES that user's one google account. Seeded via the APP DataContext
// (the worker has no INSERT grant on connector_accounts — see migration 0069). The precondition is
// re-read and asserted so a later negative assertion cannot pass on a stale broad scope.
async function seedGoogleAccount(scopes: string[], actorUserId: string): Promise<string> {
  const cipher = createConnectorSecretCipher();
  const repo = new ConnectorsRepository();
  return appDataContext.withDataContext({ actorUserId, requestId: "test" }, async (scopedDb) => {
    const account = await repo.upsertGoogleAccount(scopedDb, {
      scopes,
      encryptedSecret: cipher.encryptJson({ kind: "google-oauth" })
    });
    const stored = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("scopes")
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();
    expect(new Set(stored.scopes)).toEqual(new Set(scopes));
    return account.id;
  });
}

describe("scope-guard fails closed end-to-end via the worker role (I1.E)", () => {
  it("the worker role can INSERT a calendar event for a google account holding the calendar scope", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.userA);
    const calendar = new CalendarRepository();
    const event = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        calendar.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "worker-evt-1",
          title: "Standup",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:15:00.000Z"
        })
    );
    expect(event.external_id).toBe("worker-evt-1");
  });

  it("rejects a worker-role calendar INSERT when the google account lacks the calendar scope", async () => {
    // Seed the MISMATCHED scope under ids.userB right before the assertion (overwrites any prior
    // userB scope; precondition proven inside seedGoogleAccount). userB never holds the calendar
    // scope here, so the scope guard must fail the INSERT closed.
    const accountId = await seedGoogleAccount([GMAIL_SCOPE], ids.userB);
    const calendar = new CalendarRepository();
    await expect(
      workerDataContext.withDataContext({ actorUserId: ids.userB, requestId: "test" }, (scopedDb) =>
        calendar.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "worker-evt-blocked",
          title: "Blocked",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:15:00.000Z"
        })
      )
    ).rejects.toThrow();
  });

  it("the worker role can INSERT an email message for a google account holding the gmail scope", async () => {
    const accountId = await seedGoogleAccount([GMAIL_SCOPE], ids.userA);
    const email = new EmailRepository();
    const row = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        email.upsertCachedMessage(scopedDb, {
          connectorAccountId: accountId,
          externalId: "worker-msg-1",
          sender: "a@b.com",
          subject: "Bill due",
          receivedAt: "2026-06-13T09:00:00.000Z",
          summary: null,
          signals: {}
        })
    );
    expect(row.external_id).toBe("worker-msg-1");
  });

  it("rejects a worker-role email INSERT when the google account lacks the gmail scope", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.userB);
    const email = new EmailRepository();
    await expect(
      workerDataContext.withDataContext({ actorUserId: ids.userB, requestId: "test" }, (scopedDb) =>
        email.upsertCachedMessage(scopedDb, {
          connectorAccountId: accountId,
          externalId: "worker-msg-blocked",
          sender: "a@b.com",
          subject: "Blocked",
          receivedAt: "2026-06-13T09:00:00.000Z",
          summary: null,
          signals: {}
        })
      )
    ).rejects.toThrow();
  });
});

describe("CalendarRepository.deleteStaleCachedEvents", () => {
  it("worker deletes only stale owner rows for one connector account", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.adminUser);
    const calendar = new CalendarRepository();
    await workerDataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "test" },
      async (db) => {
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "keep-1",
          title: "Keep",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:30:00.000Z"
        });
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "drop-1",
          title: "Drop",
          startsAt: "2026-06-13T10:00:00.000Z",
          endsAt: "2026-06-13T10:30:00.000Z"
        });

        const deleted = await calendar.deleteStaleCachedEvents(db, {
          connectorAccountId: accountId,
          keepExternalIds: ["keep-1"]
        });
        expect(deleted).toBe(1);

        const rows = await db.db
          .selectFrom("app.calendar_events")
          .select("external_id")
          .where("connector_account_id", "=", accountId)
          .orderBy("external_id")
          .execute();
        expect(rows.map((row) => row.external_id)).toEqual(["keep-1"]);
      }
    );
  });

  it("empty keep set deletes all rows for the account", async () => {
    const accountId = await seedGoogleAccount([CALENDAR_SCOPE], ids.userB);
    const calendar = new CalendarRepository();
    const deleted = await workerDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "test" },
      async (db) => {
        await calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "drop-empty-1",
          title: "Drop empty",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:30:00.000Z"
        });
        return calendar.deleteStaleCachedEvents(db, {
          connectorAccountId: accountId,
          keepExternalIds: []
        });
      }
    );

    expect(deleted).toBe(1);
  });
});

// P3 real-briefings: the briefing pg-boss worker (jarvis_worker_runtime) reads today's calendar +
// email via the calendar/email read tools, which call CalendarRepository.listVisible /
// EmailRepository.listVisible under a worker-role DataContext scoped to the briefing owner. The
// connector-sync slice already granted the worker SELECT (migrations 0066/0068) with owner-or-share
// SELECT policies; these tests prove a FRESH worker-role SELECT (not just the INSERT RETURNING)
// returns the owner's seeded rows, so the briefing path reads real data instead of degrading to an
// empty gap. Owner-scoping is preserved: a different actor's worker SELECT must NOT see the rows.
describe("worker-role read-through for the briefing path (P3 real-briefings)", () => {
  it("the worker role reads the owner's calendar + email via listVisible, owner-scoped", async () => {
    const calendarAccount = await seedGoogleAccount([CALENDAR_SCOPE], ids.userA);
    const calendar = new CalendarRepository();
    await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        calendar.upsertCachedEvent(scopedDb, {
          connectorAccountId: calendarAccount,
          externalId: "worker-read-evt",
          title: "Briefing standup",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:15:00.000Z"
        })
    );

    const emailAccount = await seedGoogleAccount([GMAIL_SCOPE], ids.userA);
    const email = new EmailRepository();
    await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        email.upsertCachedMessage(scopedDb, {
          connectorAccountId: emailAccount,
          externalId: "worker-read-msg",
          sender: "a@b.com",
          subject: "Invoice due",
          receivedAt: "2026-06-13T09:00:00.000Z",
          summary: null,
          signals: {}
        })
    );

    // Fresh worker-role SELECT scoped to the OWNER sees the seeded rows.
    const ownerEvents = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => calendar.listVisible(scopedDb)
    );
    const ownerMessages = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => email.listVisible(scopedDb)
    );
    expect(ownerEvents.some((e) => e.external_id === "worker-read-evt")).toBe(true);
    expect(ownerMessages.some((m) => m.external_id === "worker-read-msg")).toBe(true);

    // A DIFFERENT actor's worker-role SELECT must NOT see another owner's rows (RLS owner-scoping
    // holds for the worker role — no cross-user leak in the briefing read path).
    const otherEvents = await workerDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "test" },
      (scopedDb) => calendar.listVisible(scopedDb)
    );
    const otherMessages = await workerDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "test" },
      (scopedDb) => email.listVisible(scopedDb)
    );
    expect(otherEvents.some((e) => e.external_id === "worker-read-evt")).toBe(false);
    expect(otherMessages.some((m) => m.external_id === "worker-read-msg")).toBe(false);
  });
});
