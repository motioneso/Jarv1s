// Integration, not unit (#1285): countUnreadByModule is a SQL aggregate under RLS, and the
// thing most likely to be wrong is the join to app.notification_reads — a mocked repository
// never exercises that join, so this must run against a real database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  createDatabase,
  DataContextRunner,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { NotificationsRepository } from "@jarv1s/notifications";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("notifications unread-by-module count (#1285)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: NotificationsRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new NotificationsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("counts unread notifications per module, for the actor only", async () => {
    // Two job-search notifications for userA (both start unread).
    const jobSearchOne = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "job-search", title: "New match: Staff Engineer" })
    ))!;
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "job-search",
        title: "New match: Principal Engineer"
      })
    );
    // One news notification for userA (unread) — proves the result is keyed rather than
    // one filtered count that would collapse job-search and news together.
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "news", title: "Morning digest ready" })
    );
    // One job-search notification for userA already marked read — must NOT count toward
    // "job-search": a count that forgets the notification_reads join would report 4 here
    // instead of 2 (rulings-ledger G1: read state lives in a separate table).
    const jobSearchRead = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "job-search", title: "New match: Read already" })
    ))!;
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, jobSearchRead.id)
    );
    // One core notification for userA (module_id IS NULL) — must reach unreadCount but stay
    // out of unreadByModule entirely; core notifications have no nav entry to badge and
    // repository.create() requires a moduleId, so this row is written directly.
    await insertCoreNotification(ids.userA, "Weekly summary ready");
    // One job-search notification belonging to a DIFFERENT user — must not leak into
    // userA's count under RLS.
    await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "job-search", title: "userB's own match" })
    );

    const result = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listVisible(scopedDb)
    );

    // "job-search": 2 (not 4) proves both the read notification and the other user's row
    // are excluded. "news": 1 proves the map is keyed by module rather than one flat total.
    expect(result.unreadByModule).toEqual({ "job-search": 2, news: 1 });
    // unreadCount === 4 proves the core notification (module_id IS NULL) still reaches the
    // bell's total even though it stays out of the per-module map.
    expect(result.unreadCount).toBe(4);
    expect(jobSearchOne.module_id).toBe("job-search");
  });
});

// repository.create() requires a moduleId (see notification-repository-preferences.test.ts),
// so a core (module_id IS NULL) row is written directly via the bootstrap connection, the
// same technique tests/integration/notifications.test.ts uses to seed rows outside the
// repository's own write path.
async function insertCoreNotification(recipientUserId: string, title: string): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO app.notifications (id, actor_user_id, recipient_user_id, title, module_id)
        VALUES (gen_random_uuid(), $1, $1, $2, NULL)
      `,
      [recipientUserId, title]
    );
  } finally {
    await client.end();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-unread-by-module"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-unread-by-module"
  };
}
