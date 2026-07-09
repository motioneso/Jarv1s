import type {
  CreateNewsPrefRequest,
  NewsCatalogResponse,
  NewsOverviewResponse,
  NewsPrefDto,
  NewsPrefsResponse
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
