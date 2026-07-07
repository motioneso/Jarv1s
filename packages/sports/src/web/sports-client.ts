import type {
  CreateSportsFollowRequest,
  SportsCatalogResponse,
  SportsFollowDto,
  SportsFollowsResponse,
  SportsOverviewResponse,
  SportsStandingsResponse
} from "@jarv1s/shared";

import { requestJson } from "@jarv1s/module-web-sdk";

export async function getSportsOverview(): Promise<SportsOverviewResponse> {
  return requestJson<SportsOverviewResponse>("/api/sports/overview");
}

export async function getSportsCatalog(): Promise<SportsCatalogResponse> {
  return requestJson<SportsCatalogResponse>("/api/sports/catalog");
}

export async function listSportsFollows(): Promise<SportsFollowsResponse> {
  return requestJson<SportsFollowsResponse>("/api/sports/follows");
}

export async function getStandingsByLeague(
  competitionKey: string
): Promise<SportsStandingsResponse> {
  return requestJson<SportsStandingsResponse>(
    `/api/sports/standings?competitionKey=${encodeURIComponent(competitionKey)}`
  );
}

export async function createSportsFollow(
  input: CreateSportsFollowRequest
): Promise<{ follow: SportsFollowDto }> {
  return requestJson<{ follow: SportsFollowDto }>("/api/sports/follows", {
    method: "POST",
    body: input
  });
}

export async function deleteSportsFollow(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/sports/follows/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
