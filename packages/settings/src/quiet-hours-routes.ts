import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getQuietHoursSettingsRouteSchema,
  putQuietHoursSettingsRouteSchema,
  type PutQuietHoursSettingsRequest,
  type QuietHoursSettingsDto
} from "@jarv1s/shared";
import { HttpError } from "@jarv1s/module-sdk";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

const QUIET_HOURS_PREFERENCE_KEY = "quiet-hours";
const DEFAULT_QUIET_HOURS: QuietHoursSettingsDto = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timezone: null
};

interface QuietHoursRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function registerQuietHoursRoutes(
  server: FastifyInstance,
  dependencies: QuietHoursRoutesDependencies
): void {
  server.get(
    "/api/me/quiet-hours",
    { schema: getQuietHoursSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, QUIET_HOURS_PREFERENCE_KEY)
        );
        return { quietHours: normalizeQuietHours(raw) };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/me/quiet-hours",
    { schema: putQuietHoursSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutQuietHoursSettingsRequest;
        const quietHours = sanitizeQuietHours(body.quietHours);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(
            scopedDb,
            QUIET_HOURS_PREFERENCE_KEY,
            quietHours
          )
        );
        return { quietHours };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

function normalizeQuietHours(value: unknown): QuietHoursSettingsDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_QUIET_HOURS;
  const r = value as Record<string, unknown>;
  const enabled = typeof r.enabled === "boolean" ? r.enabled : DEFAULT_QUIET_HOURS.enabled;
  const start = isValidHHMM(r.start) ? r.start : DEFAULT_QUIET_HOURS.start;
  const end = isValidHHMM(r.end) ? r.end : DEFAULT_QUIET_HOURS.end;
  const timezone =
    typeof r.timezone === "string" && r.timezone.length > 0 && r.timezone.length <= 100
      ? r.timezone
      : null;
  return { enabled, start, end, timezone };
}

function sanitizeQuietHours(dto: QuietHoursSettingsDto): QuietHoursSettingsDto {
  if (!isValidHHMM(dto.start)) throw new HttpError(400, "start must be HH:MM (00:00–23:59)");
  if (!isValidHHMM(dto.end)) throw new HttpError(400, "end must be HH:MM (00:00–23:59)");
  const timezone =
    dto.timezone !== null && dto.timezone !== undefined && dto.timezone.trim().length > 0
      ? dto.timezone.trim()
      : null;
  return { enabled: dto.enabled, start: dto.start, end: dto.end, timezone };
}

function isValidHHMM(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
