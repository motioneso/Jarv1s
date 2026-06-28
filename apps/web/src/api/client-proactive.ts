import type {
  ProactiveCardsResponse,
  ProactiveMonitoringPreferenceV1,
  ProactiveMonitoringSettingsDto,
  ProactiveRefreshResponse
} from "@jarv1s/shared";

import { requestJson } from "./client.js";

export async function getProactiveCards(): Promise<ProactiveCardsResponse> {
  return requestJson<ProactiveCardsResponse>("/api/me/proactive-cards");
}

export async function refreshProactiveCards(): Promise<ProactiveRefreshResponse> {
  return requestJson<ProactiveRefreshResponse>("/api/me/proactive-cards/refresh", {
    method: "POST"
  });
}

export async function getProactiveMonitoringSettings(): Promise<ProactiveMonitoringSettingsDto> {
  return requestJson<ProactiveMonitoringSettingsDto>("/api/me/proactive-monitoring-settings");
}

export async function updateProactiveMonitoringSettings(
  patch: Partial<ProactiveMonitoringPreferenceV1>
): Promise<ProactiveMonitoringSettingsDto> {
  return requestJson<ProactiveMonitoringSettingsDto>("/api/me/proactive-monitoring-settings", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}
