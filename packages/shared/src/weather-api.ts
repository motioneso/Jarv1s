import { errorResponseSchema } from "./schema-fragments.js";

export type WeatherIcon = "sun" | "cloud" | "cloud-sun" | "cloud-rain" | "cloud-snow" | "wind";

export interface WeatherTodayDto {
  readonly temp: number;
  readonly feelsLike: number;
  readonly condition: string;
  readonly icon: WeatherIcon;
  readonly location: string;
  readonly unit: "metric" | "imperial";
}

export interface GetWeatherTodayResponse {
  readonly data: WeatherTodayDto | null;
}

export interface WeatherLocationDto {
  readonly lat: number;
  readonly lon: number;
  readonly label: string;
}

export interface GetWeatherLocationResponse {
  readonly location: WeatherLocationDto | null;
}

export type PutWeatherLocationRequest = WeatherLocationDto | null;
export type PutWeatherLocationResponse = GetWeatherLocationResponse;

const weatherIconValues = [
  "sun",
  "cloud",
  "cloud-sun",
  "cloud-rain",
  "cloud-snow",
  "wind"
] as const;

const weatherTodaySchema = {
  type: "object",
  additionalProperties: false,
  required: ["temp", "feelsLike", "condition", "icon", "location", "unit"],
  properties: {
    temp: { type: "number" },
    feelsLike: { type: "number" },
    condition: { type: "string" },
    icon: { type: "string", enum: weatherIconValues },
    location: { type: "string" },
    unit: { type: "string", enum: ["metric", "imperial"] }
  }
} as const;

export const getWeatherTodayRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["data"],
      properties: {
        data: {
          oneOf: [weatherTodaySchema, { type: "null" }]
        }
      }
    },
    401: errorResponseSchema
  }
} as const;

const weatherLocationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lat", "lon", "label"],
  properties: {
    lat: { type: "number", minimum: -90, maximum: 90 },
    lon: { type: "number", minimum: -180, maximum: 180 },
    label: { type: "string", maxLength: 200 }
  }
} as const;

export const getWeatherLocationRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["location"],
      properties: {
        location: {
          oneOf: [weatherLocationSchema, { type: "null" }]
        }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const putWeatherLocationRouteSchema = {
  body: {
    oneOf: [weatherLocationSchema, { type: "null" }]
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["location"],
      properties: {
        location: {
          oneOf: [weatherLocationSchema, { type: "null" }]
        }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
