import type {
  AddTaskActivityRequest,
  CreateAiConfiguredModelRequest,
  CreateAiConfiguredModelResponse,
  CreateAiProviderConfigRequest,
  CreateAiProviderConfigResponse,
  AddTaskActivityResponse,
  AiModelCapability,
  BootstrapStatusResponse,
  BreakdownTaskRequest,
  BreakdownTaskResponse,
  CreateBriefingDefinitionRequest,
  CreateBriefingDefinitionResponse,
  CreateTaskListRequest,
  CreateTaskListResponse,
  CreateTaskTagRequest,
  CreateTaskTagResponse,
  GetCalendarEventResponse,
  GetEmailMessageResponse,
  GetTaskPreferencesResponse,
  CreateConnectorAccountRequest,
  CreateConnectorAccountResponse,
  GoogleAuthorizeRequest,
  GoogleAuthorizeResponse,
  GoogleCompleteRequest,
  GoogleCompleteResponse,
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
  ListChatThreadsResponse,
  ListConnectorAccountsResponse,
  ListConnectorProvidersResponse,
  ListEmailMessagesResponse,
  ListModulesResponse,
  ListNotificationsResponse,
  ListTaskActivityResponse,
  ListTaskListsResponse,
  ListTaskTagsResponse,
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
  UpdateTaskPreferencesRequest,
  UpdateTaskPreferencesResponse,
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
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  return requestJson<BootstrapStatusResponse>("/api/bootstrap/status");
}

export async function getMe(): Promise<MeResponse> {
  return requestJson<MeResponse>("/api/me");
}

export async function getModules(): Promise<ListModulesResponse> {
  return requestJson<ListModulesResponse>("/api/modules");
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

export async function listTaskActivity(taskId: string): Promise<ListTaskActivityResponse> {
  return requestJson<ListTaskActivityResponse>(`/api/tasks/${encodeURIComponent(taskId)}/activity`);
}

export async function listTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks");
}

export async function createTask(input: CreateTaskRequest): Promise<CreateTaskResponse> {
  return requestJson<CreateTaskResponse>("/api/tasks", { method: "POST", body: input });
}

export async function getTask(id: string): Promise<GetTaskResponse> {
  return requestJson<GetTaskResponse>(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function updateTask(
  id: string,
  input: UpdateTaskRequest
): Promise<UpdateTaskResponse> {
  return requestJson<UpdateTaskResponse>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input
  });
}

export async function addTaskActivity(
  id: string,
  input: AddTaskActivityRequest
): Promise<AddTaskActivityResponse> {
  return requestJson<AddTaskActivityResponse>(`/api/tasks/${encodeURIComponent(id)}/activity`, {
    method: "POST",
    body: input
  });
}

export async function listSubtasks(id: string): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>(`/api/tasks/${encodeURIComponent(id)}/subtasks`);
}

export async function breakdownTask(
  id: string,
  input: BreakdownTaskRequest
): Promise<BreakdownTaskResponse> {
  return requestJson<BreakdownTaskResponse>(`/api/tasks/${encodeURIComponent(id)}/breakdown`, {
    method: "POST",
    body: input
  });
}

export async function listFocusTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/focus");
}

export async function listAtRiskTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/at-risk");
}

export async function listOverdueTasks(): Promise<ListTasksResponse> {
  return requestJson<ListTasksResponse>("/api/tasks/overdue");
}

export async function listTaskLists(): Promise<ListTaskListsResponse> {
  return requestJson<ListTaskListsResponse>("/api/tasks/lists");
}

export async function createTaskList(
  input: CreateTaskListRequest
): Promise<CreateTaskListResponse> {
  return requestJson<CreateTaskListResponse>("/api/tasks/lists", { method: "POST", body: input });
}

export async function listTaskTags(listId: string): Promise<ListTaskTagsResponse> {
  return requestJson<ListTaskTagsResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}/tags`);
}

export async function createTaskTag(
  listId: string,
  input: CreateTaskTagRequest
): Promise<CreateTaskTagResponse> {
  return requestJson<CreateTaskTagResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}/tags`, {
    method: "POST",
    body: input
  });
}

export async function getTaskPreferences(): Promise<GetTaskPreferencesResponse> {
  return requestJson<GetTaskPreferencesResponse>("/api/tasks/preferences");
}

export async function updateTaskPreferences(
  input: UpdateTaskPreferencesRequest
): Promise<UpdateTaskPreferencesResponse> {
  return requestJson<UpdateTaskPreferencesResponse>("/api/tasks/preferences", {
    method: "PATCH",
    body: input
  });
}

export async function listNotifications(): Promise<ListNotificationsResponse> {
  return requestJson<ListNotificationsResponse>("/api/notifications");
}

export async function listCalendarEvents(): Promise<ListCalendarEventsResponse> {
  return requestJson<ListCalendarEventsResponse>("/api/calendar/events");
}

export async function getCalendarEvent(id: string): Promise<GetCalendarEventResponse> {
  return requestJson<GetCalendarEventResponse>(`/api/calendar/events/${encodeURIComponent(id)}`);
}

export async function listEmailMessages(): Promise<ListEmailMessagesResponse> {
  return requestJson<ListEmailMessagesResponse>("/api/email/messages");
}

export async function listChatThreads(): Promise<ListChatThreadsResponse> {
  return requestJson<ListChatThreadsResponse>("/api/chat/threads");
}

export async function sendChatTurn(text: string): Promise<{ reply: string }> {
  return requestJson<{ reply: string }>("/api/chat/turn", {
    method: "POST",
    body: { text }
  });
}

export async function clearChat(options?: { incognito?: boolean }): Promise<void> {
  const url = options?.incognito ? "/api/chat/clear?incognito=true" : "/api/chat/clear";
  await requestJson<unknown>(url, { method: "POST" });
}

export interface MemorySettings {
  readonly recallEnabled: boolean;
  readonly factsEnabled: boolean;
}

export interface MemoryFact {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly importance: number;
  readonly sourceThreadId: string | null;
  readonly createdAt: string;
}

export async function getMemorySettings(): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/api/chat/memory/settings");
}

export async function patchMemorySettings(patch: Partial<MemorySettings>): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/api/chat/memory/settings", { method: "PATCH", body: patch });
}

export async function getMemoryFacts(): Promise<{ facts: MemoryFact[] }> {
  return requestJson<{ facts: MemoryFact[] }>("/api/chat/memory/facts");
}

export async function deleteMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function switchChatProvider(): Promise<void> {
  await requestJson<unknown>("/api/chat/switch", { method: "POST" });
}

export function chatStreamUrl(): string {
  return "/api/chat/stream";
}

export async function resolveActionRequest(
  actionRequestId: string,
  status: "confirmed" | "rejected" | "cancelled"
): Promise<void> {
  await requestJson<unknown>(
    `/api/chat/action-requests/${encodeURIComponent(actionRequestId)}/resolve`,
    { method: "POST", body: { status } }
  );
}

export async function getEmailMessage(id: string): Promise<GetEmailMessageResponse> {
  return requestJson<GetEmailMessageResponse>(`/api/email/messages/${encodeURIComponent(id)}`);
}

export async function listConnectorProviders(): Promise<ListConnectorProvidersResponse> {
  return requestJson<ListConnectorProvidersResponse>("/api/connectors/providers");
}

export async function listAiProviders(): Promise<ListAiProviderConfigsResponse> {
  return requestJson<ListAiProviderConfigsResponse>("/api/ai/providers");
}

export async function createAiProvider(
  input: CreateAiProviderConfigRequest
): Promise<CreateAiProviderConfigResponse> {
  return requestJson<CreateAiProviderConfigResponse>("/api/ai/providers", {
    method: "POST",
    body: input
  });
}

export async function updateAiProvider(
  id: string,
  input: UpdateAiProviderConfigRequest
): Promise<UpdateAiProviderConfigResponse> {
  return requestJson<UpdateAiProviderConfigResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input }
  );
}

export async function revokeAiProvider(id: string): Promise<RevokeAiProviderConfigResponse> {
  return requestJson<RevokeAiProviderConfigResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}/revoke`,
    { method: "POST" }
  );
}

export async function listAiModels(): Promise<ListAiConfiguredModelsResponse> {
  return requestJson<ListAiConfiguredModelsResponse>("/api/ai/models");
}

export async function createAiModel(
  input: CreateAiConfiguredModelRequest
): Promise<CreateAiConfiguredModelResponse> {
  return requestJson<CreateAiConfiguredModelResponse>("/api/ai/models", {
    method: "POST",
    body: input
  });
}

export async function updateAiModel(
  id: string,
  input: UpdateAiConfiguredModelRequest
): Promise<UpdateAiConfiguredModelResponse> {
  return requestJson<UpdateAiConfiguredModelResponse>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input
  });
}

export async function lookupAiCapabilityRoute(
  capability: AiModelCapability
): Promise<LookupAiCapabilityRouteResponse> {
  return requestJson<LookupAiCapabilityRouteResponse>(
    `/api/ai/capability-route/${encodeURIComponent(capability)}`
  );
}

export async function listAiAssistantTools(): Promise<ListAiAssistantToolsResponse> {
  return requestJson<ListAiAssistantToolsResponse>("/api/ai/assistant-tools");
}

export async function listBriefingDefinitions(): Promise<ListBriefingDefinitionsResponse> {
  return requestJson<ListBriefingDefinitionsResponse>("/api/briefings/definitions");
}

export async function createBriefingDefinition(
  input: CreateBriefingDefinitionRequest
): Promise<CreateBriefingDefinitionResponse> {
  return requestJson<CreateBriefingDefinitionResponse>("/api/briefings/definitions", {
    method: "POST",
    body: input
  });
}

export async function updateBriefingDefinition(
  id: string,
  input: UpdateBriefingDefinitionRequest
): Promise<UpdateBriefingDefinitionResponse> {
  return requestJson<UpdateBriefingDefinitionResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input }
  );
}

export async function runBriefingDefinition(
  id: string,
  input: RunBriefingDefinitionRequest
): Promise<RunBriefingDefinitionResponse> {
  return requestJson<RunBriefingDefinitionResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}/run`,
    { method: "POST", body: input }
  );
}

export async function listBriefingRuns(id: string): Promise<ListBriefingRunsResponse> {
  return requestJson<ListBriefingRunsResponse>(
    `/api/briefings/definitions/${encodeURIComponent(id)}/runs`
  );
}

export async function listConnectorAccounts(): Promise<ListConnectorAccountsResponse> {
  return requestJson<ListConnectorAccountsResponse>("/api/connectors/accounts");
}

export async function createConnectorAccount(
  input: CreateConnectorAccountRequest
): Promise<CreateConnectorAccountResponse> {
  return requestJson<CreateConnectorAccountResponse>("/api/connectors/accounts", {
    method: "POST",
    body: input
  });
}

export async function updateConnectorAccount(
  id: string,
  input: UpdateConnectorAccountRequest
): Promise<UpdateConnectorAccountResponse> {
  return requestJson<UpdateConnectorAccountResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input }
  );
}

export async function revokeConnectorAccount(id: string): Promise<RevokeConnectorAccountResponse> {
  return requestJson<RevokeConnectorAccountResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}/revoke`,
    { method: "POST" }
  );
}

export async function authorizeGoogleConnection(
  input: GoogleAuthorizeRequest
): Promise<GoogleAuthorizeResponse> {
  return requestJson<GoogleAuthorizeResponse>("/api/connectors/google/authorize", {
    method: "POST",
    body: input
  });
}

export async function completeGoogleConnection(
  input: GoogleCompleteRequest
): Promise<GoogleCompleteResponse> {
  return requestJson<GoogleCompleteResponse>("/api/connectors/google/complete", {
    method: "POST",
    body: input
  });
}

export async function markNotificationRead(id: string): Promise<MarkNotificationReadResponse> {
  return requestJson<MarkNotificationReadResponse>(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    { method: "PATCH" }
  );
}

export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
  return requestJson<MarkAllNotificationsReadResponse>("/api/notifications/read-all", {
    method: "PATCH"
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
