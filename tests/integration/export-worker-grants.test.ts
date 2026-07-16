import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Kysely } from "kysely";
import pg from "pg";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// #1077: jarvis_worker_runtime is missing SELECT grants/policies on 4 tables that are in-scope
// for export.build's 38-table worker-scoped read set: notification_reads, entities (structured
// state), ai_assistant_action_requests, jarvis_action_audit_log. Today the worker role gets
// "permission denied" reading these under FORCE RLS. These tests must fail red against current
// grants (Task 1); Task 2 adds one migration per table (SELECT-only, mirrored predicate).

const ownerUserId = "00000000-0000-4000-8000-000000000901";
const notificationId = "00000000-0000-4000-8000-000000000902";
const entityId = "00000000-0000-4000-8000-000000000903";
const actionRequestId = "00000000-0000-4000-8000-000000000904";
const auditLogId = "00000000-0000-4000-8000-000000000905";

let appDb: Kysely<JarvisDatabase>;
let appDataContext: DataContextRunner;
let workerDb: Kysely<JarvisDatabase>;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();

  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, name, is_instance_admin)
       VALUES ($1, 'export-grants-owner@example.test', 'Export Grants Owner', false)`,
      [ownerUserId]
    );
  } finally {
    await client.end();
  }

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
  appDataContext = new DataContextRunner(appDb);
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 2 });
  workerDataContext = new DataContextRunner(workerDb);

  // Seed one row per gap table under the app role (mirrors real writes going through the app).
  await appDataContext.withDataContext(
    { actorUserId: ownerUserId, requestId: "req:seed-grants" },
    async (scopedDb) => {
      await scopedDb.db
        .insertInto("app.notifications")
        .values({
          id: notificationId,
          recipient_user_id: ownerUserId,
          actor_user_id: null,
          title: "GAP-TABLE-MARKER-NOTIFICATION",
          body: "seed"
        })
        .execute();
      await scopedDb.db
        .insertInto("app.notification_reads")
        .values({ notification_id: notificationId, user_id: ownerUserId })
        .execute();

      await scopedDb.db
        .insertInto("app.entities")
        .values({
          id: entityId,
          owner_user_id: ownerUserId,
          type: "person",
          name: "GAP-TABLE-MARKER-ENTITY",
          provenance: "volunteered"
        })
        .execute();

      await scopedDb.db
        .insertInto("app.ai_assistant_action_requests")
        .values({
          id: actionRequestId,
          status: "pending",
          owner_user_id: ownerUserId,
          tool_module_id: "tasks",
          tool_module_name: "Tasks",
          tool_name: "create_task",
          permission_id: "tasks.write",
          risk: "write",
          input_summary: { note: "GAP-TABLE-MARKER-ACTION-REQUEST" }
        })
        .execute();

      await scopedDb.db
        .insertInto("app.jarvis_action_audit_log")
        .values({
          id: auditLogId,
          owner_user_id: ownerUserId,
          tool_module_id: "tasks",
          tool_name: "create_task",
          action_kind: "write",
          approval_mode: "auto",
          outcome: "success",
          source_surface: "chat"
        })
        .execute();
    }
  );
});

afterAll(async () => {
  await appDb?.destroy();
  await workerDb?.destroy();
});

describe("export-worker-grants (#1077) — jarvis_worker_runtime SELECT on the 4 gap tables", () => {
  const gapTables = [
    "notification_reads",
    "entities",
    "ai_assistant_action_requests",
    "jarvis_action_audit_log"
  ] as const;

  it("worker role can SELECT owner rows from all 4 gap tables (currently permission denied)", async () => {
    await workerDataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req:worker-select-all" },
      async (scopedDb) => {
        const reads = await scopedDb.db
          .selectFrom("app.notification_reads")
          .selectAll()
          .where("notification_id", "=", notificationId)
          .execute();
        expect(reads).toHaveLength(1);

        const entities = await scopedDb.db
          .selectFrom("app.entities")
          .selectAll()
          .where("id", "=", entityId)
          .execute();
        expect(entities.map((e) => e.name)).toEqual(["GAP-TABLE-MARKER-ENTITY"]);

        const actionRequests = await scopedDb.db
          .selectFrom("app.ai_assistant_action_requests")
          .selectAll()
          .where("id", "=", actionRequestId)
          .execute();
        expect(actionRequests).toHaveLength(1);

        const auditLog = await scopedDb.db
          .selectFrom("app.jarvis_action_audit_log")
          .selectAll()
          .where("id", "=", auditLogId)
          .execute();
        expect(auditLog).toHaveLength(1);
      }
    );
  });

  it("worker role gets permission denied writing to each gap table (SELECT-only grant)", async () => {
    // Each write runs in its own withDataContext transaction: once a statement fails with
    // "permission denied", Postgres aborts that transaction and every later statement in it
    // reports "current transaction is aborted" instead of its own real error, masking the
    // per-table assertion — so writes must not share a transaction.
    await workerDataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req:worker-write-denied-notification-reads" },
      (scopedDb) =>
        expect(
          scopedDb.db
            .insertInto("app.notification_reads")
            .values({ notification_id: notificationId, user_id: ownerUserId })
            .execute()
        ).rejects.toThrow(/permission denied/i)
    );

    await workerDataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req:worker-write-denied-entities" },
      (scopedDb) =>
        expect(
          scopedDb.db
            .updateTable("app.entities")
            .set({ name: "worker-should-not-write" })
            .where("id", "=", entityId)
            .execute()
        ).rejects.toThrow(/permission denied/i)
    );

    await workerDataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req:worker-write-denied-action-requests" },
      (scopedDb) =>
        expect(
          scopedDb.db
            .updateTable("app.ai_assistant_action_requests")
            .set({ status: "confirmed" })
            .where("id", "=", actionRequestId)
            .execute()
        ).rejects.toThrow(/permission denied/i)
    );

    await workerDataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req:worker-write-denied-audit-log" },
      (scopedDb) =>
        expect(
          scopedDb.db
            .deleteFrom("app.jarvis_action_audit_log")
            .where("id", "=", auditLogId)
            .execute()
        ).rejects.toThrow(/permission denied/i)
    );
  });

  it("worker SELECT policy returns the identical row set as the app role's owner-visible predicate", async () => {
    for (const table of gapTables) {
      const appRows = await appDataContext.withDataContext(
        { actorUserId: ownerUserId, requestId: `req:policy-exactness-app-${table}` },
        (scopedDb) =>
          scopedDb.db
            .selectFrom(`app.${table}` as "app.entities")
            .selectAll()
            .execute()
      );
      const workerRows = await workerDataContext.withDataContext(
        { actorUserId: ownerUserId, requestId: `req:policy-exactness-worker-${table}` },
        (scopedDb) =>
          scopedDb.db
            .selectFrom(`app.${table}` as "app.entities")
            .selectAll()
            .execute()
      );
      expect(workerRows).toEqual(appRows);
    }
  });
});
