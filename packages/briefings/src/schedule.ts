const DEFAULT_TARGET_TIME_CRON = "0 7 * * *";
const DEFAULT_TIMEZONE = "UTC";

/**
 * Derive a daily cron expression from `schedule_metadata.targetTime` ("HH:MM").
 * Defaults to 07:00 local when absent or malformed. Daily cadence only — weekly
 * is out of scope for this slice.
 */
export function cronExprFor(scheduleMetadata: Record<string, unknown>): string {
  const raw = scheduleMetadata.targetTime;
  if (typeof raw !== "string") {
    return DEFAULT_TARGET_TIME_CRON;
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    return DEFAULT_TARGET_TIME_CRON;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return `${minute} ${hour} * * *`;
}

/**
 * Read an IANA timezone from `schedule_metadata.timezone`, validated via
 * Intl.DateTimeFormat. Defaults to UTC when absent or invalid.
 */
export function timezoneFor(scheduleMetadata: Record<string, unknown>): string {
  const raw = scheduleMetadata.timezone;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_TIMEZONE;
  }
  try {
    // Throws RangeError for an unknown timezone — that is our validity check.
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(0);
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
