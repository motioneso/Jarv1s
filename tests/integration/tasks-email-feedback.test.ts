import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emailSourceRef } from "@jarv1s/connectors";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { EmailRepository } from "@jarv1s/email";
import { createEmailTriageFeedbackPort } from "@jarv1s/module-registry";
import { registerTasksRoutes, TasksRepository, type EmailTriageFeedbackPort } from "@jarv1s/tasks";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

const CONNECTOR_ACCOUNT_ID = "e7f1a4a0-9b2c-4d3e-8f10-000000000729";
const OTHER_CONNECTOR_ACCOUNT_ID = "e7f1a4a0-9b2c-4d3e-8f10-000000000730";
const EMAIL_EXTERNAL_ID = "gmail-msg-feedback-1";

describe("Tasks — email triage feedback on suggested-task accept/reject (spec #729 §6)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const tasksRepository = new TasksRepository();
  const emailRepository = new EmailRepository();

  const ctx = { actorUserId: ids.userA, requestId: "req:email-feedback" };

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `
          INSERT INTO app.connector_accounts (
            id, provider_id, owner_user_id, scopes, status, encrypted_secret
          )
          VALUES
            ($1, 'google-email', $3, ARRAY['gmail.readonly']::text[], 'active', '{}'::jsonb),
            ($2, 'google-email', $3, ARRAY['gmail.readonly']::text[], 'active', '{}'::jsonb)
        `,
        [CONNECTOR_ACCOUNT_ID, OTHER_CONNECTOR_ACCOUNT_ID, ids.userA]
      );
    } finally {
      await client.end();
    }

    await dataContext.withDataContext(ctx, (scopedDb) =>
      emailRepository.upsertCachedMessage(scopedDb, {
        connectorAccountId: CONNECTOR_ACCOUNT_ID,
        sender: "billing@vendor.example",
        recipients: ["me@self.example"],
        subject: "Invoice 4711 due next week",
        receivedAt: new Date("2026-07-01T09:00:00.000Z"),
        externalId: EMAIL_EXTERNAL_ID,
        signals: { actionability: { category: "needs_action" }, confidence: 0.9 }
      })
    );

    // Same external_id, DIFFERENT connector account — email_messages is unique on
    // (connector_account_id, external_id), never on external_id alone (#729 QA finding).
    await dataContext.withDataContext(ctx, (scopedDb) =>
      emailRepository.upsertCachedMessage(scopedDb, {
        connectorAccountId: OTHER_CONNECTOR_ACCOUNT_ID,
        sender: "notifications@other-vendor.example",
        recipients: ["me@self.example"],
        subject: "Different message that happens to share an external id",
        receivedAt: new Date("2026-07-02T09:00:00.000Z"),
        externalId: EMAIL_EXTERNAL_ID,
        signals: { actionability: { category: "needs_reply" }, confidence: 0.8 }
      })
    );
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  async function buildApp(port: EmailTriageFeedbackPort | undefined): Promise<FastifyInstance> {
    const app = Fastify();
    registerTasksRoutes(app, {
      resolveAccessContext: async () => ctx,
      dataContext,
      boss: undefined as never,
      emailTriageFeedback: port
    });
    await app.ready();
    return app;
  }

  async function createSuggestedEmailTask(): Promise<string> {
    const task = await dataContext.withDataContext(ctx, (scopedDb) =>
      tasksRepository.create(scopedDb, {
        title: "Pay invoice 4711",
        status: "suggested",
        source: "email",
        sourceRef: emailSourceRef(CONNECTOR_ACCOUNT_ID, EMAIL_EXTERNAL_ID),
        externalKey: `email:${CONNECTOR_ACCOUNT_ID}:${EMAIL_EXTERNAL_ID}:${randomUUID()}`
      })
    );
    return task.id;
  }

  async function listFeedbackRows() {
    return dataContext.withDataContext(ctx, (scopedDb) =>
      scopedDb.db
        .selectFrom("app.email_triage_feedback")
        .selectAll()
        .orderBy("created_at", "desc")
        .execute()
    );
  }

  it("PATCH suggested → todo records an accepted feedback row enriched from the cached email", async () => {
    const app = await buildApp(createEmailTriageFeedbackPort());
    try {
      const taskId = await createSuggestedEmailTask();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        payload: { status: "todo" }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().task.status).toBe("todo");

      const rows = await listFeedbackRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        verdict: "accepted",
        sender: "billing@vendor.example",
        sender_domain: "vendor.example",
        actionability: "needs_action",
        connector_account_id: CONNECTOR_ACCOUNT_ID,
        source: "email"
      });
      expect(rows[0]?.subject_prefix).toBe("Invoice 4711 due next week");
      expect(rows[0]?.owner_user_id).toBe(ids.userA);
    } finally {
      await app.close();
    }
  });

  it("two connector accounts sharing the same external_id: feedback resolves the ACCOUNT-SCOPED row, never the other account's", async () => {
    const app = await buildApp(createEmailTriageFeedbackPort());
    try {
      const before = (await listFeedbackRows()).length;
      const task = await dataContext.withDataContext(ctx, (scopedDb) =>
        tasksRepository.create(scopedDb, {
          title: "Reply to the other vendor",
          status: "suggested",
          source: "email",
          sourceRef: emailSourceRef(OTHER_CONNECTOR_ACCOUNT_ID, EMAIL_EXTERNAL_ID),
          externalKey: `email:${OTHER_CONNECTOR_ACCOUNT_ID}:${EMAIL_EXTERNAL_ID}:${randomUUID()}`
        })
      );

      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        payload: { status: "todo" }
      });
      expect(res.statusCode).toBe(200);

      const rows = await listFeedbackRows();
      expect(rows).toHaveLength(before + 1);
      // Must be enriched from OTHER_CONNECTOR_ACCOUNT_ID's message, not CONNECTOR_ACCOUNT_ID's
      // (both share EMAIL_EXTERNAL_ID) — a bare external_id lookup would have returned whichever
      // row query planning happened to pick, silently misattributing the feedback.
      expect(rows[0]).toMatchObject({
        verdict: "accepted",
        sender: "notifications@other-vendor.example",
        sender_domain: "other-vendor.example",
        actionability: "needs_reply",
        connector_account_id: OTHER_CONNECTOR_ACCOUNT_ID,
        source: "email"
      });
      expect(rows[0]?.subject_prefix).toBe(
        "Different message that happens to share an external id"
      );
    } finally {
      await app.close();
    }
  });

  it("PATCH suggested → archived records a rejected feedback row", async () => {
    const app = await buildApp(createEmailTriageFeedbackPort());
    try {
      const before = (await listFeedbackRows()).length;
      const taskId = await createSuggestedEmailTask();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        payload: { status: "archived" }
      });
      expect(res.statusCode).toBe(200);

      const rows = await listFeedbackRows();
      expect(rows).toHaveLength(before + 1);
      expect(rows[0]?.verdict).toBe("rejected");
    } finally {
      await app.close();
    }
  });

  it("falls back to unknown sender fields when the cached email row is gone", async () => {
    const app = await buildApp(createEmailTriageFeedbackPort());
    try {
      const before = (await listFeedbackRows()).length;
      const task = await dataContext.withDataContext(ctx, (scopedDb) =>
        tasksRepository.create(scopedDb, {
          title: "Task whose email left the cache",
          status: "suggested",
          source: "email",
          sourceRef: emailSourceRef(CONNECTOR_ACCOUNT_ID, "gmail-msg-evicted"),
          externalKey: `email:${CONNECTOR_ACCOUNT_ID}:gmail-msg-evicted:${randomUUID()}`
        })
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        payload: { status: "todo" }
      });
      expect(res.statusCode).toBe(200);

      const rows = await listFeedbackRows();
      expect(rows).toHaveLength(before + 1);
      expect(rows[0]).toMatchObject({
        verdict: "accepted",
        sender: "unknown",
        sender_domain: "unknown",
        actionability: "unknown",
        subject_prefix: null,
        connector_account_id: null
      });
    } finally {
      await app.close();
    }
  });

  it("manual task transitions record nothing", async () => {
    const app = await buildApp(createEmailTriageFeedbackPort());
    try {
      const before = (await listFeedbackRows()).length;
      const task = await dataContext.withDataContext(ctx, (scopedDb) =>
        tasksRepository.create(scopedDb, { title: "Ordinary manual task" })
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        payload: { status: "done" }
      });
      expect(res.statusCode).toBe(200);

      expect(await listFeedbackRows()).toHaveLength(before);
    } finally {
      await app.close();
    }
  });

  it("a throwing feedback port never breaks the PATCH itself", async () => {
    const throwingPort: EmailTriageFeedbackPort = {
      record: async () => {
        throw new Error("feedback store exploded");
      }
    };
    const app = await buildApp(throwingPort);
    try {
      const before = (await listFeedbackRows()).length;
      const taskId = await createSuggestedEmailTask();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        payload: { status: "todo" }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().task.status).toBe("todo");

      expect(await listFeedbackRows()).toHaveLength(before);
    } finally {
      await app.close();
    }
  });
});
