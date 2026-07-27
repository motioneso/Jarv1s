import { assertDataContextDb } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import type { QuietHoursSettingsDto } from "@jarv1s/shared";

// Matches quiet-hours-routes.ts's QUIET_HOURS_PREFERENCE_KEY exactly — both read/write the same preference row.
const QUIET_HOURS_PREFERENCE_KEY = "quiet-hours";
// Matches quiet-hours-routes.ts's isValidHHMM regex exactly — reused verbatim, do not redefine differently.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const preferences = new PreferencesRepository();

export const quietHoursSetInputSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string" },
    end: { type: "string" },
    timezone: { type: ["string", "null"] }
  },
  required: ["enabled", "start", "end"],
  additionalProperties: false
} as const;

export const quietHoursOutputSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string" },
    end: { type: "string" },
    timezone: { type: ["string", "null"] }
  },
  required: ["enabled", "start", "end", "timezone"],
  additionalProperties: false
} as const;

export const quietHoursSetExecute: ToolExecute = async (scopedDb, input): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const {
    enabled,
    start,
    end,
    timezone: rawTimezone
  } = input as {
    enabled: boolean;
    start: string;
    end: string;
    timezone?: string | null;
  };
  if (!HHMM.test(start)) throw new HttpError(400, "start must be HH:MM (00:00–23:59)");
  if (!HHMM.test(end)) throw new HttpError(400, "end must be HH:MM (00:00–23:59)");
  const timezone = rawTimezone && rawTimezone.trim().length > 0 ? rawTimezone.trim() : null;
  const next: QuietHoursSettingsDto = { enabled, start, end, timezone };
  const current = await preferences.getWithRevision(scopedDb, QUIET_HOURS_PREFERENCE_KEY);
  await preferences.upsertWithRevision(
    scopedDb,
    QUIET_HOURS_PREFERENCE_KEY,
    next,
    current?.revision ?? null
  );
  return { data: { ...next } };
};
