import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import pg from "pg";
import Fastify from "fastify";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  dataContextBrand,
  type AccessContext,
  type DataContextDb,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import {
  NotificationsRepository,
  type CreateNotificationInput,
  type NotificationWithReadState,
  type QuietHoursPort,
  type QuietHoursSettings,
  computeDeferredUntil,
  resolveTimezone,
  notificationsModuleManifest,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
import { notificationDtoSchema, type NotificationMetadata } from "@jarv1s/shared";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const notificationIds = {
  aPrivate: "60000000-0000-4000-8000-000000000001",
  bPrivate: "60000000-0000-4000-8000-000000000002",
  aSeed: "60000000-0000-4000-8000-000000000003",
  forgedForUserA: "60000000-0000-4000-8000-000000000004",
  // A row written directly via the bootstrap connection with deliberately oversized / nested /
  // oddly-keyed raw metadata, to prove the OUTPUT projection (serializeNotification) strips
  // it regardless of what is in the column.
  aProjectionProbe: "60000000-0000-4000-8000-000000000005"
} as const;

// An id guaranteed not to exist as a notification row — used to assert the
// absent-vs-denied 404 indistinguishability (Verification bullet 6).
const nonexistentNotificationId = randomUUID();

describe("Notifications module M5", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let repository: NotificationsRepository;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedNotificationData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    repository = new NotificationsRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("applies Notifications migrations with forced RLS and a narrow worker SELECT/INSERT grant on notifications", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version IN ('0008', '0071', '0101', '0102', '0105', '0142')
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_select: boolean;
        worker_can_insert: boolean;
        worker_can_update: boolean;
        worker_can_delete: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'INSERT') AS worker_can_insert,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'UPDATE') AS worker_can_update,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('notifications', 'notification_reads')
          ORDER BY c.relname
        `
      );

      // 0071 (real-briefings) added a worker-role SELECT/INSERT grant + policies on
      // app.notifications ONLY (so the briefings worker can deliver the "morning briefing
      // ready" notification). notification_reads is untouched; the worker can never
      // UPDATE/DELETE notifications. 0101 adds the metadata size CHECK; 0102 adds the
      // defense-in-depth SQL comments on the notifications / notification_reads tables.
      expect(migrations.rows).toEqual([
        { version: "0008", name: "0008_notifications_module.sql" },
        { version: "0071", name: "0071_notifications_worker_insert_grant.sql" },
        {
          version: "0101",
          name: "0101_notifications_metadata_size_check.sql"
        },
        {
          version: "0102",
          name: "0102_notifications_defense_in_depth_comments.sql"
        },
        {
          version: "0105",
          name: "0105_notifications_urgency_deferral.sql"
        },
        {
          version: "0142",
          name: "0142_notifications_module_id.sql"
        }
      ]);
      expect(tables.rows).toEqual([
        {
          relname: "notification_reads",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false,
          worker_can_insert: false,
          worker_can_update: false,
          worker_can_delete: false
        },
        {
          relname: "notifications",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: true,
          worker_can_insert: true,
          worker_can_update: false,
          worker_can_delete: false
        }
      ]);
    } finally {
      await client.end();
    }
  });

  it("loads the built-in Notifications module manifest with the digest queue", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const registration = registrations.find(
      (item) => item.manifest.id === notificationsModuleManifest.id
    );
    const manifest = manifests.find((item) => item.id === notificationsModuleManifest.id);

    expect(manifests.map((item) => item.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "jarvis.goals",
      "web",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "usefulness-feedback",
      "structured-state",
      "wellness",
      "weather",
      "sports",
      "news",
      "notes",
      "proactive-monitoring",
      "jarvis.commitments",
      "people"
    ]);
    expect(registrations.map((item) => item.manifest.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "jarvis.goals",
      "web",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings",
      "memory",
      "usefulness-feedback",
      "structured-state",
      "wellness",
      "weather",
      "sports",
      "news",
      "notes",
      "proactive-monitoring",
      "jarvis.commitments",
      "people"
    ]);
    expect(manifest?.database?.ownedTables).toEqual([
      "app.notifications",
      "app.notification_reads"
    ]);
    // No sidebar nav entry: notifications are reached via the topbar bell (AppShell).
    // The route + APIs remain registered; only the module-nav link was retired.
    expect(manifest?.navigation).toEqual([]);
    expect(manifest?.settings ?? []).toEqual([]);
    expect(registration?.queueDefinitions).toEqual([
      { name: "notifications.digest.compose", options: { retryLimit: 0 } }
    ]);
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/notifications/sql")
    );
  });

  it("denies notification reads when no data context is set", async () => {
    await expect(appDb.selectFrom("app.notifications").select("id").execute()).resolves.toEqual([]);
  });

  it("forbids inserting a notification for another recipient with the current actor", async () => {
    await expect(
      dataContext.withDataContext(userBContext(), (scopedDb) =>
        scopedDb.db
          .insertInto("app.notifications")
          .values({
            id: notificationIds.forgedForUserA,
            actor_user_id: ids.userB,
            recipient_user_id: ids.userA,
            title: "Forged cross-recipient notification",
            body: "User B must not create this for User A",
            metadata: { source: "integration-test" }
          })
          .execute()
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("creates private notifications for the active actor by default", async () => {
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "Private default notification",
        body: "Only User A can read this",
        metadata: {
          source: "integration-test"
        }
      })
    ))!;
    const fetchedByOwner = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );
    const fetchedByOtherUser = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );

    expect(created.actor_user_id).toBe(ids.userA);
    expect(created.recipient_user_id).toBe(ids.userA);
    expect(created.module_id).toBe("briefings");
    expect(created.read_at).toBeNull();
    expect(fetchedByOwner?.id).toBe(created.id);
    expect(fetchedByOtherUser).toBeUndefined();
  });

  it("does not let another user or admin role read private notifications", async () => {
    const userRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.bPrivate)
    );
    const adminContext = await auth.resolveAccessContext(
      ids.sessionAdmin,
      "request:admin-notifications"
    );
    const adminRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      repository.getById(scopedDb, notificationIds.bPrivate)
    );

    expect(userRead).toBeUndefined();
    expect(adminRead).toBeUndefined();
  });

  it("recipient-only access: notification is visible to its recipient, and invisible to non-recipients", async () => {
    // aSeed has recipient_user_id=userA. Under the recipient-only RLS policy,
    // only the recipient can see it.
    const visibleToRecipient = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aSeed)
    );
    const nonRecipient = await dataContext.withDataContext(userBContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aSeed)
    );

    expect(visibleToRecipient?.id).toBe(notificationIds.aSeed);
    // Non-recipient cannot see it
    expect(nonRecipient).toBeUndefined();
  });

  it("tracks read state per actor for visible notifications", async () => {
    // aSeed has recipient_user_id=userA; it is visible to userA under the recipient-only
    // policy regardless of any inert header — the personal-actor context is the only context.
    const beforeRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aSeed)
    );
    const markedRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notificationIds.aSeed)
    );
    const afterRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, notificationIds.aSeed)
    );
    const hiddenMarkRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notificationIds.bPrivate)
    );

    expect(beforeRead?.read_at).toBeNull();
    expect(markedRead?.read_at).toBeInstanceOf(Date);
    expect(afterRead?.read_at).toBeInstanceOf(Date);
    expect(hiddenMarkRead).toBeUndefined();
  });

  it("serves Notifications API list, mark read, and mark all read from session context", async () => {
    // The personal-actor context is the only context in V1. A second request that varies
    // an irrelevant header (x-request-id) must return the identical actor-scoped set.
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const listWithIrrelevantHeaderResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-request-id": "00000000-0000-4000-8000-000000000099"
      }
    });
    const deniedMarkReadResponse = await server.inject({
      method: "PATCH",
      url: `/api/notifications/${notificationIds.bPrivate}/read`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const nonexistentMarkReadResponse = await server.inject({
      method: "PATCH",
      url: `/api/notifications/${nonexistentNotificationId}/read`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const markReadResponse = await server.inject({
      method: "PATCH",
      url: `/api/notifications/${notificationIds.aPrivate}/read`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const markAllResponse = await server.inject({
      method: "PATCH",
      url: "/api/notifications/read-all",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const afterMarkAllResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    // Under recipient-only policy, aSeed (recipient=userA) is visible to userA — the
    // personal-actor context is the only context, so the irrelevant header probe must
    // return the same actor-scoped set.
    expect(listResponse.statusCode).toBe(200);
    expect(
      listResponse
        .json<{ notifications: Array<{ id: string }> }>()
        .notifications.some((notification) => notification.id === notificationIds.aSeed)
    ).toBe(true);
    expect(listWithIrrelevantHeaderResponse.statusCode).toBe(200);
    expect(
      listWithIrrelevantHeaderResponse
        .json<{ notifications: Array<{ id: string }> }>()
        .notifications.some((notification) => notification.id === notificationIds.aSeed)
    ).toBe(true);
    // Absent-vs-denied indistinguishability: a nonexistent id (randomUUID) and an
    // RLS-invisible id (bPrivate for userA) both answer 404 with the identical body.
    expect(deniedMarkReadResponse.statusCode).toBe(404);
    expect(nonexistentMarkReadResponse.statusCode).toBe(404);
    expect(deniedMarkReadResponse.body).toBe(nonexistentMarkReadResponse.body);
    expect(markReadResponse.statusCode).toBe(200);
    expect(
      markReadResponse.json<{ notification: { id: string; readAt: string | null } }>().notification
    ).toMatchObject({
      id: notificationIds.aPrivate,
      readAt: expect.any(String)
    });
    expect(markAllResponse.statusCode).toBe(200);
    expect(markAllResponse.json<{ unreadCount: number }>().unreadCount).toBe(0);
    expect(afterMarkAllResponse.json<{ unreadCount: number }>().unreadCount).toBe(0);
  });

  it("fails loudly when the Notifications repository is called without withDataContext", async () => {
    await expect(repository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  it("returns 401 for no auth header and for a wrong-scheme authorization header", async () => {
    const noAuthResponse = await server.inject({
      method: "GET",
      url: "/api/notifications"
    });

    // Wrong scheme ("Basic") → readBearerToken returns undefined → cookie auth finds no session → 401
    const wrongSchemeResponse = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: "Basic dXNlcjpwYXNz" }
    });

    expect(noAuthResponse.statusCode).toBe(401);
    expect(wrongSchemeResponse.statusCode).toBe(401);
    expect(noAuthResponse.json<{ error: string }>().error).toBe("Session is missing or expired");
  });

  it("returns 500 (not 401) when an unexpected error escapes a notification route", async () => {
    const probe = Fastify({ logger: false });
    registerNotificationsRoutes(probe, {
      resolveAccessContext: async () => ({
        actorUserId: ids.userA,
        requestId: "request:err-probe"
      }),
      dataContext,
      repository: {
        listVisible: async () => {
          throw new Error("boom-stack-details");
        }
      } as unknown as NotificationsRepository
    });
    await probe.ready();

    try {
      const res = await probe.inject({ method: "GET", url: "/api/notifications" });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("boom-stack-details");
    } finally {
      await probe.close();
    }
  });

  // ----- Verification bullets for spec 2026-06-19-notifications-actor-scoped-hardening -----

  it("CreateNotificationInput no longer exposes recipientUserId or actorUserId (Verification 1)", () => {
    // Compile-time guard: passing either override must fail typecheck. The @ts-expect-error
    // comments will become UNUSED (and trip the lint rule) if a future change re-adds the
    // fields — surfacing the regression at compile time.
    //
    // @ts-expect-error — recipientUserId was removed in spec Decision 2
    const badRecipient: CreateNotificationInput = { title: "t", recipientUserId: ids.userA };
    // @ts-expect-error — actorUserId was removed in spec Decision 2
    const badActor: CreateNotificationInput = { title: "t", actorUserId: ids.userA };
    // @ts-expect-error — moduleId is required for every new notification
    const missingModule: CreateNotificationInput = { title: "t" };
    expect(badRecipient).toBeDefined();
    expect(badActor).toBeDefined();
    expect(missingModule).toBeDefined();

    // Runtime regression: create(scopedDb, { title, metadata }) yields a row whose
    // actor_user_id === recipient_user_id === active actor.
    // (This is asserted explicitly in the "creates private notifications for the active
    // actor by default" test above; the spec calls out that this is the regression guard.)
  });

  it("create() applies the input-side metadata projection (Verification 3a)", async () => {
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "Projection at input",
        metadata: {
          // dropped: nested object, array, bad key names
          nested: { drop: "me" },
          list: [1, 2],
          "has space": "dropped",
          // truncated: 500 → 256
          longValue: "z".repeat(500),
          // kept
          source: "input-projection",
          count: 9,
          ok: true,
          nullable: null
        }
      })
    ))!;
    expect(created.metadata).toEqual({
      source: "input-projection",
      count: 9,
      ok: true,
      nullable: null,
      longValue: "z".repeat(256)
    });
    // The stored column already reflects the bounded shape — no nested / oversized / bad keys.
    expect(JSON.stringify(created.metadata)).not.toContain("nested");
    expect(JSON.stringify(created.metadata)).not.toContain("has space");
  });

  it("serializeNotification projects raw DB metadata through GET /api/notifications (Verification 3b/REST)", async () => {
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "DTO module id probe",
        metadata: { source: "dto-module-id" }
      })
    ))!;
    const response = await server.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      notifications: Array<{
        id: string;
        moduleId: string | null;
        metadata: NotificationMetadata;
      }>;
    }>();
    const probe = body.notifications.find((n) => n.id === notificationIds.aProjectionProbe);
    const createdDto = body.notifications.find((n) => n.id === created.id);
    expect(probe).toBeDefined();
    expect(createdDto?.moduleId).toBe("briefings");
    const metadata = probe!.metadata;
    // No nested objects / arrays survived the projection.
    for (const value of Object.values(metadata)) {
      if (value === null) continue;
      expect(typeof value !== "object").toBe(true);
    }
    // No bad key names survived.
    expect(Object.keys(metadata)).not.toContain("has space");
    expect(Object.keys(metadata)).not.toContain("123numeric");
    expect(Object.keys(metadata)).not.toContain("nested");
    expect(Object.keys(metadata)).not.toContain("list");
    // At most 16 keys total.
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(16);
    // Good primitives kept verbatim (the 2-char keys sort before extraXX in jsonb storage,
    // so they survive the 16-key cap deterministically).
    expect(metadata.aa).toBe("projection-probe");
    expect(metadata.bb).toBe(3);
    expect(metadata.cc).toBe(true);
    // dd is null in the column; the projection keeps it, but Fastify's response serializer
    // drops null values inside metadata.additionalProperties.anyOf (a known fast-json-stringify
    // quirk). The security-relevant invariant — no nested / oversized / bad-key content
    // reaches clients — is pinned by the assertions above. The nullable-preserved assertion
    // lives in the unit suite (notifications-metadata-projection.test.ts).
    expect(metadata.dd === null || metadata.dd === undefined).toBe(true);
    // ee was a 500-char string in the column; the projection truncated it to 256 chars.
    expect(typeof metadata.ee).toBe("string");
    if (typeof metadata.ee === "string") {
      expect(metadata.ee.length).toBeLessThanOrEqual(256);
    }
    // 16-key cap: only the first 11 extraXX keys survived alongside the 5 good keys.
    expect(Object.keys(metadata).filter((k) => k.startsWith("extra")).length).toBeLessThanOrEqual(
      11
    );
    // Total payload within the bound.
    expect(Buffer.byteLength(JSON.stringify(metadata), "utf8")).toBeLessThanOrEqual(4096);
  });

  it("serializeNotification projects raw DB metadata through the assistant tool path (Verification 3b/tool)", async () => {
    // The notifications.listVisible tool imports serializeNotification directly — the same
    // chokepoint. We exercise it through the repository + serializer stack the tool uses.
    const result = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listVisible(scopedDb)
    );
    const probe = result.notifications.find((n) => n.id === notificationIds.aProjectionProbe);
    expect(probe).toBeDefined();
    // Re-run the serializer the same way the tool does, to assert the chokepoint.
    const { serializeNotification } = await import("@jarv1s/notifications");
    const dto = serializeNotification(probe!);
    for (const value of Object.values(dto.metadata)) {
      if (value === null) continue;
      expect(typeof value !== "object").toBe(true);
    }
    expect(Object.keys(dto.metadata)).not.toContain("nested");
    expect(Object.keys(dto.metadata)).not.toContain("list");
    expect(Object.keys(dto.metadata)).not.toContain("has space");
    expect(Object.keys(dto.metadata).length).toBeLessThanOrEqual(16);
    expect(dto.metadata.aa).toBe("projection-probe");
    expect(dto.metadata.bb).toBe(3);
    expect(dto.metadata.cc).toBe(true);
    // The direct serializer call (no Fastify in the way) preserves null — proving the
    // chokepoint itself is correct, separate from Fastify's null-dropping in the REST path.
    expect(dto.metadata.dd).toBeNull();
    expect(typeof dto.metadata.ee).toBe("string");
    expect((dto.metadata.ee as string).length).toBe(256);
  });

  it("notificationDtoSchema declares the bounded metadata contract honestly (Verification 4)", () => {
    // Static AST/equality check on the exported schema object — Fastify is NOT relied on
    // to strip fields, so the schema is documentation/honesty only. It must declare:
    //   - maxProperties: 16
    //   - propertyNames.pattern: ^[a-zA-Z_][a-zA-Z0-9_]{0,63}$
    //   - additionalProperties as a primitive-only union (string ≤256 | number | boolean | null)
    const metadataSchema = notificationDtoSchema.properties.metadata as Record<string, unknown>;
    expect(metadataSchema.maxProperties).toBe(16);
    expect((metadataSchema.propertyNames as { pattern: string }).pattern).toBe(
      "^[a-zA-Z_][a-zA-Z0-9_]{0,63}$"
    );
    const additional = metadataSchema.additionalProperties as { anyOf: unknown[] };
    expect(Array.isArray(additional.anyOf)).toBe(true);
    const stringBranch = additional.anyOf.find(
      (b): b is { type: string; maxLength: number } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "string"
    );
    expect(stringBranch?.maxLength).toBe(256);
    const types = additional.anyOf
      .map((b) => (typeof b === "object" && b !== null ? (b as { type?: string }).type : undefined))
      .filter(Boolean)
      .sort();
    expect(types).toEqual(["boolean", "null", "number", "string"]);
  });

  it("markRead returns the row in one logical operation (single round-trip by design) (Verification 5)", async () => {
    // The mandatory behavioral assertion: markRead returns the row with its read_at set,
    // or undefined. The single-round-trip design is anchored in the repository docblock
    // ("Single round-trip via a modifying CTE") and verified here at the behavior level.
    // The CTE shape makes a follow-up getById call structurally impossible — there is no
    // second .execute() in the markRead body.
    //
    // We mint a FRESH notification (so prior tests' markRead calls don't pre-set read_at),
    // assert it starts unread, then markRead and assert the row is returned with read_at set.
    const created = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        moduleId: "briefings",
        title: "MarkRead round-trip probe",
        metadata: { source: "test" }
      })
    ))!;
    const beforeRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.getById(scopedDb, created.id)
    );
    expect(beforeRead?.read_at).toBeNull();

    const marked = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, created.id)
    );
    expect(marked?.id).toBe(created.id);
    expect(marked?.read_at).toBeInstanceOf(Date);
    expect(marked?.title).toBe("MarkRead round-trip probe");
    expect(marked?.actor_user_id).toBe(ids.userA);
    expect(marked?.recipient_user_id).toBe(ids.userA);

    // Query-count spy on the Kysely executor — proves the single-round-trip contract
    // structurally. Kysely's RawBuilder.execute(executorProvider) calls
    // `executorProvider.getExecutor()` to obtain the executor, then `transformQuery` →
    // `compileQuery` → `executeQuery`. We construct a fake DataContextDb whose db exposes
    // a counting executor: every executeQuery call increments the counter. markRead only
    // invokes `sql...execute(scopedDb.db)` once, so the counter must read exactly 1 after
    // the call (no follow-up getById). assertDataContextDb passes because we attach the
    // brand symbol.
    let executeCount = 0;
    const fakeExecutor = {
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ query: { sql: "FAKE", parameters: [] as unknown[] } }),
      executeQuery: async () => {
        executeCount += 1;
        return { rows: [] as NotificationWithReadState[] };
      },
      withPlugins: () => fakeExecutor
    };
    const countingScopedDb = {
      db: {
        getExecutor: () => fakeExecutor
      },
      [dataContextBrand]: true
    } as unknown as DataContextDb;

    const spyResult = await repository.markRead(countingScopedDb, created.id);
    expect(spyResult).toBeUndefined();
    expect(executeCount).toBe(1);
  });

  it("markRead absent-vs-denied is indistinguishable at the repository layer (Verification 6/repo)", async () => {
    const absentResult = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, nonexistentNotificationId)
    );
    // bPrivate exists but is RLS-invisible to userA (recipient=userB).
    const deniedResult = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.markRead(scopedDb, notificationIds.bPrivate)
    );
    expect(absentResult).toBeUndefined();
    expect(deniedResult).toBeUndefined();
    // No information side-channel: both are deeply equal.
    expect(absentResult).toEqual(deniedResult);
  });

  it("the DB-level metadata CHECK blocks inserts over 4096 bytes (Verification 8)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      // 5000-character single-string value: jsonb::text exceeds 4096 bytes.
      const oversized = JSON.stringify({ overflow: "x".repeat(5000) });
      await expect(
        client.query(
          `
            INSERT INTO app.notifications (id, actor_user_id, recipient_user_id, title, body, metadata)
            VALUES ($1, $2, $3, 'oversized metadata probe', null, $4::jsonb)
          `,
          [randomUUID(), ids.userA, ids.userA, oversized]
        )
      ).rejects.toThrow(/notifications_metadata_size_check/);
    } finally {
      await client.end();
    }
  });

  it("the defense-in-depth SQL comments are present on notifications + notification_reads (Verification 9)", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const tableComments = await client.query<{ obj_description: string }>(
        `
          SELECT obj_description(c.oid) AS obj_description
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('notifications', 'notification_reads')
          ORDER BY c.relname
        `
      );
      expect(tableComments.rows).toHaveLength(2);
      const descriptions = tableComments.rows.map((r) => r.obj_description).join("\n");
      // The notifications comment must mention the actor-scoped invariant.
      expect(descriptions).toContain("actor-scoped");
      // The notification_reads comment must mention the EXISTS defense-in-depth clause.
      expect(descriptions).toContain("EXISTS");
      expect(descriptions).toContain("defense-in-depth");

      // Spot-check one policy comment too: notification_reads_select's comment.
      const policyComments = await client.query<{ description: string }>(
        `
          SELECT pol.polname, pg_catalog.obj_description(pol.oid) AS description
          FROM pg_policy pol
          JOIN pg_class c ON c.oid = pol.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname = 'notification_reads'
            AND pol.polname = 'notification_reads_select'
        `
      );
      expect(policyComments.rows[0]?.description).toContain("defense-in-depth");
    } finally {
      await client.end();
    }
  });

  it("metadata is typed as the bounded NotificationMetadata primitive union (Verification 4/type)", () => {
    // Compile-time guard: a NotificationDto.metadata assignment of an unbounded
    // Record<string, unknown> must fail typecheck. The @ts-expect-error will become
    // unused if the type is silently widened back to Record<string, unknown>.
    const sample: NotificationMetadata = { ok: true, n: 1, s: "x", z: null };
    expect(sample.ok).toBe(true);
    // @ts-expect-error — NotificationMetadata values must be primitive; objects are rejected.
    const badNested: NotificationMetadata = { nested: { leak: true } };
    expect(badNested).toBeDefined();
  });

  it("new notification defaults to urgency 'normal' and deferred_until is null without a port", async () => {
    const n = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, { moduleId: "briefings", title: "Default urgency" })
    ))!;
    expect(n.urgency).toBe("normal");
    expect(n.deferred_until).toBeNull();
  });

  it("urgency 'urgent' bypasses deferral even with active quiet hours", async () => {
    const allDayPort: QuietHoursPort = {
      getSettings: async () => ({ enabled: true, start: "00:00", end: "23:59", timezone: "UTC" }),
      getLocaleTimezone: async () => null
    };
    const repo = new NotificationsRepository(allDayPort);
    const n = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repo.create(scopedDb, {
        moduleId: "briefings",
        title: "Urgent skip deferral",
        urgency: "urgent"
      })
    ))!;
    expect(n.urgency).toBe("urgent");
    expect(n.deferred_until).toBeNull();
  });

  it("normal notification deferred during active quiet hours; hidden from listVisible", async () => {
    // All-day UTC window (00:00–23:59) means now() is always inside quiet hours.
    const allDayPort: QuietHoursPort = {
      getSettings: async () => ({ enabled: true, start: "00:00", end: "23:59", timezone: "UTC" }),
      getLocaleTimezone: async () => null
    };
    const repo = new NotificationsRepository(allDayPort);

    const deferred = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repo.create(scopedDb, { moduleId: "briefings", title: "Deferred normal", urgency: "normal" })
    ))!;
    expect(deferred.deferred_until).toBeInstanceOf(Date);
    // deferred_until must be in the future (end of today's 23:59 UTC window)
    expect(deferred.deferred_until!.getTime()).toBeGreaterThan(Date.now());

    // Must be hidden from listVisible (filter: deferred_until IS NULL OR now() >= deferred_until)
    const byId = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repo.getById(scopedDb, deferred.id)
    );
    expect(byId).toBeUndefined();
  });

  it("locale timezone used as fallback; overnight math correct with real PT offset", async () => {
    // Spec exit criterion: window 22:00-07:00, timezone = null, locale tz = America/Los_Angeles.
    // resolveTimezone must return the locale tz; computeDeferredUntil must release at 07:00 PT
    // (= 15:00 UTC in PST/UTC-8), NOT at 07:00 UTC.
    //
    // Fixed "now" = 2024-01-15T06:00:00Z = 10:00 PM PST Jan 14 — inside the overnight window.
    const localePort: QuietHoursPort = {
      getSettings: async () => ({
        enabled: true,
        start: "22:00",
        end: "07:00",
        timezone: null
      }),
      getLocaleTimezone: async () => "America/Los_Angeles"
    };

    // resolveTimezone: null explicit override → falls back to locale tz
    const resolvedTz = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      resolveTimezone(localePort, scopedDb, null)
    );
    expect(resolvedTz).toBe("America/Los_Angeles");

    // computeDeferredUntil: 22:00-07:00 PT overnight window, now = 22:00 PST Jan 14
    const midWindowNow = new Date("2024-01-15T06:00:00Z"); // 10:00 PM PST Jan 14
    const overnightSettings: QuietHoursSettings = {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: null
    };
    const deferred = computeDeferredUntil(midWindowNow, overnightSettings, resolvedTz);

    expect(deferred).not.toBeNull();
    // 07:00 AM PST (UTC-8) Jan 15 = 15:00 UTC Jan 15
    const expectedRelease = new Date("2024-01-15T15:00:00Z");
    // Allow ±2 min for the iterative UTC-offset correction in computeDeferredUntil
    expect(Math.abs(deferred!.getTime() - expectedRelease.getTime())).toBeLessThan(2 * 60 * 1000);

    // Sanity: if UTC were used instead, release would have been 07:00 UTC = 08 hours earlier
    const wrongUtcRelease = new Date("2024-01-15T07:00:00Z");
    expect(deferred!.getTime()).not.toBeCloseTo(wrongUtcRelease.getTime(), -4);
  });

  it("disabled quiet hours leaves deferred_until null", async () => {
    const disabledPort: QuietHoursPort = {
      getSettings: async () => ({ enabled: false, start: "00:00", end: "23:59", timezone: "UTC" }),
      getLocaleTimezone: async () => null
    };
    const repo = new NotificationsRepository(disabledPort);
    const n = (await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repo.create(scopedDb, { moduleId: "briefings", title: "Disabled quiet hours" })
    ))!;
    expect(n.deferred_until).toBeNull();
  });
});

async function seedNotificationData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE app.users SET is_bootstrap_owner = true WHERE id = $1", [ids.userA]);
    await client.query(
      `
        INSERT INTO app.notifications (
          id,
          actor_user_id,
          recipient_user_id,
          title,
          body,
          metadata
        )
        VALUES
          ($1, $2, $3, 'User A private notification', 'Private for User A', $4::jsonb),
          ($5, $3, $2, 'User B private notification', 'Private for User B', $6::jsonb),
          ($7, $2, $3, 'Seeded notification for User A', 'Seeded recipient-only row for User A', $8::jsonb),
          ($9, $3, $3, 'Projection probe notification', 'Raw metadata in column is deliberately oversized', $10::jsonb)
      `,
      [
        notificationIds.aPrivate,
        ids.userB,
        ids.userA,
        JSON.stringify({ source: "seed", resourceType: "task" }),
        notificationIds.bPrivate,
        JSON.stringify({ source: "seed", resourceType: "note" }),
        notificationIds.aSeed,
        JSON.stringify({ source: "seed" }),
        notificationIds.aProjectionProbe,
        // Deliberately raw, oversized, nested, and oddly-keyed metadata. It fits the DB
        // size CHECK (< 4096 bytes after jsonb::text) but violates every app-layer bound;
        // the OUTPUT projection in serializeNotification MUST strip it down to the bounded
        // shape before this reaches any REST or assistant-tool client.
        //
        // jsonb stores object keys in (length, content) order, NOT insertion order — so the
        // 2-char "good" keys (aa/bb/cc/dd) sort BEFORE the 7-char extraXX keys and survive
        // the 16-key cap, letting us assert the cap behavior deterministically. ee is a
        // 500-char string that the projection must truncate to 256 chars on the way out.
        JSON.stringify({
          aa: "projection-probe",
          bb: 3,
          cc: true,
          dd: null,
          ee: "x".repeat(500),
          // nested object / array → key removed entirely
          nested: { href: "https://example.test", label: "dropped" },
          list: [1, 2, 3],
          // bad key names → dropped
          "has space": "dropped",
          "123numeric": "dropped",
          // 20 extraXX keys → only the first 11 survive (16-key cap after the 5 good keys)
          ...Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`extra${i.toString().padStart(2, "0")}`, i])
          )
        })
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-notifications"
  };
}

function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-notifications"
  };
}
