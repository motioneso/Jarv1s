import type {
  ConfirmNewsSourceRequest,
  ConfirmNewsSourceResponse,
  CreateNewsPrefRequest,
  CreateNewsSourceExclusionRequest,
  CreateNewsSourceExclusionResponse,
  CreateNewsTopicRequest,
  CreateNewsTopicResponse,
  DeleteNewsCustomSourceResponse,
  DeleteNewsSourceExclusionResponse,
  DeleteNewsTopicResponse,
  GetNewsPersonalizationResponse,
  NewsCatalogResponse,
  NewsOverviewResponse,
  NewsPrefDto,
  NewsPrefsResponse,
  NewsSourcePreviewRequest,
  NewsSourcePreviewResponse,
  TriggerNewsRevalidationResponse
} from "@jarv1s/shared";

import { requestJson } from "@jarv1s/module-web-sdk";

export async function getNewsOverview(): Promise<NewsOverviewResponse> {
  return requestJson<NewsOverviewResponse>("/api/news/overview");
}

export async function getNewsCatalog(): Promise<NewsCatalogResponse> {
  return requestJson<NewsCatalogResponse>("/api/news/catalog");
}

export async function listNewsPrefs(): Promise<NewsPrefsResponse> {
  return requestJson<NewsPrefsResponse>("/api/news/prefs");
}

export async function createNewsPref(input: CreateNewsPrefRequest): Promise<{ pref: NewsPrefDto }> {
  return requestJson<{ pref: NewsPrefDto }>("/api/news/prefs", {
    method: "POST",
    body: input
  });
}

export async function deleteNewsPref(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/news/prefs/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

// --- #953 personalization (Slice 1: reads + exclusion writes only) ----------

export async function getNewsPersonalization(): Promise<GetNewsPersonalizationResponse> {
  return requestJson<GetNewsPersonalizationResponse>("/api/news/personalization");
}

export async function createNewsSourceExclusion(
  input: CreateNewsSourceExclusionRequest
): Promise<CreateNewsSourceExclusionResponse> {
  return requestJson<CreateNewsSourceExclusionResponse>("/api/news/source-exclusions", {
    method: "POST",
    body: input
  });
}

export async function deleteNewsSourceExclusion(
  id: string
): Promise<DeleteNewsSourceExclusionResponse> {
  return requestJson<DeleteNewsSourceExclusionResponse>(
    `/api/news/source-exclusions/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

// --- #975 Slice 4 (Task 9): custom source/topic writes + revalidation retry --------------

export async function previewNewsSource(
  input: NewsSourcePreviewRequest
): Promise<NewsSourcePreviewResponse> {
  return requestJson<NewsSourcePreviewResponse>("/api/news/sources/preview", {
    method: "POST",
    body: input
  });
}

export async function confirmNewsSource(
  input: ConfirmNewsSourceRequest
): Promise<ConfirmNewsSourceResponse> {
  return requestJson<ConfirmNewsSourceResponse>("/api/news/sources", {
    method: "POST",
    body: input
  });
}

export async function deleteNewsCustomSource(id: string): Promise<DeleteNewsCustomSourceResponse> {
  return requestJson<DeleteNewsCustomSourceResponse>(
    `/api/news/sources/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function createNewsTopic(
  input: CreateNewsTopicRequest
): Promise<CreateNewsTopicResponse> {
  return requestJson<CreateNewsTopicResponse>("/api/news/topics", {
    method: "POST",
    body: input
  });
}

export async function deleteNewsTopic(id: string): Promise<DeleteNewsTopicResponse> {
  return requestJson<DeleteNewsTopicResponse>(`/api/news/topics/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function triggerNewsRevalidation(): Promise<TriggerNewsRevalidationResponse> {
  return requestJson<TriggerNewsRevalidationResponse>("/api/news/revalidation", {
    method: "POST"
  });
}
