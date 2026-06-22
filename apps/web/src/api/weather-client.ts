import type {
  GetWeatherLocationResponse,
  GetWeatherTodayResponse,
  PutWeatherLocationRequest
} from "@jarv1s/shared";

import { requestJson } from "./client.js";

export async function getWeatherToday(): Promise<GetWeatherTodayResponse> {
  return requestJson<GetWeatherTodayResponse>("/api/weather/today");
}

export async function getWeatherLocation(): Promise<GetWeatherLocationResponse> {
  return requestJson<GetWeatherLocationResponse>("/api/me/weather-location");
}

export async function putWeatherLocation(
  body: PutWeatherLocationRequest
): Promise<GetWeatherLocationResponse> {
  return requestJson<GetWeatherLocationResponse>("/api/me/weather-location", {
    method: "PUT",
    body
  });
}
