import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createDatabase, DataContextRunner, type MossDatabase } from "@moss/db";
import { EmailActionSuppressionRepository } from "@moss/connectors";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { Kysely } from "kysely";

describe("email action suppression owner-only RLS", () => {
  let appDb: Kysely<MossDatabase>;
  let workerDb: Kysely<MossDatabase>;
  let dataContext: DataContextRunner;
  let workerDataContext: DataContextRunner;
  const repository = new EmailActionSuppressionRepository();
  const subjectSignature = "c".repeat(64);

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    workerDataContext = new DataContextRunner(workerDb);
  });

  afterAll(async () => {
    await appDb?.destroy();
    await workerDb?.destroy();
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

  it("keeps admin and worker access owner-scoped under FORCE RLS", async () => {
    const workerSignature = "d".repeat(64);
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-worker-seed" },
      (scopedDb) =>
        repository.upsert(scopedDb, {
          subjectSignature: workerSignature,
          dismissalCount: 1,
          lastDeadlineEvidenceKey: "deadline-owner",
          lastContextMessageKey: "context-owner"
        })
    );

    const adminRead = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:suppression-admin-read" },
      (scopedDb) => repository.get(scopedDb, workerSignature)
    );
    expect(adminRead).toBeUndefined();

    const adminUpdate = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req:suppression-admin-update" },
      (scopedDb) =>
        sql`
          UPDATE app.email_action_suppression
          SET dismissal_count = 99
          WHERE subject_signature = ${workerSignature}
          RETURNING subject_signature
        `.execute(scopedDb.db)
    );
    expect(adminUpdate.rows).toEqual([]);

    const workerRead = await workerDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:suppression-worker-read" },
      (scopedDb) => repository.get(scopedDb, workerSignature)
    );
    expect(workerRead).toBeUndefined();

    const workerUpdate = await workerDataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "req:suppression-worker-update" },
      (scopedDb) =>
        sql`
          UPDATE app.email_action_suppression
          SET dismissal_count = 99
          WHERE subject_signature = ${workerSignature}
          RETURNING subject_signature
        `.execute(scopedDb.db)
    );
    expect(workerUpdate.rows).toEqual([]);

    const workerOwnerRead = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-worker-owner-read" },
      (scopedDb) => repository.get(scopedDb, workerSignature)
    );
    expect(workerOwnerRead?.dismissal_count).toBe(1);
  });

  it("retains independent deadline and context evidence keys", async () => {
    const signature = "e".repeat(64);
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-evidence-seed" },
      (scopedDb) =>
        repository.upsert(scopedDb, {
          subjectSignature: signature,
          dismissalCount: 2
        })
    );

    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-evidence-write" },
      async (scopedDb) => {
        await repository.recordDeadlineEvidence(scopedDb, signature, "deadline:tomorrow");
        await repository.recordDeadlineEvidence(scopedDb, signature, "deadline:later");
        await repository.recordContextEvidence(scopedDb, signature, "acct:message-1");
        await repository.recordContextEvidence(scopedDb, signature, "acct:message-2");
      }
    );

    const state = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req:suppression-evidence-read" },
      (scopedDb) => repository.list(scopedDb, [signature])
    );
    expect(state[0]?.deadlineEvidenceKeys).toEqual(
      expect.arrayContaining(["deadline:tomorrow", "deadline:later"])
    );
    expect(state[0]?.deadlineEvidenceKeys).toHaveLength(2);
    expect(state[0]?.contextMessageKeys).toEqual(
      expect.arrayContaining(["acct:message-1", "acct:message-2"])
    );
    expect(state[0]?.contextMessageKeys).toHaveLength(2);
  });
});
