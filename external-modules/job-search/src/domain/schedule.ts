// external-modules/job-search/src/domain/schedule.ts
//
// JS-05 (#934): DST-safe due-check math + per-monitor schedule state.
// All comparisons are STRING comparisons on Intl-derived local dates/times
// ("YYYY-MM-DD" / "HH:MM"), never epoch arithmetic, so the DST cases fall
// out for free:
//   - spring forward (a due time inside the skipped hour): the first hourly
//     tick after the jump sees local time >= dueTime and runs — one run,
//     same local day.
//   - fall back (an hour repeats): the first pass writes
//     lastCompletedLocalDate; the repeated hour compares equal-date → no-op.
//   - downtime / no catch-up: isDue compares only the CURRENT local date;
//     missed days are never replayed.
// lastCompletedLocalDate is written ONLY after a successful scheduled run —
// run-now never consumes the local-day slot (spec: run-now is additive).
import { JobSearchKvError } from "./errors.js";
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";

export interface MonitorScheduleState {
  schemaVersion: 1;
  monitorId: string;
  /** Local calendar date ("YYYY-MM-DD" in the monitor's zone) of the last completed scheduled run. */
  lastCompletedLocalDate: string;
}

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_DUE_TIME = "07:00";
export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True iff this runtime's Intl accepts the zone (authoritative IANA check). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant `now` expressed as the monitor's local calendar date and
 * wall-clock time. hourCycle "h23" pins midnight to "00" — some ICU builds
 * render hour 24 under plain hour12:false, which would break the string
 * comparisons in isDue.
 */
export function localDateAndTime(now: Date, timeZone: string): { date: string; time: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
  } catch {
    // Corrupt stored zone: surface a FIXED domain message the run loop can
    // record per-monitor — never the raw Intl error (it echoes the value).
    throw new JobSearchKvError("invalid_record", "timezone is not a valid IANA time zone");
  }
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

/**
 * Scheduled due-check: run when the local wall clock has passed the due time
 * AND today's local date hasn't already completed. String `>=` on "HH:MM"
 * and `!==` on "YYYY-MM-DD" — see the file header for why this is DST-safe.
 */
export function isDue(input: {
  now: Date;
  timeZone: string;
  dueTime: string;
  lastCompletedLocalDate?: string;
}): boolean {
  const local = localDateAndTime(input.now, input.timeZone);
  return local.time >= input.dueTime && local.date !== input.lastCompletedLocalDate;
}

export async function getScheduleState(
  kv: JobSearchKv,
  monitorId: string
): Promise<MonitorScheduleState | null> {
  assertId(monitorId);
  const record = await readRecord(kv, NS.monitors, keys.monitorSchedule(monitorId));
  return record as MonitorScheduleState | null;
}

export async function saveScheduleState(
  kv: JobSearchKv,
  state: MonitorScheduleState
): Promise<void> {
  assertId(state.monitorId);
  await writeRecord(kv, NS.monitors, keys.monitorSchedule(state.monitorId), state);
}
