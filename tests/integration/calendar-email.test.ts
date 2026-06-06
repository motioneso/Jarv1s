import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import {
  AuthSessionResolver,
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { CalendarRepository, calendarModuleManifest } from "@jarv1s/calendar";
import { EmailRepository, emailModuleManifest } from "@jarv1s/email";
import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const connectorAccountIds = {
  aCalendar: "60000000-0000-4000-8000-000000000001",
  aEmail: "60000000-0000-4000-8000-000000000002",
  bCalendar: "60000000-0000-4000-8000-000000000003",
  bEmail: "60000000-0000-4000-8000-000000000004"
} as const;

const calendarEventIds = {
  aPrivate: "61000000-0000-4000-8000-000000000001",
  bPrivate: "61000000-0000-4000-8000-000000000002",
  bWorkspace: "61000000-0000-4000-8000-000000000003"
} as const;

const emailMessageIds = {
  aPrivate: "62000000-0000-4000-8000-000000000001",
  bPrivate: "62000000-0000-4000-8000-000000000002",
  bWorkspace: "62000000-0000-4000-8000-000000000003"
} as const;

describe("Calendar and Email connector-backed read modules", () => {
  let appDb: Kysely<JarvisDatabase>;
  let auth: AuthSessionResolver;
  let dataContext: DataContextRunner;
  let calendarRepository: CalendarRepository;
  let emailRepository: EmailRepository;
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    await seedConnectorBackedReadData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    auth = new AuthSessionResolver(appDb);
    dataContext = new DataContextRunner(appDb);
    calendarRepository = new CalendarRepository();
    emailRepository = new EmailRepository();
    server = createApiServer({
      appDb,
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("applies Calendar and Email migrations with forced RLS and no worker table grant", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });

    await client.connect();
    try {
      const migrations = await client.query<{ version: string; name: string }>(
        `
          SELECT version, name
          FROM app.schema_migrations
          WHERE version IN ('0011', '0012')
          ORDER BY version
        `
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        owner: string;
        worker_can_select: boolean;
      }>(
        `
          SELECT
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity,
            pg_get_userbyid(c.relowner) AS owner,
            has_table_privilege('jarvis_worker_runtime', c.oid, 'SELECT') AS worker_can_select
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('calendar_events', 'email_messages')
          ORDER BY c.relname
        `
      );
      const unsafeColumns = await client.query<{ column_name: string }>(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'app'
            AND table_name IN ('calendar_events', 'email_messages')
            AND column_name IN ('raw_payload', 'encrypted_secret', 'access_token', 'refresh_token')
        `
      );

      expect(migrations.rows).toEqual([
        { version: "0011", name: "0011_calendar_module.sql" },
        { version: "0012", name: "0012_email_module.sql" }
      ]);
      expect(tables.rows).toEqual([
        {
          relname: "calendar_events",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        },
        {
          relname: "email_messages",
          relrowsecurity: true,
          relforcerowsecurity: true,
          owner: "jarvis_migration_owner",
          worker_can_select: false
        }
      ]);
      expect(unsafeColumns.rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("loads Calendar and Email as built-in read modules without queues", () => {
    const manifests = getBuiltInModuleManifests();
    const registrations = getBuiltInModuleRegistrations();
    const calendarRegistration = registrations.find(
      (item) => item.manifest.id === calendarModuleManifest.id
    );
    const emailRegistration = registrations.find(
      (item) => item.manifest.id === emailModuleManifest.id
    );

    expect(manifests.map((item) => item.id)).toEqual([
      "settings",
      "connectors",
      "tasks",
      "notes",
      "notifications",
      "calendar",
      "email",
      "ai",
      "chat",
      "briefings"
    ]);
    expect(calendarModuleManifest.database?.ownedTables).toEqual(["app.calendar_events"]);
    expect(emailModuleManifest.database?.ownedTables).toEqual(["app.email_messages"]);
    expect(calendarModuleManifest.navigation?.[0]).toMatchObject({
      id: "calendar",
      path: "/calendar",
      permissionId: "calendar.view"
    });
    expect(emailModuleManifest.navigation?.[0]).toMatchObject({
      id: "email",
      path: "/email",
      permissionId: "email.view"
    });
    expect(calendarRegistration?.queueDefinitions).toEqual([]);
    expect(emailRegistration?.queueDefinitions).toEqual([]);
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/calendar/sql")
    );
    expect(getBuiltInSqlMigrationDirectories()).toContainEqual(
      expect.stringContaining("packages/email/sql")
    );
  });

  it("denies cached rows when no data context is set", async () => {
    await expect(appDb.selectFrom("app.calendar_events").select("id").execute()).resolves.toEqual(
      []
    );
    await expect(appDb.selectFrom("app.email_messages").select("id").execute()).resolves.toEqual(
      []
    );
  });

  it("creates local cache rows only for connector accounts owned by the active actor", async () => {
    const event = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      calendarRepository.createCachedEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Repository cached event",
        startsAt: "2026-06-07T10:00:00.000Z",
        endsAt: "2026-06-07T11:00:00.000Z",
        externalId: "repo-calendar-event"
      })
    );
    const message = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      emailRepository.createCachedMessageForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aEmail,
        sender: "sender@example.test",
        recipients: ["owner@example.test"],
        subject: "Repository cached message",
        receivedAt: "2026-06-07T12:00:00.000Z",
        externalId: "repo-email-message"
      })
    );

    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        calendarRepository.createCachedEventForTest(scopedDb, {
          connectorAccountId: connectorAccountIds.aEmail,
          title: "Wrong provider event",
          startsAt: "2026-06-07T10:00:00.000Z",
          endsAt: "2026-06-07T11:00:00.000Z",
          externalId: "wrong-provider-event"
        })
      )
    ).rejects.toThrow();
    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: connectorAccountIds.bEmail,
          sender: "sender@example.test",
          subject: "Wrong owner message",
          receivedAt: "2026-06-07T12:00:00.000Z",
          externalId: "wrong-owner-message"
        })
      )
    ).rejects.toThrow();
    expect(event.owner_user_id).toBe(ids.userA);
    expect(message.owner_user_id).toBe(ids.userA);
  });

  it("requires active workspace context for workspace-visible cache rows", async () => {
    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        calendarRepository.createCachedEventForTest(scopedDb, {
          connectorAccountId: connectorAccountIds.aCalendar,
          workspaceId: ids.workspaceAlpha,
          visibility: "workspace",
          title: "Workspace event without active context",
          startsAt: "2026-06-07T13:00:00.000Z",
          endsAt: "2026-06-07T14:00:00.000Z",
          externalId: "workspace-event-without-context"
        })
      )
    ).rejects.toThrow();
    await expect(
      dataContext.withDataContext(userAContext(), (scopedDb) =>
        emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: connectorAccountIds.aEmail,
          workspaceId: ids.workspaceAlpha,
          visibility: "workspace",
          sender: "sender@example.test",
          subject: "Workspace message without active context",
          receivedAt: "2026-06-07T13:30:00.000Z",
          externalId: "workspace-message-without-context"
        })
      )
    ).rejects.toThrow();

    const event = await dataContext.withDataContext(userAContext(ids.workspaceAlpha), (scopedDb) =>
      calendarRepository.createCachedEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        workspaceId: ids.workspaceAlpha,
        visibility: "workspace",
        title: "Workspace event with active context",
        startsAt: "2026-06-07T15:00:00.000Z",
        endsAt: "2026-06-07T16:00:00.000Z",
        externalId: "workspace-event-with-context"
      })
    );
    const message = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) =>
        emailRepository.createCachedMessageForTest(scopedDb, {
          connectorAccountId: connectorAccountIds.aEmail,
          workspaceId: ids.workspaceAlpha,
          visibility: "workspace",
          sender: "sender@example.test",
          subject: "Workspace message with active context",
          receivedAt: "2026-06-07T15:30:00.000Z",
          externalId: "workspace-message-with-context"
        })
    );

    expect(event.workspace_id).toBe(ids.workspaceAlpha);
    expect(message.workspace_id).toBe(ids.workspaceAlpha);
  });

  it("keeps private calendar and email rows hidden from other users and admins", async () => {
    const userEventRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      calendarRepository.getById(scopedDb, calendarEventIds.bPrivate)
    );
    const userMessageRead = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      emailRepository.getById(scopedDb, emailMessageIds.bPrivate)
    );
    const adminContext = await auth.resolveAccessContext(ids.sessionAdmin, "request:admin-cache");
    const adminEventRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      calendarRepository.getById(scopedDb, calendarEventIds.bPrivate)
    );
    const adminMessageRead = await dataContext.withDataContext(adminContext, (scopedDb) =>
      emailRepository.getById(scopedDb, emailMessageIds.bPrivate)
    );

    expect(userEventRead).toBeUndefined();
    expect(userMessageRead).toBeUndefined();
    expect(adminEventRead).toBeUndefined();
    expect(adminMessageRead).toBeUndefined();
  });

  it("shows workspace rows only with active joined workspace context", async () => {
    const eventWithoutWorkspace = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      calendarRepository.getById(scopedDb, calendarEventIds.bWorkspace)
    );
    const messageWithoutWorkspace = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      emailRepository.getById(scopedDb, emailMessageIds.bWorkspace)
    );
    const eventWithWorkspace = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) => calendarRepository.getById(scopedDb, calendarEventIds.bWorkspace)
    );
    const messageWithWorkspace = await dataContext.withDataContext(
      userAContext(ids.workspaceAlpha),
      (scopedDb) => emailRepository.getById(scopedDb, emailMessageIds.bWorkspace)
    );

    expect(eventWithoutWorkspace).toBeUndefined();
    expect(messageWithoutWorkspace).toBeUndefined();
    expect(eventWithWorkspace?.id).toBe(calendarEventIds.bWorkspace);
    expect(messageWithWorkspace?.id).toBe(emailMessageIds.bWorkspace);
  });

  it("serves read-only Calendar and Email APIs from session and workspace context", async () => {
    const deniedCalendarResponse = await server.inject({
      method: "GET",
      url: "/api/calendar/events"
    });
    const calendarListResponse = await server.inject({
      method: "GET",
      url: "/api/calendar/events",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const calendarWorkspaceListResponse = await server.inject({
      method: "GET",
      url: "/api/calendar/events",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });
    const calendarWorkspaceReadResponse = await server.inject({
      method: "GET",
      url: `/api/calendar/events/${calendarEventIds.bWorkspace}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });
    const hiddenCalendarReadResponse = await server.inject({
      method: "GET",
      url: `/api/calendar/events/${calendarEventIds.bPrivate}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const emailListResponse = await server.inject({
      method: "GET",
      url: "/api/email/messages",
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });
    const emailWorkspaceListResponse = await server.inject({
      method: "GET",
      url: "/api/email/messages",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });
    const emailWorkspaceReadResponse = await server.inject({
      method: "GET",
      url: `/api/email/messages/${emailMessageIds.bWorkspace}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "x-jarvis-workspace-id": ids.workspaceAlpha
      }
    });
    const hiddenEmailReadResponse = await server.inject({
      method: "GET",
      url: `/api/email/messages/${emailMessageIds.bPrivate}`,
      headers: {
        authorization: `Bearer ${ids.sessionA}`
      }
    });

    expect(deniedCalendarResponse.statusCode).toBe(401);
    expect(calendarListResponse.statusCode).toBe(200);
    expect(calendarWorkspaceListResponse.statusCode).toBe(200);
    expect(calendarWorkspaceReadResponse.statusCode).toBe(200);
    expect(hiddenCalendarReadResponse.statusCode).toBe(404);
    expect(
      calendarListResponse
        .json<{ events: Array<{ id: string }> }>()
        .events.some((event) => event.id === calendarEventIds.bWorkspace)
    ).toBe(false);
    expect(
      calendarWorkspaceListResponse
        .json<{ events: Array<{ id: string }> }>()
        .events.some((event) => event.id === calendarEventIds.bWorkspace)
    ).toBe(true);
    expect(emailListResponse.statusCode).toBe(200);
    expect(emailWorkspaceListResponse.statusCode).toBe(200);
    expect(emailWorkspaceReadResponse.statusCode).toBe(200);
    expect(hiddenEmailReadResponse.statusCode).toBe(404);
    expect(
      emailListResponse
        .json<{ messages: Array<{ id: string }> }>()
        .messages.some((message) => message.id === emailMessageIds.bWorkspace)
    ).toBe(false);
    expect(
      emailWorkspaceListResponse
        .json<{ messages: Array<{ id: string }> }>()
        .messages.some((message) => message.id === emailMessageIds.bWorkspace)
    ).toBe(true);
    expect(calendarWorkspaceReadResponse.body).not.toContain("encrypted_secret");
    expect(emailWorkspaceReadResponse.body).not.toContain("encrypted_secret");
  });

  it("fails loudly when repositories are called without withDataContext", async () => {
    await expect(calendarRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(emailRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});

async function seedConnectorBackedReadData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO app.connector_accounts (
          id,
          provider_id,
          owner_user_id,
          scopes,
          status,
          encrypted_secret
        )
        VALUES
          ($1, 'google-calendar', $2, ARRAY['calendar.readonly']::text[], 'active', '{}'::jsonb),
          ($3, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'active', '{}'::jsonb),
          ($4, 'microsoft-calendar', $5, ARRAY['Calendars.Read']::text[], 'active', '{}'::jsonb),
          ($6, 'microsoft-email', $5, ARRAY['Mail.Read']::text[], 'active', '{}'::jsonb)
      `,
      [
        connectorAccountIds.aCalendar,
        ids.userA,
        connectorAccountIds.aEmail,
        connectorAccountIds.bCalendar,
        ids.userB,
        connectorAccountIds.bEmail
      ]
    );
    await client.query(
      `
        INSERT INTO app.calendar_events (
          id,
          connector_account_id,
          owner_user_id,
          workspace_id,
          visibility,
          title,
          starts_at,
          ends_at,
          location,
          summary,
          body_excerpt,
          external_id,
          external_metadata
        )
        VALUES
          (
            $1,
            $2,
            $3,
            null,
            'private',
            'User A private event',
            '2026-06-08T09:00:00.000Z',
            '2026-06-08T10:00:00.000Z',
            'Desk',
            'A private summary',
            'A private excerpt',
            'event-a-private',
            '{"source":"seed"}'::jsonb
          ),
          (
            $4,
            $5,
            $6,
            null,
            'private',
            'User B private event',
            '2026-06-08T11:00:00.000Z',
            '2026-06-08T12:00:00.000Z',
            'Room B',
            'B private summary',
            'B private excerpt',
            'event-b-private',
            '{"source":"seed"}'::jsonb
          ),
          (
            $7,
            $5,
            $6,
            $8,
            'workspace',
            'Workspace planning event',
            '2026-06-08T13:00:00.000Z',
            '2026-06-08T14:00:00.000Z',
            'Alpha room',
            'Workspace summary',
            'Workspace excerpt',
            'event-b-workspace',
            '{"source":"seed"}'::jsonb
          )
      `,
      [
        calendarEventIds.aPrivate,
        connectorAccountIds.aCalendar,
        ids.userA,
        calendarEventIds.bPrivate,
        connectorAccountIds.bCalendar,
        ids.userB,
        calendarEventIds.bWorkspace,
        ids.workspaceAlpha
      ]
    );
    await client.query(
      `
        INSERT INTO app.email_messages (
          id,
          connector_account_id,
          owner_user_id,
          workspace_id,
          visibility,
          sender,
          recipients,
          subject,
          snippet,
          body_excerpt,
          received_at,
          external_id,
          external_metadata
        )
        VALUES
          (
            $1,
            $2,
            $3,
            null,
            'private',
            'sender-a@example.test',
            ARRAY['user-a@example.test']::text[],
            'User A private message',
            'A private snippet',
            'A private excerpt',
            '2026-06-08T09:30:00.000Z',
            'message-a-private',
            '{"source":"seed"}'::jsonb
          ),
          (
            $4,
            $5,
            $6,
            null,
            'private',
            'sender-b@example.test',
            ARRAY['user-b@example.test']::text[],
            'User B private message',
            'B private snippet',
            'B private excerpt',
            '2026-06-08T10:30:00.000Z',
            'message-b-private',
            '{"source":"seed"}'::jsonb
          ),
          (
            $7,
            $5,
            $6,
            $8,
            'workspace',
            'team@example.test',
            ARRAY['alpha@example.test']::text[],
            'Workspace planning message',
            'Workspace snippet',
            'Workspace excerpt',
            '2026-06-08T11:30:00.000Z',
            'message-b-workspace',
            '{"source":"seed"}'::jsonb
          )
      `,
      [
        emailMessageIds.aPrivate,
        connectorAccountIds.aEmail,
        ids.userA,
        emailMessageIds.bPrivate,
        connectorAccountIds.bEmail,
        ids.userB,
        emailMessageIds.bWorkspace,
        ids.workspaceAlpha
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

function userAContext(workspaceId?: string): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId,
    requestId: "request:user-a-calendar-email"
  };
}
