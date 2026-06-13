import { expect } from "vitest";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "../test-database.js";

/**
 * Shared lifecycle + helpers for the google-sync integration suites.
 *
 * The google-sync tests are split across two sibling files (the catalog/repo/parser suite
 * in `google-sync.test.ts` and the orchestration/route suite in
 * `google-sync-orchestration.test.ts`) to stay under the 1000-line file-size gate. Both
 * need the same foundation reset + app/worker DataContexts. Vitest runs `beforeAll` per
 * file, so each file calls `setupGoogleSyncDatabase()` in its own `beforeAll` and
 * `teardownGoogleSyncDatabase(handles)` in its own `afterAll`; `seedGoogleAccount` takes
 * the app DataContext explicitly.
 */
export interface GoogleSyncDatabaseHandles {
  appDb: Kysely<JarvisDatabase>;
  dataContext: DataContextRunner;
  workerDb: Kysely<JarvisDatabase>;
  workerDataContext: DataContextRunner;
}

export async function setupGoogleSyncDatabase(): Promise<GoogleSyncDatabaseHandles> {
  await resetFoundationDatabase();
  const appDb = createDatabase({ connectionString: connectionStrings.app });
  const dataContext = new DataContextRunner(appDb);
  const workerDb = createDatabase({ connectionString: connectionStrings.worker });
  const workerDataContext = new DataContextRunner(workerDb);
  return { appDb, dataContext, workerDb, workerDataContext };
}

export async function teardownGoogleSyncDatabase(
  handles: GoogleSyncDatabaseHandles
): Promise<void> {
  await handles.appDb.destroy();
  await handles.workerDb.destroy();
}

// IMPORTANT — test isolation. `upsertGoogleAccount` is a SINGLETON per user (keyed on
// provider_id = GOOGLE_PROVIDER_ID): every call for the same actor OVERWRITES that user's
// one google account (id + scopes). The connector-account row is seeded via the APP
// DataContext (the worker has no INSERT grant on connector_accounts — see 0069 note); the
// worker DataContext only ever READS it. Seed POSITIVE cases under `ids.userA`; the A4
// cross-user invisibility case uses `ids.adminUser`, which no test ever gives an account.
export async function seedGoogleAccount(
  dataContext: DataContextRunner,
  scopes: string[],
  actorUserId: string = ids.userA
): Promise<string> {
  const cipher = createConnectorSecretCipher();
  const repo = new ConnectorsRepository();
  return dataContext.withDataContext({ actorUserId, requestId: "test" }, async (scopedDb) => {
    const account = await repo.upsertGoogleAccount(scopedDb, {
      scopes,
      encryptedSecret: cipher.encryptJson({ kind: "google-oauth" })
    });
    // Prove the precondition: the stored scopes are exactly what this test seeded.
    const stored = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("scopes")
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();
    expect(new Set(stored.scopes)).toEqual(new Set(scopes));
    return account.id;
  });
}
