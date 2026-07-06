import { beforeAll, describe, expect, it } from "vitest";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { ConnectorsRepository } from "@jarv1s/connectors";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { Kysely } from "kysely";

describe("Email triage feedback — migration 0141 (spec #729 §6)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const repository = new ConnectorsRepository();

  const ctxA = { actorUserId: ids.userA, requestId: "req:triage-feedback-a" };
  const ctxB = { actorUserId: ids.userB, requestId: "req:triage-feedback-b" };

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  it("records accepted and rejected verdicts and aggregates them by sender domain", async () => {
    await dataContext.withDataContext(ctxA, async (scopedDb) => {
      await repository.recordTriageFeedback(scopedDb, {
        connectorAccountId: null,
        actionability: "needs_action",
        sender: "billing@noisy.example",
        senderDomain: "noisy.example",
        subjectPrefix: "Your invoice is ready",
        actionType: "create_task",
        confidence: 0.8,
        modelVersion: "triage-v1",
        verdict: "rejected",
        reason: "not_actionable"
      });
      await repository.recordTriageFeedback(scopedDb, {
        connectorAccountId: null,
        actionability: "needs_reply",
        sender: "sales@noisy.example",
        senderDomain: "noisy.example",
        subjectPrefix: null,
        actionType: "create_task",
        confidence: 0.6,
        modelVersion: "triage-v1",
        verdict: "rejected",
        reason: null
      });
      await repository.recordTriageFeedback(scopedDb, {
        connectorAccountId: null,
        actionability: "needs_reply",
        sender: "boss@work.example",
        senderDomain: "work.example",
        subjectPrefix: "Budget approval",
        actionType: "create_task",
        confidence: 0.9,
        modelVersion: "triage-v1",
        verdict: "accepted",
        reason: null
      });
    });

    const aggregates = await dataContext.withDataContext(ctxA, (scopedDb) =>
      repository.listTriageRejectionAggregates(scopedDb)
    );

    expect(aggregates).toEqual(
      expect.arrayContaining([
        { senderDomain: "noisy.example", rejected: 2, accepted: 0 },
        { senderDomain: "work.example", rejected: 0, accepted: 1 }
      ])
    );
  });

  it("keeps feedback owner-only under RLS: the other user sees no rows or aggregates", async () => {
    const aggregatesForB = await dataContext.withDataContext(ctxB, (scopedDb) =>
      repository.listTriageRejectionAggregates(scopedDb)
    );
    expect(aggregatesForB).toEqual([]);

    const rowsForB = await dataContext.withDataContext(ctxB, (scopedDb) =>
      scopedDb.db.selectFrom("app.email_triage_feedback").select("id").execute()
    );
    expect(rowsForB).toEqual([]);
  });

  it("rejects an unknown verdict via the CHECK constraint", async () => {
    await expect(
      dataContext.withDataContext(ctxA, (scopedDb) =>
        repository.recordTriageFeedback(scopedDb, {
          connectorAccountId: null,
          actionability: "needs_reply",
          sender: "x@y.example",
          senderDomain: "y.example",
          subjectPrefix: null,
          actionType: null,
          confidence: null,
          modelVersion: null,
          verdict: "maybe" as never,
          reason: null
        })
      )
    ).rejects.toThrow();
  });
});
