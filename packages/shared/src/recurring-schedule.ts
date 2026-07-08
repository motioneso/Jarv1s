const DEFAULT_TARGET_TIME_CRON = "0 7 * * *";
const DEFAULT_TIMEZONE = "UTC";

export function cronExprFor(cadence: string, scheduleMetadata: Record<string, unknown>): string {
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

  if (cadence === "weekly") {
    const day = typeof scheduleMetadata.dayOfWeek === "number" ? scheduleMetadata.dayOfWeek : 1;
    return `${minute} ${hour} * * ${day}`;
  }

  return `${minute} ${hour} * * *`;
}

export function timezoneFor(scheduleMetadata: Record<string, unknown>): string {
  const raw = scheduleMetadata.timezone;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(0);
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
