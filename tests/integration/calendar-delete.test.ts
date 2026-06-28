import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DataContextRunner,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ConnectorsRepository,
  createConnectorSecretCipher
} from "@jarv1s/connectors";
import { CalendarRepository } from "@jarv1s/calendar";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// ─── Section A: CalendarRepository.deleteById ────────────────────────────────

describe("Section A — CalendarRepository.deleteById", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });
  afterAll(async () => {
    await appDb.destroy();
  });

  async function seedGoogleAccount(ownerId: string, scopes: string[]): Promise<string> {
    const cipher = createConnectorSecretCipher();
    const repo = new ConnectorsRepository();
    const account = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "seed" },
      (scopedDb) =>
        repo.upsertGoogleAccount(scopedDb, {
          scopes,
          encryptedSecret: cipher.encryptJson({
            kind: "google-oauth",
            clientId: "cid",
            clientSecret: "csecret",
            accessToken: "atoken",
            refreshToken: "rtoken",
            tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
            grantedScopes: scopes
          })
        })
    );
    return account.id;
  }

  it("deleteById removes an existing owned event; getById returns undefined after", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const repo = new CalendarRepository();

    // Insert a cache row as userA
    const inserted = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "insert" },
      (scopedDb) =>
        repo.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "google-evt-A1",
          title: "Team meeting",
          startsAt: new Date("2026-06-28T14:00:00Z"),
          endsAt: new Date("2026-06-28T15:00:00Z")
        })
    );

    // Delete it
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "delete" },
      (scopedDb) => repo.deleteById(scopedDb, inserted.id)
    );

    // Should be gone
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (scopedDb) => repo.getById(scopedDb, inserted.id)
    );
    expect(found).toBeUndefined();
  });

  it("deleteById is a no-op (does not throw) when the event does not exist", async () => {
    const repo = new CalendarRepository();
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "noop" },
        (scopedDb) => repo.deleteById(scopedDb, "00000000-0000-4000-8000-999999999999")
      )
    ).resolves.toBeUndefined();
  });

  it("RLS: userB cannot delete userA's event (row invisible cross-user)", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const repo = new CalendarRepository();

    const inserted = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "insert" },
      (scopedDb) =>
        repo.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "google-evt-A2",
          title: "Private meeting",
          startsAt: new Date("2026-06-28T16:00:00Z"),
          endsAt: new Date("2026-06-28T17:00:00Z")
        })
    );

    // userB tries to delete userA's event — RLS makes it a no-op (row invisible)
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "b-delete" },
      (scopedDb) => repo.deleteById(scopedDb, inserted.id)
    );

    // userA's event is still there
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (scopedDb) => repo.getById(scopedDb, inserted.id)
    );
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
  });
});
