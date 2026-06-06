import type { Page, Route } from "@playwright/test";
import type {
  AiAssistantToolDto,
  AiConfiguredModelDto,
  AiModelCapability,
  AiProviderConfigDto,
  CalendarEventDto,
  ChatMessageDto,
  ChatThreadDto,
  ConnectorAccountDto,
  ConnectorProviderDto,
  CreateAiConfiguredModelRequest,
  CreateAiProviderConfigRequest,
  CreateConnectorAccountRequest,
  CreateNoteRequest,
  CreateTaskRequest,
  EmailMessageDto,
  MeResponse,
  NoteDto,
  NotificationDto,
  TaskDto,
  UpdateAiConfiguredModelRequest,
  UpdateAiProviderConfigRequest,
  UpdateConnectorAccountRequest,
  UpdateNoteRequest,
  UpdateTaskRequest
} from "@jarv1s/shared";

import { registerMockBriefingsRoutes, type MockBriefingsApiState } from "./mock-briefings-api.js";
import { registerMockChatRoutes } from "./mock-chat-api.js";
import { modulesResponse } from "./mock-modules.js";

export { createMockBriefingDefinition, createMockBriefingRun } from "./mock-briefings-api.js";

export interface MockApiState extends MockBriefingsApiState {
  authenticated: boolean;
  aiModels?: AiConfiguredModelDto[];
  aiProviders?: AiProviderConfigDto[];
  calendarEvents?: CalendarEventDto[];
  chatMessages?: Record<string, ChatMessageDto[]>;
  chatThreads?: ChatThreadDto[];
  connectorAccounts: ConnectorAccountDto[];
  connectorProviders: ConnectorProviderDto[];
  emailMessages?: EmailMessageDto[];
  notes: NoteDto[];
  notifications: NotificationDto[];
  tasks: TaskDto[];
}

const meResponse: MeResponse = {
  user: {
    id: "user-1",
    email: "owner@example.test",
    name: "Owner User",
    isInstanceAdmin: true,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  },
  memberships: [
    {
      userId: "user-1",
      workspaceId: "workspace-1",
      role: "owner",
      createdAt: "2026-06-06T12:00:00.000Z"
    }
  ],
  workspaces: [
    {
      id: "workspace-1",
      name: "Personal",
      createdByUserId: "user-1",
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }
  ],
  activeWorkspaceId: "workspace-1"
};

export async function mockApi(page: Page, state: MockApiState): Promise<void> {
  await page.route("**/api/bootstrap/status", (route) =>
    fulfillJson(route, 200, { needsBootstrap: false, userCount: state.authenticated ? 1 : 0 })
  );
  await page.route("**/api/auth/sign-in/email", (route) => {
    state.authenticated = true;
    return fulfillJson(route, 200, { user: meResponse.user });
  });
  await page.route("**/api/auth/sign-up/email", (route) => {
    state.authenticated = true;
    return fulfillJson(route, 200, { user: meResponse.user });
  });
  await page.route("**/api/auth/sign-out", (route) => {
    state.authenticated = false;
    return fulfillJson(route, 200, {});
  });
  await page.route("**/api/me", (route) =>
    state.authenticated
      ? fulfillJson(route, 200, meResponse)
      : fulfillJson(route, 401, { error: "Session is missing or expired" })
  );
  await page.route("**/api/modules", (route) =>
    state.authenticated
      ? fulfillJson(route, 200, modulesResponse)
      : fulfillJson(route, 401, { error: "Session is missing or expired" })
  );
  await page.route("**/api/admin/auth/providers", (route) =>
    fulfillJson(route, 200, {
      providers: [
        {
          id: "email-password",
          displayName: "Email and password",
          providerType: "local",
          enabled: true
        }
      ]
    })
  );
  await page.route("**/api/admin/workspaces", (route) =>
    fulfillJson(route, 200, { workspaces: meResponse.workspaces })
  );
  await page.route("**/api/admin/connectors/accounts", (route) =>
    fulfillJson(route, 200, { accounts: state.connectorAccounts })
  );
  await page.route("**/api/connectors/providers", (route) =>
    fulfillJson(route, 200, { providers: state.connectorProviders })
  );
  await page.route(/\/api\/connectors\/accounts\/[^/]+\/revoke$/, (route) =>
    handleConnectorRevokeRoute(route, state)
  );
  await page.route(/\/api\/connectors\/accounts\/[^/]+$/, (route) =>
    handleConnectorDetailRoute(route, state)
  );
  await page.route("**/api/connectors/accounts", (route) =>
    handleConnectorAccountsRoute(route, state)
  );
  await page.route(/\/api\/ai\/providers\/[^/]+\/revoke$/, (route) =>
    handleAiProviderRevokeRoute(route, state)
  );
  await page.route(/\/api\/ai\/providers\/[^/]+$/, (route) =>
    handleAiProviderDetailRoute(route, state)
  );
  await page.route("**/api/ai/providers", (route) => handleAiProvidersRoute(route, state));
  await page.route(/\/api\/ai\/models\/[^/]+$/, (route) => handleAiModelDetailRoute(route, state));
  await page.route("**/api/ai/models", (route) => handleAiModelsRoute(route, state));
  await page.route(/\/api\/ai\/capability-route\/[^/]+$/, (route) =>
    handleAiCapabilityRoute(route, state)
  );
  await page.route("**/api/ai/assistant-tools", (route) =>
    fulfillJson(route, 200, { tools: createMockAiAssistantTools() })
  );
  await registerMockBriefingsRoutes(page, state);
  await registerMockChatRoutes(page, state);
  await page.route(/\/api\/calendar\/events\/[^/]+$/, (route) =>
    handleCalendarEventDetailRoute(route, state)
  );
  await page.route("**/api/calendar/events", (route) => handleCalendarEventListRoute(route, state));
  await page.route(/\/api\/email\/messages\/[^/]+$/, (route) =>
    handleEmailMessageDetailRoute(route, state)
  );
  await page.route("**/api/email/messages", (route) => handleEmailMessageListRoute(route, state));
  await page.route(/\/api\/notes\/[^/]+$/, (route) => handleNoteDetailRoute(route, state));
  await page.route("**/api/notes", (route) => handleNoteListRoute(route, state));
  await page.route(/\/api\/notifications\/[^/]+\/read$/, (route) =>
    handleNotificationReadRoute(route, state)
  );
  await page.route("**/api/notifications/read-all", (route) =>
    handleMarkAllNotificationsReadRoute(route, state)
  );
  await page.route("**/api/notifications", (route) => handleNotificationListRoute(route, state));
  await page.route("**/api/tasks/*/activity", (route) =>
    fulfillJson(route, 201, {
      activity: {
        id: "activity-1",
        taskId: "task-1",
        actorUserId: "user-1",
        activityType: "comment",
        body: (route.request().postDataJSON() as { readonly body?: string | null }).body ?? null,
        createdAt: "2026-06-06T12:00:00.000Z"
      }
    })
  );
  await page.route(/\/api\/tasks\/[^/]+$/, (route) => handleTaskDetailRoute(route, state));
  await page.route("**/api/tasks", (route) => handleTaskListRoute(route, state));
}

async function handleConnectorAccountsRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { accounts: state.connectorAccounts });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateConnectorAccountRequest;
    const provider = state.connectorProviders.find((item) => item.id === input.providerId);
    const account = createMockConnectorAccount(`connector-${state.connectorAccounts.length + 1}`, {
      providerId: input.providerId,
      providerType: provider?.providerType ?? "calendar",
      providerDisplayName: provider?.displayName ?? input.providerId,
      providerStatus: provider?.status ?? "available",
      workspaceId: input.workspaceId ?? null,
      scopes: input.scopes ?? [],
      status: input.status ?? "active"
    });

    state.connectorAccounts = [...state.connectorAccounts, account];
    return fulfillJson(route, 201, { account });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleConnectorDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const accountId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const account = state.connectorAccounts.find((item) => item.id === accountId);

  if (!account) {
    return fulfillJson(route, 404, { error: "Connector account not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateConnectorAccountRequest;
  const updatedAccount = {
    ...account,
    scopes: input.scopes ?? account.scopes,
    status: input.status ?? account.status,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.connectorAccounts = state.connectorAccounts.map((item) =>
    item.id === accountId ? updatedAccount : item
  );
  return fulfillJson(route, 200, { account: updatedAccount });
}

async function handleConnectorRevokeRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const segments = new URL(request.url()).pathname.split("/");
  const accountId = decodeURIComponent(segments.at(-2) ?? "");
  const account = state.connectorAccounts.find((item) => item.id === accountId);

  if (!account) {
    return fulfillJson(route, 404, { error: "Connector account not found" });
  }

  if (request.method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const revokedAccount = {
    ...account,
    status: "revoked" as const,
    revokedAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.connectorAccounts = state.connectorAccounts.map((item) =>
    item.id === accountId ? revokedAccount : item
  );
  return fulfillJson(route, 200, { account: revokedAccount });
}

async function handleAiProvidersRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { providers: state.aiProviders ?? [] });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateAiProviderConfigRequest;
    const provider = createMockAiProvider(`ai-provider-${(state.aiProviders ?? []).length + 1}`, {
      providerKind: input.providerKind,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      status: input.status ?? "active",
      hasCredential: true
    });

    state.aiProviders = [...(state.aiProviders ?? []), provider];
    return fulfillJson(route, 201, { provider });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleAiProviderDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const providerId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const provider = (state.aiProviders ?? []).find((item) => item.id === providerId);

  if (!provider) {
    return fulfillJson(route, 404, { error: "AI provider config not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateAiProviderConfigRequest;
  const updatedProvider: AiProviderConfigDto = {
    ...provider,
    providerKind: input.providerKind ?? provider.providerKind,
    displayName: input.displayName ?? provider.displayName,
    baseUrl: input.baseUrl === undefined ? provider.baseUrl : input.baseUrl,
    status: input.status ?? provider.status,
    hasCredential: input.credentialPayload === undefined ? provider.hasCredential : true,
    revokedAt: null,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiProviders = (state.aiProviders ?? []).map((item) =>
    item.id === providerId ? updatedProvider : item
  );
  return fulfillJson(route, 200, { provider: updatedProvider });
}

async function handleAiProviderRevokeRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const segments = new URL(request.url()).pathname.split("/");
  const providerId = decodeURIComponent(segments.at(-2) ?? "");
  const provider = (state.aiProviders ?? []).find((item) => item.id === providerId);

  if (!provider) {
    return fulfillJson(route, 404, { error: "AI provider config not found" });
  }

  if (request.method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const revokedProvider: AiProviderConfigDto = {
    ...provider,
    status: "revoked",
    revokedAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiProviders = (state.aiProviders ?? []).map((item) =>
    item.id === providerId ? revokedProvider : item
  );
  return fulfillJson(route, 200, { provider: revokedProvider });
}

async function handleAiModelsRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { models: state.aiModels ?? [] });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateAiConfiguredModelRequest;
    const provider = (state.aiProviders ?? []).find((item) => item.id === input.providerConfigId);

    if (!provider) {
      return fulfillJson(route, 400, { error: "AI configuration request is invalid" });
    }

    const model = createMockAiModel(`ai-model-${(state.aiModels ?? []).length + 1}`, {
      providerConfigId: provider.id,
      providerKind: provider.providerKind,
      providerDisplayName: provider.displayName,
      providerStatus: provider.status,
      providerModelId: input.providerModelId,
      displayName: input.displayName,
      capabilities: input.capabilities,
      status: input.status ?? "active"
    });

    state.aiModels = [...(state.aiModels ?? []), model];
    return fulfillJson(route, 201, { model });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleAiModelDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const modelId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const model = (state.aiModels ?? []).find((item) => item.id === modelId);

  if (!model) {
    return fulfillJson(route, 404, { error: "AI model config not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateAiConfiguredModelRequest;
  const updatedModel: AiConfiguredModelDto = {
    ...model,
    providerModelId: input.providerModelId ?? model.providerModelId,
    displayName: input.displayName ?? model.displayName,
    capabilities: input.capabilities ?? model.capabilities,
    status: input.status ?? model.status,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.aiModels = (state.aiModels ?? []).map((item) =>
    item.id === modelId ? updatedModel : item
  );
  return fulfillJson(route, 200, { model: updatedModel });
}

async function handleAiCapabilityRoute(route: Route, state: MockApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const capability = decodeURIComponent(
    new URL(route.request().url()).pathname.split("/").pop() ?? ""
  ) as AiModelCapability;
  const model =
    (state.aiModels ?? []).find((item) => {
      const provider = (state.aiProviders ?? []).find(
        (providerConfig) => providerConfig.id === item.providerConfigId
      );

      return (
        item.status === "active" &&
        item.capabilities.includes(capability) &&
        provider?.status === "active"
      );
    }) ?? null;

  return fulfillJson(route, 200, {
    route: {
      capability,
      available: Boolean(model),
      reason: model ? "matched-active-model" : "no-active-model",
      model
    }
  });
}

async function handleCalendarEventListRoute(route: Route, state: MockApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { events: state.calendarEvents ?? [] });
}

async function handleCalendarEventDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const eventId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const event = (state.calendarEvents ?? []).find((item) => item.id === eventId);

  if (!event) {
    return fulfillJson(route, 404, { error: "Calendar event not found" });
  }

  if (request.method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { event });
}

async function handleEmailMessageListRoute(route: Route, state: MockApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { messages: state.emailMessages ?? [] });
}

async function handleEmailMessageDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const messageId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const message = (state.emailMessages ?? []).find((item) => item.id === messageId);

  if (!message) {
    return fulfillJson(route, 404, { error: "Email message not found" });
  }

  if (request.method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { message });
}

async function handleNoteListRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { notes: state.notes });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateNoteRequest;
    const note = createMockNote(`note-${state.notes.length + 1}`, input.title, {
      body: input.body ?? null,
      visibility: input.visibility ?? "private",
      workspaceId: input.workspaceId ?? null
    });

    state.notes = [...state.notes, note];
    return fulfillJson(route, 201, { note });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleNoteDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const noteId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const note = state.notes.find((item) => item.id === noteId);

  if (!note) {
    return fulfillJson(route, 404, { error: "Note not found" });
  }

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { note });
  }

  if (request.method() === "PATCH") {
    const input = request.postDataJSON() as UpdateNoteRequest;
    const { archived, ...noteUpdates } = input;
    const updatedNote: NoteDto = {
      ...note,
      ...noteUpdates,
      archivedAt:
        archived === undefined ? note.archivedAt : archived ? "2026-06-06T12:00:00.000Z" : null,
      updatedAt: "2026-06-06T12:00:00.000Z"
    };

    state.notes = state.notes.map((item) => (item.id === noteId ? updatedNote : item));
    return fulfillJson(route, 200, { note: updatedNote });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleNotificationListRoute(route: Route, state: MockApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, {
    notifications: state.notifications,
    unreadCount: countUnreadNotifications(state.notifications)
  });
}

async function handleNotificationReadRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const segments = new URL(request.url()).pathname.split("/");
  const notificationId = decodeURIComponent(segments.at(-2) ?? "");
  const notification = state.notifications.find((item) => item.id === notificationId);

  if (!notification) {
    return fulfillJson(route, 404, { error: "Notification not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const updatedNotification = {
    ...notification,
    readAt: "2026-06-06T12:00:00.000Z"
  };

  state.notifications = state.notifications.map((item) =>
    item.id === notificationId ? updatedNotification : item
  );

  return fulfillJson(route, 200, { notification: updatedNotification });
}

async function handleMarkAllNotificationsReadRoute(
  route: Route,
  state: MockApiState
): Promise<void> {
  if (route.request().method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  state.notifications = state.notifications.map((notification) => ({
    ...notification,
    readAt: notification.readAt ?? "2026-06-06T12:00:00.000Z"
  }));

  return fulfillJson(route, 200, {
    unreadCount: countUnreadNotifications(state.notifications)
  });
}

async function handleTaskListRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { tasks: state.tasks });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateTaskRequest;
    const task = createMockTask(`task-${state.tasks.length + 1}`, input.title, {
      description: input.description ?? null,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? null,
      visibility: input.visibility ?? "private",
      workspaceId: input.workspaceId ?? null
    });

    state.tasks = [...state.tasks, task];
    return fulfillJson(route, 201, { task });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleTaskDetailRoute(route: Route, state: MockApiState): Promise<void> {
  const request = route.request();
  const taskId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    return fulfillJson(route, 404, { error: "Task not found" });
  }

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { task });
  }

  if (request.method() === "PATCH") {
    const input = request.postDataJSON() as UpdateTaskRequest;
    const updatedTask: TaskDto = {
      ...task,
      ...input,
      completedAt: input.status === "done" ? "2026-06-06T12:00:00.000Z" : task.completedAt,
      updatedAt: "2026-06-06T12:00:00.000Z"
    };

    state.tasks = state.tasks.map((item) => (item.id === taskId ? updatedTask : item));
    return fulfillJson(route, 200, { task: updatedTask });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

export function createMockCalendarEvent(
  id: string,
  title: string,
  overrides: Partial<CalendarEventDto> = {}
): CalendarEventDto {
  return {
    id,
    connectorAccountId: "connector-calendar-1",
    ownerUserId: "user-1",
    workspaceId: null,
    visibility: "private",
    title,
    startsAt: "2030-06-06T16:00:00.000Z",
    endsAt: "2030-06-06T17:00:00.000Z",
    location: null,
    summary: null,
    bodyExcerpt: null,
    externalId: id,
    externalMetadata: {},
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockEmailMessage(
  id: string,
  subject: string,
  overrides: Partial<EmailMessageDto> = {}
): EmailMessageDto {
  return {
    id,
    connectorAccountId: "connector-email-1",
    ownerUserId: "user-1",
    workspaceId: null,
    visibility: "private",
    sender: "sender@example.test",
    recipients: [],
    subject,
    snippet: null,
    bodyExcerpt: null,
    receivedAt: "2026-06-06T12:00:00.000Z",
    externalId: id,
    externalMetadata: {},
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockTask(
  id: string,
  title: string,
  overrides: Partial<TaskDto> = {}
): TaskDto {
  return {
    id,
    ownerUserId: "user-1",
    workspaceId: null,
    visibility: "private",
    title,
    description: null,
    status: "todo",
    priority: null,
    dueAt: null,
    completedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockNote(
  id: string,
  title: string,
  overrides: Partial<NoteDto> = {}
): NoteDto {
  return {
    id,
    ownerUserId: "user-1",
    workspaceId: null,
    visibility: "private",
    title,
    body: null,
    archivedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockNotification(
  id: string,
  title: string,
  overrides: Partial<NotificationDto> = {}
): NotificationDto {
  return {
    id,
    actorUserId: "user-1",
    recipientUserId: "user-1",
    workspaceId: null,
    visibility: "private",
    title,
    body: null,
    metadata: {},
    readAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

export function createMockConnectorProviders(): ConnectorProviderDto[] {
  return [
    {
      id: "google-calendar",
      providerType: "calendar",
      displayName: "Google Calendar",
      status: "available",
      defaultScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      id: "google-email",
      providerType: "email",
      displayName: "Google Email",
      status: "available",
      defaultScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }
  ];
}

function createMockConnectorAccount(
  id: string,
  overrides: Partial<ConnectorAccountDto> = {}
): ConnectorAccountDto {
  return {
    id,
    providerId: "google-calendar",
    providerType: "calendar",
    providerDisplayName: "Google Calendar",
    providerStatus: "available",
    ownerUserId: "user-1",
    workspaceId: null,
    scopes: [],
    status: "active",
    hasSecret: true,
    revokedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

function createMockAiProvider(
  id: string,
  overrides: Partial<AiProviderConfigDto> = {}
): AiProviderConfigDto {
  return {
    id,
    providerKind: "openai-compatible",
    displayName: "OpenAI Compatible",
    baseUrl: null,
    status: "active",
    hasCredential: true,
    revokedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

function createMockAiModel(
  id: string,
  overrides: Partial<AiConfiguredModelDto> = {}
): AiConfiguredModelDto {
  return {
    id,
    providerConfigId: "ai-provider-1",
    providerKind: "openai-compatible",
    providerDisplayName: "OpenAI Compatible",
    providerStatus: "active",
    providerModelId: "model-id",
    displayName: "Model",
    capabilities: ["chat"],
    status: "active",
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}

function createMockAiAssistantTools(): AiAssistantToolDto[] {
  return [
    {
      moduleId: "tasks",
      moduleName: "Tasks",
      name: "tasks.listVisible",
      description: "List visible tasks.",
      permissionId: "tasks.view",
      risk: "read",
      inputSchema: {
        type: "object"
      },
      outputSchema: null
    },
    {
      moduleId: "notes",
      moduleName: "Notes",
      name: "notes.listVisible",
      description: "List visible notes.",
      permissionId: "notes.view",
      risk: "read",
      inputSchema: {
        type: "object"
      },
      outputSchema: null
    },
    {
      moduleId: "tasks",
      moduleName: "Tasks",
      name: "tasks.updateStatus",
      description: "Queue a task status update.",
      permissionId: "tasks.update",
      risk: "write",
      inputSchema: {
        type: "object"
      },
      outputSchema: null
    }
  ];
}

function countUnreadNotifications(notifications: readonly NotificationDto[]): number {
  return notifications.filter((notification) => !notification.readAt).length;
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
