import type {
  AddTaskActivityRequest,
  CreateAiConfiguredModelRequest,
  CreateAiConfiguredModelResponse,
  CreateAiProviderConfigRequest,
  CreateAiProviderConfigResponse,
  AddTaskActivityResponse,
  AiModelCapability,
  AppendChatUserMessageRequest,
  AppendChatUserMessageResponse,
  BootstrapStatusResponse,
  CreateBriefingDefinitionRequest,
  CreateBriefingDefinitionResponse,
  CreateChatThreadRequest,
  CreateChatThreadResponse,
  GetCalendarEventResponse,
  GetChatThreadResponse,
  GetEmailMessageResponse,
  CreateConnectorAccountRequest,
  CreateConnectorAccountResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  GetTaskResponse,
  ListAiAssistantToolsResponse,
  ListAiConfiguredModelsResponse,
  ListAiProviderConfigsResponse,
  ListAdminConnectorAccountsResponse,
  ListAuthProviderStatusesResponse,
  ListBriefingDefinitionsResponse,
  ListBriefingRunsResponse,
  ListCalendarEventsResponse,
  ListChatMessagesResponse,
  ListChatThreadsResponse,
  ListConnectorAccountsResponse,
  ListConnectorProvidersResponse,
  ListEmailMessagesResponse,
  ListModulesResponse,
  ListNotificationsResponse,
  ListTasksResponse,
  ListWorkspacesResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  MeResponse,
  RevokeAiProviderConfigResponse,
  RevokeConnectorAccountResponse,
  LookupAiCapabilityRouteResponse,
  RunBriefingDefinitionRequest,
  RunBriefingDefinitionResponse,
  UpdateBriefingDefinitionRequest,
  UpdateBriefingDefinitionResponse,
  UpdateAiConfiguredModelRequest,
  UpdateAiConfiguredModelResponse,
  UpdateAiProviderConfigRequest,
  UpdateAiProviderConfigResponse,
  UpdateConnectorAccountRequest,
  UpdateConnectorAccountResponse,
  UpdateTaskRequest,
  UpdateTaskResponse
} from "@jarv1s/shared";

export interface SignUpEmailRequest {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface SignInEmailRequest {
  readonly email: string;
  readonly password: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

interface ApiRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  readonly body?: unknown;
  readonly headers?: HeadersInit;
  readonly workspaceId?: string | null;
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  return requestJson<BootstrapStatusResponse>("/api/bootstrap/status");
}

export async function getMe(workspaceId: string | null): Promise<MeResponse> {
  return requestJson<MeResponse>("/api/me", { workspaceId });
}

export async function getModules(workspaceId: string | null): Promise<ListModulesResponse> {
  return requestJson<ListModulesResponse>("/api/modules", { workspaceId });
}

export async function signUpEmail(input: SignUpEmailRequest): Promise<void> {
  await requestJson<unknown>("/api/auth/sign-up/email", {
    method: "POST",
    body: input
  });
}

export async function signInEmail(input: SignInEmailRequest): Promise<void> {
  await requestJson<unknown>("/api/auth/sign-in/email", {
    method: "POST",
    body: input
  });
}

export async function signOut(): Promise<void> {
  await requestJson<unknown>("/api/auth/sign-out", {
    method: "POST"
  });
}

export async function listTasks(workspaceId: string | null): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks", { workspaceId });
}

export async function createTask(
  input: CreateTaskRequest,
  workspaceId: string | null
): Promise<CreateTaskResponse> {
  return requestJson<CreateTaskResponse>("/api/tasks", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function getTask(id: string, workspaceId: string | null): Promise<GetTaskResponse> {
  return requestJson<GetTaskResponse>(`/api/tasks/${encodeURIComponent(id)}`, { workspaceId });
}

export async function updateTask(
  id: string,
  input: UpdateTaskRequest,
  workspaceId: string | null
): Promise<UpdateTaskResponse> {
  return requestJson<UpdateTaskResponse>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    workspaceId
  });
}

export async function addTaskActivity(
  id: string,
  input: AddTaskActivityRequest,
  workspaceId: string | null
): Promise<AddTaskActivityResponse> {
  return requestJson<AddTaskActivityResponse>(`/api/tasks/${encodeURIComponent(id)}/activity`, {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function listNotifications(
  workspaceId: string | null
): Promise<ListNotificationsResponse> {
  return requestJson<ListNotificationsResponse>("/api/notifications", { workspaceId });
}

export async function listCalendarEvents(
  workspaceId: string | null
): Promise<ListCalendarEventsResponse> {
  return requestJson<ListCalendarEventsResponse>("/api/calendar/events", { workspaceId });
}

export async function getCalendarEvent(
  id: string,
  workspaceId: string | null
): Promise<GetCalendarEventResponse> {
  return requestJson<GetCalendarEventResponse>(`/api/calendar/events/${encodeURIComponent(id)}`, {
    workspaceId
  });
}

export async function listEmailMessages(
  workspaceId: string | null
): Promise<ListEmailMessagesResponse> {
  return requestJson<ListEmailMessagesResponse>("/api/email/messages", { workspaceId });
}

export async function listChatThreads(
  workspaceId: string | null
): Promise<ListChatThreadsResponse> {
  return requestJson<ListChatThreadsResponse>("/api/chat/threads", { workspaceId });
}

export async function createChatThread(
  input: CreateChatThreadRequest,
  workspaceId: string | null
): Promise<CreateChatThreadResponse> {
  return requestJson<CreateChatThreadResponse>("/api/chat/threads", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function getChatThread(
  id: string,
  workspaceId: string | null
): Promise<GetChatThreadResponse> {
  return requestJson<GetChatThreadResponse>(`/api/chat/threads/${encodeURIComponent(id)}`, {
    workspaceId
  });
}

export async function listChatMessages(
  threadId: string,
  workspaceId: string | null
): Promise<ListChatMessagesResponse> {
  return requestJson<ListChatMessagesResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
    { workspaceId }
  );
}

export async function appendChatUserMessage(
  threadId: string,
  input: AppendChatUserMessageRequest,
  workspaceId: string | null
): Promise<AppendChatUserMessageResponse> {
  return requestJson<AppendChatUserMessageResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: input,
      workspaceId
    }
  );
}

export async function getEmailMessage(
  id: string,
  workspaceId: string | null
): Promise<GetEmailMessageResponse> {
  return requestJson<GetEmailMessageResponse>(`/api/email/messages/${encodeURIComponent(id)}`, {
    workspaceId
  });
}

export async function listConnectorProviders(
  workspaceId: string | null
): Promise<ListConnectorProvidersResponse> {
  return requestJson<ListConnectorProvidersResponse>("/api/connectors/providers", { workspaceId });
}

export async function listAiProviders(
  workspaceId: string | null
): Promise<ListAiProviderConfigsResponse> {
  return requestJson<ListAiProviderConfigsResponse>("/api/ai/providers", { workspaceId });
}

export async function createAiProvider(
  input: CreateAiProviderConfigRequest,
  workspaceId: string | null
): Promise<CreateAiProviderConfigResponse> {
  return requestJson<CreateAiProviderConfigResponse>("/api/ai/providers", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function updateAiProvider(
  id: string,
  input: UpdateAiProviderConfigRequest,
  workspaceId: string | null
): Promise<UpdateAiProviderConfigResponse> {
  return requestJson<UpdateAiProviderConfigResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: input,
      workspaceId
    }
  );
}

export async function revokeAiProvider(
  id: string,
  workspaceId: string | null
): Promise<RevokeAiProviderConfigResponse> {
  return requestJson<RevokeAiProviderConfigResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}/revoke`,
    {
      method: "POST",
      workspaceId
    }
  );
}

export async function listAiModels(
  workspaceId: string | null
): Promise<ListAiConfiguredModelsResponse> {
  return requestJson<ListAiConfiguredModelsResponse>("/api/ai/models", { workspaceId });
}

export async function createAiModel(
  input: CreateAiConfiguredModelRequest,
  workspaceId: string | null
): Promise<CreateAiConfiguredModelResponse> {
  return requestJson<CreateAiConfiguredModelResponse>("/api/ai/models", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function updateAiModel(
  id: string,
  input: UpdateAiConfiguredModelRequest,
  workspaceId: string | null
): Promise<UpdateAiConfiguredModelResponse> {
  return requestJson<UpdateAiConfiguredModelResponse>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    workspaceId
  });
}

export async function lookupAiCapabilityRoute(
  capability: AiModelCapability,
  workspaceId: string | null
): Promise<LookupAiCapabilityRouteResponse> {
  return requestJson<LookupAiCapabilityRouteResponse>(
    `/api/ai/capability-route/${encodeURIComponent(capability)}`,
    { workspaceId }
  );
}

export async function listAiAssistantTools(
  workspaceId: string | null
): Promise<ListAiAssistantToolsResponse> {
  return requestJson<ListAiAssistantToolsResponse>("/api/ai/assistant-tools", { workspaceId });
}

export async function listBriefingDefinitions(
  workspaceId: string | null
): Promise<ListBriefingDefinitionsResponse> {
  return requestJson<ListBriefingDefinitionsResponse>("/api/briefings/definitions", {
    workspaceId
  });
}

export async function createBriefingDefinition(
  input: CreateBriefingDefinitionRequest,
  workspaceId: string | null
): Promise<CreateBriefingDefinitionResponse> {
  return requestJson<CreateBriefingDefinitionResponse>("/api/briefings/definitions", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function updateBriefingDefinition(
  id: string,
  input: UpdateBriefingDefinitionRequest,
  workspaceId: string | null
): Promise<UpdateBriefingDefinitionResponse> {
  return requestJson<UpdateBriefingDefinitionResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: input,
      workspaceId
    }
  );
}

export async function runBriefingDefinition(
  id: string,
  input: RunBriefingDefinitionRequest,
  workspaceId: string | null
): Promise<RunBriefingDefinitionResponse> {
  return requestJson<RunBriefingDefinitionResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}/run`,
    {
      method: "POST",
      body: input,
      workspaceId
    }
  );
}

export async function listBriefingRuns(
  id: string,
  workspaceId: string | null
): Promise<ListBriefingRunsResponse> {
  return requestJson<ListBriefingRunsResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}/runs`,
    {
      workspaceId
    }
  );
}

export async function listConnectorAccounts(
  workspaceId: string | null
): Promise<ListConnectorAccountsResponse> {
  return requestJson<ListConnectorAccountsResponse>("/api/connectors/accounts", { workspaceId });
}

export async function createConnectorAccount(
  input: CreateConnectorAccountRequest,
  workspaceId: string | null
): Promise<CreateConnectorAccountResponse> {
  return requestJson<CreateConnectorAccountResponse>("/api/connectors/accounts", {
    method: "POST",
    body: input,
    workspaceId
  });
}

export async function updateConnectorAccount(
  id: string,
  input: UpdateConnectorAccountRequest,
  workspaceId: string | null
): Promise<UpdateConnectorAccountResponse> {
  return requestJson<UpdateConnectorAccountResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: input,
      workspaceId
    }
  );
}

export async function revokeConnectorAccount(
  id: string,
  workspaceId: string | null
): Promise<RevokeConnectorAccountResponse> {
  return requestJson<RevokeConnectorAccountResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}/revoke`,
    {
      method: "POST",
      workspaceId
    }
  );
}

export async function markNotificationRead(
  id: string,
  workspaceId: string | null
): Promise<MarkNotificationReadResponse> {
  return requestJson<MarkNotificationReadResponse>(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    {
      method: "PATCH",
      workspaceId
    }
  );
}

export async function markAllNotificationsRead(
  workspaceId: string | null
): Promise<MarkAllNotificationsReadResponse> {
  return requestJson<MarkAllNotificationsReadResponse>("/api/notifications/read-all", {
    method: "PATCH",
    workspaceId
  });
}

export async function listAuthProviderStatuses(): Promise<ListAuthProviderStatusesResponse> {
  return requestJson<ListAuthProviderStatusesResponse>("/api/admin/auth/providers");
}

export async function listAdminWorkspaces(): Promise<ListWorkspacesResponse> {
  return requestJson<ListWorkspacesResponse>("/api/admin/workspaces");
}

export async function listAdminConnectorAccounts(): Promise<ListAdminConnectorAccountsResponse> {
  return requestJson<ListAdminConnectorAccountsResponse>("/api/admin/connectors/accounts");
}

async function requestJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  headers.set("accept", "application/json");
  if (hasBody) {
    headers.set("content-type", "application/json");
  }
  if (options.workspaceId) {
    headers.set("x-jarvis-workspace-id", options.workspaceId);
  }

  const response = await fetch(path, {
    ...options,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();

  if (!text) {
    return response.statusText;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: unknown; readonly message?: unknown };
    const message = parsed.error ?? parsed.message;

    return typeof message === "string" ? message : response.statusText;
  } catch {
    return text;
  }
}
