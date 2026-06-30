import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { ConnectorsRepository } from "@jarv1s/connectors";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

describe("imap connector definitions", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("seeds the four imap provider definitions readable by any actor", async () => {
    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:a" },
      (db) => new ConnectorsRepository().listProviders(db)
    );
    const imap = rows
      .filter((r) => r.provider_type === "imap")
      .map((r) => r.provider_id)
      .sort();
    expect(imap).toEqual(["imap-fastmail", "imap-icloud", "imap-proton", "imap-yahoo"]);
  });
});
