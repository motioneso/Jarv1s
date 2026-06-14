import type {
  AddTaskActivityRequest,
  AssignTaskTagRequest,
  RenameTaskListRequest,
  DeleteTaskListRequest,
  RenameTaskTagRequest,
  CreateAiConfiguredModelRequest,
  CreateAiConfiguredModelResponse,
  CreateAiProviderConfigRequest,
  CreateAiProviderConfigResponse,
  AddTaskActivityResponse,
  AiModelCapability,
  BootstrapStatusResponse,
  ChatMultiplexerChoice,
  ChatMultiplexerSettingsDto,
  ListUsersResponse,
  RegistrationSettingsDto,
  UserDto,
  BreakdownTaskRequest,
  BreakdownTaskResponse,
  CreateBriefingDefinitionRequest,
  CreateBriefingDefinitionResponse,
  CreateCheckinRequest,
  CreateCheckinResponse,
  CreateMedicationLogRequest,
  CreateMedicationLogResponse,
  CreateMedicationRequest,
  CreateTaskListRequest,
  CreateTaskListResponse,
  CreateTaskTagRequest,
  CreateTaskTagResponse,
  GetCalendarEventResponse,
  GetTaskPreferencesResponse,
  GoogleAuthorizeRequest,
  GoogleAuthorizeResponse,
  GoogleCompleteRequest,
  GoogleCompleteResponse,
  GoogleSyncResponse,
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
  ListCheckinsResponse,
  ListChatThreadsResponse,
  ListConnectorAccountsResponse,
  ListConnectorProvidersResponse,
  ListMedicationsResponse,
  ListModulesResponse,
  ListMyModulesResponse,
  ListNotificationsResponse,
  ListTaskActivityResponse,
  ListTaskListsResponse,
  ListTaskTagsResponse,
  ListTasksResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  MedicationResponse,
  MedicationScheduleResponse,
  MeResponse,
  OnboardingStatusResponse,
  OnboardingCompleteResponse,
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
  UpdateMedicationRequest,
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
    message: string,
    readonly code?: string
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

export async function getMyModules(): Promise<ListMyModulesResponse> {
  return requestJson<ListMyModulesResponse>("/api/me/modules");
}

/** Bounded so a hung status read can never trap the founder before the app shell (Codex R2 #2). */
const ONBOARDING_STATUS_TIMEOUT_MS = 4000;

export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  // Race the request against a bounded timeout. On timeout this rejects → React Query
  // (retry:false) surfaces isError, and app.tsx falls through to the app shell. A fresh
  // instance therefore always boots even if /api/onboarding/status hangs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONBOARDING_STATUS_TIMEOUT_MS);
  try {
    return await requestJson<OnboardingStatusResponse>("/api/onboarding/status", {
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// Phase 4: complete/skip serve BOTH the founder { state } shape and the member { completed }
// shape (branched on role server-side). The return type is the shared role-by-shape union, not
// the founder-only OnboardingStateResponse — typing it { state } would make `.state` read as
// undefined for a member and mislead any consumer that narrows on it.
export async function completeOnboarding(): Promise<OnboardingCompleteResponse> {
  return requestJson<OnboardingCompleteResponse>("/api/onboarding/complete", { method: "POST" });
}

export async function skipOnboarding(): Promise<OnboardingCompleteResponse> {
  return requestJson<OnboardingCompleteResponse>("/api/onboarding/skip", { method: "POST" });
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

export async function listTasks(params?: { readonly tagId?: string }): Promise<ListTasksResponse> {
  const qs = params?.tagId ? `?tagId=${encodeURIComponent(params.tagId)}` : "";
  return requestJson<ListTasksResponse>(`/api/tasks${qs}`);
}

export async function assignTaskTag(
  taskId: string,
  input: AssignTaskTagRequest
): Promise<GetTaskResponse> {
  return requestJson<GetTaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "POST",
    body: input
  });
}

export async function unassignTaskTag(taskId: string, tagId: string): Promise<GetTaskResponse> {
  return requestJson<GetTaskResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE" }
  );
}

export async function renameTaskList(
  listId: string,
  input: RenameTaskListRequest
): Promise<CreateTaskListResponse> {
  return requestJson<CreateTaskListResponse>(`/api/tasks/lists/${encodeURIComponent(listId)}`, {
    method: "PATCH",
    body: input
  });
}

export async function deleteTaskList(
  listId: string,
  input?: DeleteTaskListRequest
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(`/api/tasks/lists/${encodeURIComponent(listId)}`, {
    method: "DELETE",
    body: input ?? {}
  });
}

export async function renameTaskTag(
  listId: string,
  tagId: string,
  input: RenameTaskTagRequest
): Promise<CreateTaskTagResponse> {
  return requestJson<CreateTaskTagResponse>(
    `/api/tasks/lists/${encodeURIComponent(listId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "PATCH", body: input }
  );
}

export async function deleteTaskTag(listId: string, tagId: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/tasks/lists/${encodeURIComponent(listId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE" }
  );
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

export async function listWellnessCheckins(): Promise<ListCheckinsResponse> {
  return requestJson<ListCheckinsResponse>("/api/wellness/checkins?limit=50");
}

export async function createWellnessCheckin(
  input: CreateCheckinRequest
): Promise<CreateCheckinResponse> {
  return requestJson<CreateCheckinResponse>("/api/wellness/checkins", {
    method: "POST",
    body: input
  });
}

export async function listMedications(): Promise<ListMedicationsResponse> {
  return requestJson<ListMedicationsResponse>("/api/wellness/medications");
}

export async function createMedication(
  input: CreateMedicationRequest
): Promise<MedicationResponse> {
  return requestJson<MedicationResponse>("/api/wellness/medications", {
    method: "POST",
    body: input
  });
}

export async function updateMedication(
  id: string,
  input: UpdateMedicationRequest
): Promise<MedicationResponse> {
  return requestJson<MedicationResponse>(`/api/wellness/medications/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input
  });
}

export async function getMedicationSchedule(date: string): Promise<MedicationScheduleResponse> {
  return requestJson<MedicationScheduleResponse>(
    `/api/wellness/medications/schedule?date=${encodeURIComponent(date)}`
  );
}

export async function logMedicationDose(
  medicationId: string,
  input: CreateMedicationLogRequest
): Promise<CreateMedicationLogResponse> {
  return requestJson<CreateMedicationLogResponse>(
    `/api/wellness/medications/${encodeURIComponent(medicationId)}/logs`,
    { method: "POST", body: input }
  );
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

export async function syncGoogleConnector(): Promise<GoogleSyncResponse> {
  return requestJson<GoogleSyncResponse>("/api/connectors/google/sync", { method: "POST" });
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

export async function listAdminConnectorAccounts(): Promise<ListAdminConnectorAccountsResponse> {
  return requestJson<ListAdminConnectorAccountsResponse>("/api/admin/connectors/accounts");
}

export async function listAdminUsers(): Promise<ListUsersResponse> {
  return requestJson<ListUsersResponse>("/api/admin/users");
}

export async function approveUser(id: string): Promise<{ user: UserDto }> {
  return requestJson<{ user: UserDto }>(`/api/admin/users/${encodeURIComponent(id)}/approve`, {
    method: "POST"
  });
}

export async function rejectUser(id: string): Promise<{ rejectedUserId: string }> {
  return requestJson<{ rejectedUserId: string }>(
    `/api/admin/users/${encodeURIComponent(id)}/reject`,
    { method: "POST" }
  );
}

export async function deactivateUser(id: string): Promise<{ user: UserDto }> {
  return requestJson<{ user: UserDto }>(`/api/admin/users/${encodeURIComponent(id)}/deactivate`, {
    method: "POST"
  });
}

export async function reactivateUser(id: string): Promise<{ user: UserDto }> {
  return requestJson<{ user: UserDto }>(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, {
    method: "POST"
  });
}

export async function promoteUser(id: string): Promise<{ user: UserDto }> {
  return requestJson<{ user: UserDto }>(`/api/admin/users/${encodeURIComponent(id)}/promote`, {
    method: "POST"
  });
}

export async function demoteUser(id: string): Promise<{ user: UserDto }> {
  return requestJson<{ user: UserDto }>(`/api/admin/users/${encodeURIComponent(id)}/demote`, {
    method: "POST"
  });
}

export async function deleteAdminUser(id: string): Promise<{ deletedUserId: string }> {
  return requestJson<{ deletedUserId: string }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function getRegistrationSettings(): Promise<RegistrationSettingsDto> {
  return requestJson<RegistrationSettingsDto>("/api/admin/registration");
}

export async function putRegistrationSettings(
  body: RegistrationSettingsDto
): Promise<RegistrationSettingsDto> {
  return requestJson<RegistrationSettingsDto>("/api/admin/registration", {
    method: "PUT",
    body
  });
}

export async function getChatMultiplexerSettings(): Promise<ChatMultiplexerSettingsDto> {
  return requestJson<ChatMultiplexerSettingsDto>("/api/admin/chat-multiplexer");
}

export async function setChatMultiplexerSettings(
  multiplexer: ChatMultiplexerChoice
): Promise<ChatMultiplexerSettingsDto> {
  return requestJson<ChatMultiplexerSettingsDto>("/api/admin/chat-multiplexer", {
    method: "PUT",
    body: { multiplexer }
  });
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
    const { message: errorMessage, code } = await readErrorBody(response);
    throw new ApiError(response.status, errorMessage, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function readErrorBody(response: Response): Promise<{ message: string; code?: string }> {
  const text = await response.text();

  if (!text) {
    return { message: response.statusText };
  }

  try {
    const parsed = JSON.parse(text) as {
      readonly error?: unknown;
      readonly message?: unknown;
      readonly code?: unknown;
    };
    const raw = parsed.error ?? parsed.message;
    const message = typeof raw === "string" ? raw : response.statusText;
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    return { message, code };
  } catch {
    return { message: text };
  }
}
