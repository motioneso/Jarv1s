import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { EmailActionSuppressionRepository } from "@jarv1s/connectors";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { Kysely } from "kysely";

describe("email action suppression owner-only RLS", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const repository = new EmailActionSuppressionRepository();
  const subjectSignature = "c".repeat(64);

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  it("owner cannot read or update another owner's suppression state", async () => {
    const ownerState = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-a" },
      (scopedDb) =>
        repository.upsert(scopedDb, {
          subjectSignature,
          dismissalCount: 1,
          lastDeadlineEvidenceKey: "deadline-a",
          lastContextMessageKey: "context-a"
        })
    );

    const foreignRead = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:suppression-b-read" },
      (scopedDb) => repository.get(scopedDb, subjectSignature)
    );
    expect(foreignRead).toBeUndefined();

    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:suppression-b-update" },
      (scopedDb) =>
        sql`
          UPDATE app.email_action_suppression
          SET dismissal_count = 99
          WHERE subject_signature = ${subjectSignature}
        `.execute(scopedDb.db)
    );

    const ownerAfter = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-a-after" },
      (scopedDb) => repository.get(scopedDb, subjectSignature)
    );
    expect(ownerState.dismissal_count).toBe(1);
    expect(ownerAfter?.dismissal_count).toBe(1);
  });
});
