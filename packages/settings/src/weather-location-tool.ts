import { randomUUID } from "node:crypto";

import { assertDataContextDb } from "@moss/db";
import { HttpError } from "@moss/module-sdk";
import type { ToolExecute, ToolResult } from "@moss/module-sdk";
import { PreferencesRepository } from "@moss/structured-state";
import type { WeatherLocationDto } from "@moss/shared";

import { settingsUndoStack } from "./undo-stack.js";

// Matches weather-location-routes.ts's WEATHER_LOCATION_PREFERENCE_KEY exactly.
const WEATHER_LOCATION_PREFERENCE_KEY = "weather-location";

const preferences = new PreferencesRepository();

export const weatherLocationSetInputSchema = {
  type: "object",
  properties: {
    lat: { type: "number" },
    lon: { type: "number" },
    label: { type: "string", minLength: 1 }
  },
  required: ["lat", "lon", "label"],
  additionalProperties: false
} as const;

export const weatherLocationOutputSchema = {
  type: "object",
  properties: { lat: { type: "number" }, lon: { type: "number" }, label: { type: "string" } },
  required: ["lat", "lon", "label"],
  additionalProperties: false
} as const;

export const weatherLocationSetExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { lat, lon, label } = input as { lat: number; lon: number; label: string };
  if (lat < -90 || lat > 90) throw new HttpError(400, "Latitude out of range");
  if (lon < -180 || lon > 180) throw new HttpError(400, "Longitude out of range");
  const next: WeatherLocationDto = { lat, lon, label: label.trim().slice(0, 200) };
  const current = await preferences.getWithRevision(scopedDb, WEATHER_LOCATION_PREFERENCE_KEY);
  const currentValue = current?.value as WeatherLocationDto | undefined;
  if (
    currentValue &&
    currentValue.lat === next.lat &&
    currentValue.lon === next.lon &&
    currentValue.label === next.label
  ) {
    return { data: { ...next } };
  }
  const written = await preferences.upsertWithRevision(
    scopedDb,
    WEATHER_LOCATION_PREFERENCE_KEY,
    next,
    current?.revision ?? null
  );
  settingsUndoStack.push(ctx.actorUserId, ctx.chatSessionId, {
    mutationId: randomUUID(),
    key: WEATHER_LOCATION_PREFERENCE_KEY,
    previousValue: current?.value ?? null,
    previousRevision: current?.revision ?? null,
    resultingRevision: written.revision,
    appliedAt: Date.now()
  });
  return { data: { ...next } };
};
