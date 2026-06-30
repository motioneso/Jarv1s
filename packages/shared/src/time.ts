/**
 * Single source of truth for timezone-aware day/time derivation (#579, #636).
 *
 * Pure and node-free so it lives in the browser-bundled @jarv1s/shared package —
 * also consumed by Node server packages (chat, tasks, wellness) that need the
 * same Intl-only logic without duplicating it.
 *
 * `localDay` is the only sanctioned way to derive a calendar day from an instant.
 * Never compute a day with `.slice(0,10)` on a UTC ISO string, `Date.UTC(...)` day
 * boundaries, or `getUTC*` date parts — those derive the UTC day, not the user's.
 */

type DateInput = string | number | Date;

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** On unparseable input, preserve the caller's defensive behaviour: echo a raw string, else "". */
function rawFallback(input: DateInput): string {
  return typeof input === "string" ? input : "";
}

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const DAY_KEY_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
};

/**
 * Calendar date key (`YYYY-MM-DD`) for an instant *as observed in the given timezone*.
 * Locale-independent (en-CA): a machine key for day comparison / "today" / streaks,
 * never a display string. Falls back to the ambient zone if `timeZone` is invalid.
 */
export function localDay(input: DateInput, timeZone?: string): string {
  const date = toDate(input);
  if (!date) return rawFallback(input);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...DAY_KEY_OPTS }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", DAY_KEY_OPTS).format(date);
  }
}

/**
 * Format an instant in the given IANA timezone — the only sanctioned formatter for
 * user-facing date/time display. Returns a raw-string echo (or "") on an
 * unparseable instant or an invalid timezone/locale; never throws.
 */
export function formatInZone(
  input: DateInput,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  const date = toDate(input);
  if (!date) return rawFallback(input);
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date);
  } catch {
    return rawFallback(input);
  }
}
