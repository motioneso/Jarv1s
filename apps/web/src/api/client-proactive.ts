import type { ProactiveCardsResponse } from "@moss/shared";

import { requestJson } from "./client.js";

export async function getProactiveCards(): Promise<ProactiveCardsResponse> {
  return requestJson<ProactiveCardsResponse>("/api/me/proactive-cards");
}
