// Split #1328: Task 2b (#1283) ctx.notify keyed upsert / return-to-unread tests, moved
// verbatim out of notifications.test.ts when that file grew past the 1000-line cap. These
// tests mint their own notifications via repository.create({ eventKey }) and don't touch
// the shared seed rows, so this file's trimmed harness drops notificationIds/
// seedNotificationData entirely — the only pieces of ./notifications-harness.ts it needs
// are userAContext(). It keeps workerDb/workerDataContext, since the return-to-unread test
// re-fires from the WORKER role the same way the real crawl posts notifications
// (apps/worker/src/worker.ts's postModuleNotification).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { NotificationsRepository } from "@jarv1s/notifications";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { userAContext } from "./notifications-harness.js";

describe("Notifications module — Task 2b keyed upsert / return-to-unread", () => {
  let appDb: Kysely<JarvisDatabase>;
  let workerDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let workerDataContext: DataContextRunner;
  let repository: NotificationsRepository;
  let boss: PgBoss;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    // Task 2b (#1283): a separate jarvis_worker_runtime-role connection, so the
    // return-to-unread test can exercise repository.create() the way the real crawl
    // does — posting a keyed notification from the worker/queue lane, not the API.
    workerDb = createDatabase({
      connectionString: connectionStrings.worker,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    workerDataContext = new DataContextRunner(workerDb);
    repository = new NotificationsRepository();
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({
      appDb,
      boss,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([
      server?.close(),
      appDb?.destroy(),
      workerDb?.destroy(),
      boss?.stop({ graceful: false })
    ]);
  });

  it("re-firing the same event_key updates the existing row instead of inserting a duplicate", async () => {
    const eventKey = `dedupe-${randomUUID()}`;
    const first = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "First fire",
        body: "v1",
        eventKey
      })
    ))!;
    const second = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "Second fire",
        body: "v2",
        eventKey
      })
    ))!;

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Second fire");
    expect(second.body).toBe("v2");

    // Exactly one row exists for this key — the ON CONFLICT arbiter updated in place
    // rather than the partial unique index rejecting a genuine duplicate insert.
    const visible = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listVisible(scopedDb)
    );
    expect(visible.notifications.filter((n) => n.id === first.id)).toHaveLength(1);
  });

  it("rejects a non-same-origin href at the repository layer (defense in depth)", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.create(scopedDb, {
          moduleId: "briefings",
          title: "Bad href",
          href: "https://evil.example.com"
        })
      )
    ).rejects.toThrow(/same-origin path/);
  });

  it("href survives the REST response (GET /api/notifications)", async () => {
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "Deep link probe",
        href: "/briefings/today"
      })
    ))!;
    const response = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ notifications: Array<{ id: string; href: string | null }> }>();
    const dto = body.notifications.find((n) => n.id === created.id);
    expect(dto?.href).toBe("/briefings/today");
  });

  it("a keyed re-fire under the WORKER role returns the notification to unread, at the repository and over REST", async () => {
    const eventKey = `return-unread-${randomUUID()}`;
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "Sync complete", eventKey })
    ))!;
    const read = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, created.id)
    );
    expect(read?.read_at).toBeInstanceOf(Date);

    // Re-fire from the WORKER role — the same connection role the real crawl posts
    // through (apps/worker/src/worker.ts's postModuleNotification). Only migration
    // 0175's grant to jarvis_worker_runtime makes this UPDATE/DELETE possible.
    const refired = await workerDataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "Sync complete again", eventKey })
    );
    expect(refired?.id).toBe(created.id);
    expect(refired?.read_at).toBeNull();

    const response = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    const dto = response
      .json<{ notifications: Array<{ id: string; readAt: string | null }> }>()
      .notifications.find((n) => n.id === created.id);
    expect(dto?.readAt).toBeNull();
  });

  it("the return-to-unread clear only touches the re-fired notification's own read row", async () => {
    const keyA = `scope-a-${randomUUID()}`;
    const keyB = `scope-b-${randomUUID()}`;
    const notifA = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "A v1", eventKey: keyA })
    ))!;
    const notifB = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "B v1", eventKey: keyB })
    ))!;
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notifA.id)
    );
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notifB.id)
    );

    // Re-fire ONLY keyA.
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "A v2", eventKey: keyA })
    );

    const afterA = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notifA.id)
    );
    const afterB = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notifB.id)
    );
    expect(afterA?.read_at).toBeNull();
    expect(afterB?.read_at).toBeInstanceOf(Date);
  });

  it("a concurrent markRead and keyed re-fire do not deadlock or error (FOR UPDATE lock)", async () => {
    const eventKey = `concurrent-${randomUUID()}`;
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "Concurrent v1", eventKey })
    ))!;

    // Both statements lock the same app.notifications row (markRead's inner SELECT ...
    // FOR UPDATE OF n, and create()'s ON CONFLICT DO UPDATE) — they serialize instead of
    // racing. Either ordering is a valid, consistent outcome; a lost update or thrown
    // error is not.
    const [markReadResult, refireResult] = await Promise.all([
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.markRead(scopedDb, created.id)
      ),
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        repository.create(scopedDb, { moduleId: "briefings", title: "Concurrent v2", eventKey })
      )
    ]);

    expect(markReadResult).toBeDefined();
    expect(refireResult?.id).toBe(created.id);

    const final = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );
    expect(final?.id).toBe(created.id);
    expect(final?.title).toBe("Concurrent v2");
    expect(final?.read_at === null || final?.read_at instanceof Date).toBe(true);
  });
});
