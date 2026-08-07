import type { GetWeatherTodayResponse } from "@moss/shared";

import { requestJson } from "./client.js";

export async function getWeatherToday(): Promise<GetWeatherTodayResponse> {
  return requestJson<GetWeatherTodayResponse>("/api/weather/today");
}
