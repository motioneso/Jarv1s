import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getWeatherLocationRouteSchema,
  putWeatherLocationRouteSchema,
  type PutWeatherLocationRequest,
  type WeatherLocationDto
} from "@jarv1s/shared";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

const WEATHER_LOCATION_PREFERENCE_KEY = "weather-location";

interface WeatherLocationRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function registerWeatherLocationRoutes(
  server: FastifyInstance,
  dependencies: WeatherLocationRoutesDependencies
): void {
  server.get(
    "/api/me/weather-location",
    { schema: getWeatherLocationRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, WEATHER_LOCATION_PREFERENCE_KEY)
        );
        return { location: normalizeWeatherLocation(raw) };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/me/weather-location",
    { schema: putWeatherLocationRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutWeatherLocationRequest;
        const location = body == null ? null : sanitizeWeatherLocation(body);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(
            scopedDb,
            WEATHER_LOCATION_PREFERENCE_KEY,
            location
          )
        );
        return { location };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

function normalizeWeatherLocation(value: unknown): WeatherLocationDto | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const lat = typeof r.lat === "number" ? r.lat : null;
  const lon = typeof r.lon === "number" ? r.lon : null;
  const label = typeof r.label === "string" ? r.label.trim() : null;
  if (lat == null || lon == null || !label) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, label };
}

function sanitizeWeatherLocation(body: WeatherLocationDto): WeatherLocationDto {
  return {
    lat: body.lat,
    lon: body.lon,
    label: body.label.trim().slice(0, 200)
  };
}
