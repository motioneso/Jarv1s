export type PartOfDay = "morning" | "afternoon" | "evening";

export interface FocusBlockInput {
  readonly date?: string; // ISO yyyy-mm-dd, local
  readonly partOfDay?: PartOfDay;
  readonly start?: string; // ISO datetime
  readonly durationMinutes?: number;
  readonly title?: string;
}

export interface ResolvedWindow {
  readonly start: Date;
  readonly end: Date;
  readonly durationMinutes: number;
  readonly title: string;
}

export interface SlotChoice {
  readonly start: Date;
  readonly end: Date;
  readonly shifted: boolean;
  readonly conflict: "none" | "shifted" | "no-clear-slot";
}

const MIN_DURATION = 15;
const MAX_DURATION = 480;
const DEFAULT_DURATION = 120;
const DEFAULT_TITLE = "Focus time";

// Local-time part-of-day bands [startHour, endHour) in the calendar's timezone.
const BANDS: Record<PartOfDay, { startHour: number; endHour: number }> = {
  morning: { startHour: 9, endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening: { startHour: 17, endHour: 21 }
};

function clampDuration(d: number | undefined): number {
  const v = typeof d === "number" && Number.isFinite(d) ? Math.trunc(d) : DEFAULT_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, v));
}

/**
 * Returns the UTC offset (minutes) of `tz` at instant `at`, by comparing the wall-clock
 * the zone reports against the same fields read as UTC. Positive = east of UTC.
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * Splits a yyyy-mm-dd string into numeric [year, month, day]. Returns a fixed-length
 * tuple of `number` (not `number | undefined`) so callers satisfy noUncheckedIndexedAccess;
 * missing parts coerce to NaN, which the calendar-date round-trip check in resolveWindow rejects.
 */
function parseDateParts(dateIso: string): [number, number, number] {
  const parts = dateIso.split("-");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Builds the UTC Date for wall-clock yyyy-mm-dd HH:00 local in `tz`. */
function localWallClockToUtc(dateIso: string, hour: number, tz: string): Date {
  const [y, m, d] = parseDateParts(dateIso);
  // First approximation assuming UTC, then correct by the zone offset at that instant.
  const naiveUtc = Date.UTC(y, m - 1, d, hour, 0, 0);
  const offset = tzOffsetMinutes(tz, new Date(naiveUtc));
  return new Date(naiveUtc - offset * 60_000);
}

/** yyyy-mm-dd of `at` in `tz`. */
function localDateString(at: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return dtf.format(at); // en-CA yields yyyy-mm-dd
}

function addDaysLocal(dateIso: string, days: number): string {
  const [y, m, d] = parseDateParts(dateIso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class FocusBlockInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusBlockInputError";
  }
}

export function resolveWindow(input: FocusBlockInput, now: Date, tz: string): ResolvedWindow {
  const durationMinutes = clampDuration(input.durationMinutes);
  const title = input.title?.trim() ? input.title.trim() : DEFAULT_TITLE;

  // Handler-side validation: the gateway validator does NOT enforce format/pattern (issue #133),
  // so reject a malformed start/date HERE — before any approval card or Google call (Codex MED #5).
  if (input.start) {
    const start = new Date(input.start);
    if (Number.isNaN(start.getTime())) {
      throw new FocusBlockInputError("start must be a valid RFC3339 datetime");
    }
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return { start, end, durationMinutes, title };
  }

  if (input.date !== undefined) {
    if (!DATE_RE.test(input.date)) {
      throw new FocusBlockInputError("date must be in yyyy-mm-dd format");
    }
    // DATE_RE only checks shape; Date.UTC NORMALIZES overflow (2026-99-99 → a real later date),
    // so reject any date whose components don't ROUND-TRIP (Codex LOW #20).
    const [y, m, d] = parseDateParts(input.date);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw new FocusBlockInputError("date is not a valid calendar date");
    }
  }
  const part = input.partOfDay ?? "morning";
  const band = BANDS[part];
  const dateIso = input.date ?? addDaysLocal(localDateString(now, tz), 1);
  const start = localWallClockToUtc(dateIso, band.startHour, tz);
  const end = localWallClockToUtc(dateIso, band.endHour, tz);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new FocusBlockInputError("date is not a valid calendar date");
  }
  return { start, end, durationMinutes, title };
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

export function chooseSlot(
  window: ResolvedWindow,
  busy: ReadonlyArray<{ start: string; end: string }>,
  durationMinutes: number,
  options: { stepMinutes?: number } = {}
): SlotChoice {
  const step = (options.stepMinutes ?? 15) * 60_000;
  const durMs = durationMinutes * 60_000;
  const winStart = window.start.getTime();
  const winEnd = window.end.getTime();

  const intervals: Interval[] = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => b.end > winStart && b.start < winEnd)
    .sort((a, b) => a.start - b.start);

  const overlaps = (s: number, e: number): boolean =>
    intervals.some((b) => b.start < e && b.end > s);

  for (let candidate = winStart; candidate + durMs <= winEnd; candidate += step) {
    const candEnd = candidate + durMs;
    if (!overlaps(candidate, candEnd)) {
      const shifted = candidate !== winStart;
      return {
        start: new Date(candidate),
        end: new Date(candEnd),
        shifted,
        conflict: shifted ? "shifted" : "none"
      };
    }
  }

  return {
    start: window.start,
    end: new Date(winStart + durMs),
    shifted: false,
    conflict: "no-clear-slot"
  };
}
