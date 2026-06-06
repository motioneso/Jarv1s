import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { AiRepository } from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { EmailRepository } from "@jarv1s/email";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import { NotesRepository } from "@jarv1s/notes";
import { NotificationsRepository } from "@jarv1s/notifications";
import { TasksRepository } from "@jarv1s/tasks";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const taskIds = {
  aPrivate: "71000000-0000-4000-8000-000000000001",
  bPrivate: "71000000-0000-4000-8000-000000000002",
  bGrantedToA: "71000000-0000-4000-8000-000000000003",
  bWorkspace: "71000000-0000-4000-8000-000000000004"
} as const;

const noteIds = {
  aPrivate: "72000000-0000-4000-8000-000000000001",
  bPrivate: "72000000-0000-4000-8000-000000000002",
  bGrantedToA: "72000000-0000-4000-8000-000000000003",
  bWorkspace: "72000000-0000-4000-8000-000000000004"
} as const;

const notificationIds = {
  aPrivate: "73000000-0000-4000-8000-000000000001",
  bPrivate: "73000000-0000-4000-8000-000000000002",
  workspace: "73000000-0000-4000-8000-000000000003"
} as const;

const connectorAccountIds = {
  aCalendar: "74000000-0000-4000-8000-000000000001",
  aEmail: "74000000-0000-4000-8000-000000000002",
  bCalendar: "74000000-0000-4000-8000-000000000003",
  bEmail: "74000000-0000-4000-8000-000000000004"
} as const;

const calendarEventIds = {
  aPrivate: "75000000-0000-4000-8000-000000000001",
  bPrivate: "75000000-0000-4000-8000-000000000002",
  workspace: "75000000-0000-4000-8000-000000000003"
} as const;

const emailMessageIds = {
  aPrivate: "76000000-0000-4000-8000-000000000001",
  bPrivate: "76000000-0000-4000-8000-000000000002",
  workspace: "76000000-0000-4000-8000-000000000003"
} as const;

interface InvocationResponse {
  readonly invocation: {
    readonly moduleId: string;
    readonly moduleName: string;
    readonly name: string;
    readonly permissionId: string;
    readonly risk: "read" | "write" | "destructive";
    readonly status: "succeeded" | "blocked";
    readonly blockedReason: string | null;
    readonly actionRequestId: string | null;
    readonly result: Record<string, unknown> | null;
  };
}

interface AssistantActionResponse {
  readonly action: {
    readonly id: string;
    readonly workspaceId: string | null;
    readonly toolName: string;
    readonly permissionId: string;
    readonly risk: "write" | "destructive";
    readonly status: "pending" | "confirmed" | "rejected" | "cancelled";
    readonly inputSummary: {
      readonly inputKeys?: readonly string[];
      readonly inputKeyCount?: number;
    };
    readonly requestedAt: string;
    readonly resolvedAt: string | null;
  };
}

interface AssistantActionsResponse {
  readonly actions: readonly AssistantActionResponse["action"][];
}

describe("AI read-only assistant tool execution foundation", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let tasksRepository: TasksRepository;
  let aiRepository: AiRepository;
  let notesRepository: NotesRepository;
  let notificationsRepository: NotificationsRepository;
  let calendarRepository: CalendarRepository;
  let emailRepository: EmailRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-tools-secret-key";

    await resetFoundationDatabase();
    await seedAssistantToolData();

    appDb = createDatabase({
      connectionString: connectionStrings.app,
      maxConnections: 1
    });
    dataContext = new DataContextRunner(appDb);
    aiRepository = new AiRepository();
    tasksRepository = new TasksRepository();
    notesRepository = new NotesRepository();
    notificationsRepository = new NotificationsRepository();
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
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  it("lists assistant tools from module manifests without execution data", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: userAHeaders()
    });
    const tools = response.json<{
      tools: Array<{
        moduleId: string;
        moduleName: string;
        name: string;
        permissionId: string;
        risk: string;
      }>;
    }>().tools;
    const manifestTools = getBuiltInModuleManifests().flatMap((module) =>
      (module.assistantTools ?? []).map((tool) => `${module.id}:${tool.name}`)
    );

    expect(response.statusCode).toBe(200);
    expect(tools.map((tool) => `${tool.moduleId}:${tool.name}`)).toEqual(manifestTools);
    expect(tools).toContainEqual(
      expect.objectContaining({
        moduleId: "tasks",
        moduleName: "Tasks",
        name: "tasks.updateStatus",
        permissionId: "tasks.update",
        risk: "write"
      })
    );
    expect(response.body).not.toContain('status":"succeeded');
    expect(response.body).not.toContain("encrypted_credential");
    expect(response.body).not.toContain("ciphertext");
  });

  it("executes declared read tools through RLS-scoped module repositories", async () => {
    const tasks = await invokeTool("tasks.listVisible");
    const notes = await invokeTool("notes.listVisible");
    const notifications = await invokeTool("notifications.listVisible");
    const calendar = await invokeTool("calendar.listVisibleEvents");
    const email = await invokeTool("email.listVisibleMessages");
    const workspaceTasks = await invokeTool("tasks.listVisible", userAWorkspaceHeaders());
    const workspaceNotes = await invokeTool("notes.listVisible", userAWorkspaceHeaders());
    const workspaceNotifications = await invokeTool(
      "notifications.listVisible",
      userAWorkspaceHeaders()
    );
    const workspaceCalendar = await invokeTool(
      "calendar.listVisibleEvents",
      userAWorkspaceHeaders()
    );
    const workspaceEmail = await invokeTool("email.listVisibleMessages", userAWorkspaceHeaders());

    expect(readIds(tasks.result, "tasks")).toEqual([taskIds.aPrivate, taskIds.bGrantedToA]);
    expect(readIds(notes.result, "notes")).toEqual([noteIds.aPrivate, noteIds.bGrantedToA]);
    expect(readIds(notifications.result, "notifications")).toEqual([notificationIds.aPrivate]);
    expect(readIds(calendar.result, "events")).toEqual([calendarEventIds.aPrivate]);
    expect(readIds(email.result, "messages")).toEqual([emailMessageIds.aPrivate]);
    // Tasks are owner-or-share only now (not workspace-scoped): the workspace context
    // returns the same set as the personal context, and the workspace-only task stays hidden.
    expect(readIds(workspaceTasks.result, "tasks")).toEqual([
      taskIds.aPrivate,
      taskIds.bGrantedToA
    ]);
    expect(readIds(workspaceTasks.result, "tasks")).not.toContain(taskIds.bWorkspace);
    expect(readIds(workspaceNotes.result, "notes")).toContain(noteIds.bWorkspace);
    expect(readIds(workspaceNotifications.result, "notifications")).toContain(
      notificationIds.workspace
    );
    // Calendar and email are now owner-or-share (not workspace-scoped): userA does
    // not own the workspace row and has no share, so it stays hidden.
    expect(readIds(workspaceCalendar.result, "events")).not.toContain(calendarEventIds.workspace);
    expect(readIds(workspaceEmail.result, "messages")).not.toContain(emailMessageIds.workspace);
    expect(JSON.stringify(tasks.result)).not.toContain("User B private task");
    expect(JSON.stringify(notes.result)).not.toContain("User B private note");
    expect(JSON.stringify(notifications.result)).not.toContain("User B private notification");
    expect(JSON.stringify(calendar.result)).not.toContain("User B private event");
    expect(JSON.stringify(email.result)).not.toContain("User B private message");
  });

  it("does not give instance admins a private-data bypass through assistant tools", async () => {
    const tasks = await invokeTool("tasks.listVisible", adminHeaders());
    const notes = await invokeTool("notes.listVisible", adminHeaders());
    const notifications = await invokeTool("notifications.listVisible", adminHeaders());
    const calendar = await invokeTool("calendar.listVisibleEvents", adminHeaders());
    const email = await invokeTool("email.listVisibleMessages", adminHeaders());
    const combined = JSON.stringify([
      tasks.result,
      notes.result,
      notifications.result,
      calendar.result,
      email.result
    ]);

    expect(readIds(tasks.result, "tasks")).toEqual([]);
    expect(readIds(notes.result, "notes")).toEqual([]);
    expect(readIds(notifications.result, "notifications")).toEqual([]);
    expect(readIds(calendar.result, "events")).toEqual([]);
    expect(readIds(email.result, "messages")).toEqual([]);
    expect(combined).not.toContain("User B private");
    expect(combined).not.toContain("Private for User B");
  });

  it("creates pending confirmation records for non-read tools without mutating tasks or enqueueing jobs", async () => {
    const jobsBefore = await countPgBossJobs();
    const unknownResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/tasks.deleteEverything/invoke",
      headers: userAHeaders(),
      payload: {
        input: {}
      }
    });
    const writeResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/tasks.updateStatus/invoke",
      headers: userAHeaders(),
      payload: {
        input: {
          taskId: taskIds.aPrivate,
          status: "done"
        }
      }
    });
    const jobsAfter = await countPgBossJobs();
    const task = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      tasksRepository.getById(scopedDb, taskIds.aPrivate)
    );
    const blocked = writeResponse.json<InvocationResponse>().invocation;
    const actionsResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-actions",
      headers: userAHeaders()
    });
    expect(actionsResponse.statusCode).toBe(200);

    const action = actionsResponse
      .json<AssistantActionsResponse>()
      .actions.find((item) => item.id === blocked.actionRequestId);

    expect(unknownResponse.statusCode).toBe(404);
    expect(unknownResponse.json()).toEqual({ error: "Assistant tool is not declared" });
    expect(writeResponse.statusCode).toBe(403);
    expect(blocked).toMatchObject({
      moduleId: "tasks",
      name: "tasks.updateStatus",
      permissionId: "tasks.update",
      risk: "write",
      status: "blocked",
      blockedReason: "confirmation_required",
      result: null
    });
    expect(blocked.actionRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(action).toMatchObject({
      workspaceId: null,
      toolName: "tasks.updateStatus",
      permissionId: "tasks.update",
      risk: "write",
      status: "pending",
      inputSummary: {
        inputKeys: ["status", "taskId"],
        inputKeyCount: 2
      },
      resolvedAt: null
    });
    expect(JSON.stringify(action)).not.toContain(taskIds.aPrivate);
    expect(JSON.stringify(action)).not.toContain("done");
    expect(JSON.stringify(action)).not.toContain("User A assistant task");
    expect(task?.status).toBe("todo");
    expect(jobsAfter).toBe(jobsBefore);
  });

  it("resolves pending assistant action confirmations as audit state only", async () => {
    const jobsBefore = await countPgBossJobs();
    const writeResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/tasks.updateStatus/invoke",
      headers: userAWorkspaceHeaders(),
      payload: {
        input: {
          taskId: taskIds.bWorkspace,
          status: "done"
        }
      }
    });
    const actionRequestId = writeResponse.json<InvocationResponse>().invocation.actionRequestId;

    expect(actionRequestId).toBeTruthy();

    const resolveResponse = await server.inject({
      method: "POST",
      url: `/api/ai/assistant-actions/${actionRequestId}/resolve`,
      headers: userAWorkspaceHeaders(),
      payload: {
        status: "confirmed"
      }
    });
    const resolved = resolveResponse.json<AssistantActionResponse>().action;
    const task = await dataContext.withDataContext(userBContext(ids.workspaceAlpha), (scopedDb) =>
      tasksRepository.getById(scopedDb, taskIds.bWorkspace)
    );
    const jobsAfter = await countPgBossJobs();

    expect(writeResponse.statusCode).toBe(403);
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolved).toMatchObject({
      id: actionRequestId,
      workspaceId: ids.workspaceAlpha,
      toolName: "tasks.updateStatus",
      risk: "write",
      status: "confirmed"
    });
    expect(resolved.resolvedAt).toBeTruthy();
    expect(task?.status).toBe("todo");
    expect(jobsAfter).toBe(jobsBefore);
  });

  it("does not give other users or admins a private assistant action bypass", async () => {
    const writeResponse = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/tasks.updateStatus/invoke",
      headers: userAHeaders(),
      payload: {
        input: {
          taskId: taskIds.aPrivate,
          status: "done"
        }
      }
    });
    const actionRequestId = writeResponse.json<InvocationResponse>().invocation.actionRequestId;
    const userBResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-actions",
      headers: userBHeaders()
    });
    const adminResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-actions",
      headers: adminHeaders()
    });

    expect(userBResponse.statusCode).toBe(200);
    expect(adminResponse.statusCode).toBe(200);
    expect(userBResponse.json<AssistantActionsResponse>().actions).not.toContainEqual(
      expect.objectContaining({ id: actionRequestId })
    );
    expect(adminResponse.json<AssistantActionsResponse>().actions).not.toContainEqual(
      expect.objectContaining({ id: actionRequestId })
    );
    expect(userBResponse.body).not.toContain(taskIds.aPrivate);
    expect(adminResponse.body).not.toContain(taskIds.aPrivate);
  });

  it("does not create assistant action records for read-only tool invocations", async () => {
    const beforeResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-actions",
      headers: userAHeaders()
    });
    const readInvocation = await invokeTool("tasks.listVisible");
    const afterResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-actions",
      headers: userAHeaders()
    });

    expect(beforeResponse.statusCode).toBe(200);
    expect(afterResponse.statusCode).toBe(200);
    expect(readInvocation.actionRequestId).toBeNull();
    expect(afterResponse.json<AssistantActionsResponse>().actions.length).toBe(
      beforeResponse.json<AssistantActionsResponse>().actions.length
    );
  });

  it("does not return AI credentials, connector secrets, ciphertext, or pg-boss payload data", async () => {
    const providerResponse = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: userAHeaders(),
      payload: {
        providerKind: "custom",
        displayName: "Tool Secret Provider",
        credentialPayload: {
          apiKey: "assistant-tool-secret-api-key"
        }
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/email.listVisibleMessages/invoke",
      headers: userAWorkspaceHeaders(),
      payload: {
        input: {}
      }
    });

    expect(providerResponse.statusCode).toBe(201);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("assistant-tool-secret-api-key");
    expect(response.body).not.toContain("hidden-connector-ciphertext");
    expect(response.body).not.toContain("encrypted_credential");
    expect(response.body).not.toContain("encrypted_secret");
    expect(response.body).not.toContain("ciphertext");
    expect(response.body).not.toContain("pgboss");
  });

  it("keeps assistant tools queue-free and repository access DataContext-only", async () => {
    expect(getAllQueueDefinitions().map((queue) => queue.name)).toEqual([
      "rls-probe",
      "tasks-deferred-status",
      "briefings-run"
    ]);
    await expect(tasksRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(notesRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(notificationsRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(calendarRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(emailRepository.listVisible({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
    await expect(aiRepository.listAssistantActions({} as never)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  async function invokeTool(
    toolName: string,
    headers: Record<string, string> = userAHeaders()
  ): Promise<InvocationResponse["invocation"]> {
    const response = await server.inject({
      method: "POST",
      url: `/api/ai/assistant-tools/${toolName}/invoke`,
      headers,
      payload: {
        input: {}
      }
    });

    expect(response.statusCode).toBe(200);

    const invocation = response.json<InvocationResponse>().invocation;

    expect(invocation).toMatchObject({
      name: toolName,
      risk: "read",
      status: "succeeded",
      blockedReason: null
    });

    return invocation;
  }
});

async function seedAssistantToolData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await seedTasks(client);
    await seedNotes(client);
    await seedNotifications(client);
    await seedConnectorBackedRows(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function seedTasks(client: pg.Client): Promise<void> {
  await client.query(
    `
      INSERT INTO app.tasks (id, owner_user_id, workspace_id, visibility, title, description, status)
      VALUES
        ($1, $2, null, 'private', 'User A assistant task', 'A assistant description', 'todo'),
        ($3, $4, null, 'private', 'User B private task', 'B private description', 'todo'),
        ($5, $4, null, 'private', 'User B granted assistant task', 'B granted description', 'todo'),
        ($6, $4, $7, 'workspace', 'User B workspace assistant task', 'B workspace description', 'todo')
    `,
    [
      taskIds.aPrivate,
      ids.userA,
      taskIds.bPrivate,
      ids.userB,
      taskIds.bGrantedToA,
      taskIds.bWorkspace,
      ids.workspaceAlpha
    ]
  );
  await client.query(
    `
      INSERT INTO app.shares (resource_type, resource_id, owner_user_id, grantee_user_id, level)
      VALUES ('task', $1, $2, $3, 'view')
    `,
    [taskIds.bGrantedToA, ids.userB, ids.userA]
  );
}

async function seedNotes(client: pg.Client): Promise<void> {
  await client.query(
    `
      INSERT INTO app.notes (id, owner_user_id, workspace_id, visibility, title, body)
      VALUES
        ($1, $2, null, 'private', 'User A assistant note', 'A assistant body'),
        ($3, $4, null, 'private', 'User B private note', 'B private body'),
        ($5, $4, null, 'private', 'User B granted assistant note', 'B granted body'),
        ($6, $4, $7, 'workspace', 'User B workspace assistant note', 'B workspace body')
    `,
    [
      noteIds.aPrivate,
      ids.userA,
      noteIds.bPrivate,
      ids.userB,
      noteIds.bGrantedToA,
      noteIds.bWorkspace,
      ids.workspaceAlpha
    ]
  );
  await client.query(
    `
      INSERT INTO app.resource_grants (resource_type, resource_id, grantee_user_id, grant_level)
      VALUES ('note', $1, $2, 'view')
    `,
    [noteIds.bGrantedToA, ids.userA]
  );
}

async function seedNotifications(client: pg.Client): Promise<void> {
  await client.query(
    `
      INSERT INTO app.notifications (
        id,
        actor_user_id,
        recipient_user_id,
        workspace_id,
        visibility,
        title,
        body,
        metadata
      )
      VALUES
        ($1, $4, $2, null, 'private', 'User A assistant notification', 'Private for User A', $3::jsonb),
        ($5, $2, $4, null, 'private', 'User B private notification', 'Private for User B', $6::jsonb),
        ($7, $4, null, $8, 'workspace', 'Workspace assistant notification', 'Workspace visible summary', $9::jsonb)
    `,
    [
      notificationIds.aPrivate,
      ids.userA,
      JSON.stringify({ source: "assistant-tools-test" }),
      ids.userB,
      notificationIds.bPrivate,
      JSON.stringify({ source: "assistant-tools-test" }),
      notificationIds.workspace,
      ids.workspaceAlpha,
      JSON.stringify({ source: "assistant-tools-test", workspaceScoped: true })
    ]
  );
}

async function seedConnectorBackedRows(client: pg.Client): Promise<void> {
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
        ($1, 'google-calendar', $2, ARRAY['calendar.readonly']::text[], 'active', '{"ciphertext":"hidden-connector-ciphertext"}'::jsonb),
        ($3, 'google-email', $2, ARRAY['gmail.readonly']::text[], 'active', '{"ciphertext":"hidden-connector-ciphertext"}'::jsonb),
        ($4, 'microsoft-calendar', $5, ARRAY['Calendars.Read']::text[], 'active', '{"ciphertext":"hidden-connector-ciphertext"}'::jsonb),
        ($6, 'microsoft-email', $5, ARRAY['Mail.Read']::text[], 'active', '{"ciphertext":"hidden-connector-ciphertext"}'::jsonb)
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
        ($1, $2, $3, null, 'private', 'User A assistant event', '2026-06-09T09:00:00.000Z', '2026-06-09T10:00:00.000Z', 'Desk', 'A summary', 'A excerpt', 'event-a-assistant', '{"source":"assistant-tools-test"}'::jsonb),
        ($4, $5, $6, null, 'private', 'User B private event', '2026-06-09T11:00:00.000Z', '2026-06-09T12:00:00.000Z', 'Room B', 'B summary', 'B excerpt', 'event-b-private', '{"source":"assistant-tools-test"}'::jsonb),
        ($7, $5, $6, $8, 'workspace', 'Workspace assistant event', '2026-06-09T13:00:00.000Z', '2026-06-09T14:00:00.000Z', 'Alpha room', 'Workspace summary', 'Workspace excerpt', 'event-workspace-assistant', '{"source":"assistant-tools-test"}'::jsonb)
    `,
    [
      calendarEventIds.aPrivate,
      connectorAccountIds.aCalendar,
      ids.userA,
      calendarEventIds.bPrivate,
      connectorAccountIds.bCalendar,
      ids.userB,
      calendarEventIds.workspace,
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
        ($1, $2, $3, null, 'private', 'sender-a@example.test', ARRAY['user-a@example.test']::text[], 'User A assistant message', 'A snippet', 'A excerpt', '2026-06-09T09:30:00.000Z', 'message-a-assistant', '{"source":"assistant-tools-test"}'::jsonb),
        ($4, $5, $6, null, 'private', 'sender-b@example.test', ARRAY['user-b@example.test']::text[], 'User B private message', 'B snippet', 'B excerpt', '2026-06-09T10:30:00.000Z', 'message-b-private', '{"source":"assistant-tools-test"}'::jsonb),
        ($7, $5, $6, $8, 'workspace', 'team@example.test', ARRAY['alpha@example.test']::text[], 'Workspace assistant message', 'Workspace snippet', 'Workspace excerpt', '2026-06-09T11:30:00.000Z', 'message-workspace-assistant', '{"source":"assistant-tools-test"}'::jsonb)
    `,
    [
      emailMessageIds.aPrivate,
      connectorAccountIds.aEmail,
      ids.userA,
      emailMessageIds.bPrivate,
      connectorAccountIds.bEmail,
      ids.userB,
      emailMessageIds.workspace,
      ids.workspaceAlpha
    ]
  );
}

async function countPgBossJobs(): Promise<number> {
  const client = new Client({ connectionString: connectionStrings.migration });

  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM pgboss.job"
    );

    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

function userAHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionA}`
  };
}

function userAWorkspaceHeaders(): Record<string, string> {
  return {
    ...userAHeaders(),
    "x-jarvis-workspace-id": ids.workspaceAlpha
  };
}

function userBHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionB}`
  };
}

function adminHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${ids.sessionAdmin}`
  };
}

function userAContext(workspaceId?: string | null): AccessContext {
  return {
    actorUserId: ids.userA,
    workspaceId: workspaceId ?? null,
    requestId: "request:user-a-ai-tools"
  };
}

function userBContext(workspaceId?: string | null): AccessContext {
  return {
    actorUserId: ids.userB,
    workspaceId: workspaceId ?? null,
    requestId: "request:user-b-ai-tools"
  };
}

function readIds(result: Record<string, unknown> | null, key: string): string[] {
  const items = result?.[key];

  if (!Array.isArray(items)) {
    throw new Error(`Expected ${key} array in assistant tool result`);
  }

  return items.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") {
      throw new Error(`Expected ${key} item with id`);
    }

    return (item as { id: string }).id;
  });
}
