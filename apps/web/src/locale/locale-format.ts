import { useQuery } from "@tanstack/react-query";

import type { LocaleSettingsDto } from "@jarv1s/shared";

import { getLocaleSettings } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";

/**
 * Shared user-local date/time formatting (#579).
 *
 * Every user-facing date/time renders in the user's persisted locale — IANA
 * timezone + 12/24-hour preference + BCP-47 region — sourced from the owner-scoped
 * `/api/me/locale` store (the single source of truth; see
 * packages/settings/src/locale-routes.ts). Bare `Date#toLocale*` / `Intl.DateTimeFormat`
 * resolve to the *ambient* runtime zone (the browser's, or the headless server's) and
 * are therefore wrong for the user. Route every display site through this module; the
 * `check:no-ambient-dates` gate enforces it.
 *
 * Timestamps stay UTC at rest — only their *presentation* is zoned here.
 */

/**
 * Locale used until the persisted preference loads. Mirrors the server's
 * `DEFAULT_LOCALE_SETTINGS` (packages/settings/src/locale-routes.ts) so first paint
 * matches the eventual value in the common case and never flashes an ambient-zone date.
 */
export const DEFAULT_LOCALE: LocaleSettingsDto = {
  timezone: "America/Los_Angeles",
  region: "en-US",
  dateFormat: "24"
};

type DateInput = string | number | Date;

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** On unparseable input, preserve the caller's defensive behaviour: echo a raw string, else "". */
function rawFallback(input: DateInput): string {
  return typeof input === "string" ? input : "";
}

function localeTag(region: string): string | undefined {
  const tag = region.trim();
  return tag.length > 0 ? tag : undefined;
}

function format(
  input: DateInput,
  locale: LocaleSettingsDto,
  options: Intl.DateTimeFormatOptions
): string {
  const date = toDate(input);
  if (!date) return rawFallback(input);
  try {
    return new Intl.DateTimeFormat(localeTag(locale.region), {
      timeZone: locale.timezone,
      hour12: locale.dateFormat === "12",
      ...options
    }).format(date);
  } catch {
    // Invalid IANA timezone or BCP-47 region must never throw at a render site.
    return rawFallback(input);
  }
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
};
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** Format an instant as a date in the user's locale (default: medium date). */
export function formatDate(
  input: DateInput,
  locale: LocaleSettingsDto,
  options?: Intl.DateTimeFormatOptions
): string {
  return format(input, locale, options ?? DATE_OPTS);
}

/** Format an instant as date + time in the user's locale. */
export function formatDateTime(
  input: DateInput,
  locale: LocaleSettingsDto,
  options?: Intl.DateTimeFormatOptions
): string {
  return format(input, locale, options ?? DATETIME_OPTS);
}

/** Format an instant as a time-of-day in the user's locale (honours 12/24-hour preference). */
export function formatTime(
  input: DateInput,
  locale: LocaleSettingsDto,
  options?: Intl.DateTimeFormatOptions
): string {
  return format(input, locale, options ?? TIME_OPTS);
}

/**
 * Calendar date key (`YYYY-MM-DD`) for an instant *as observed in the given timezone*.
 * Locale-independent (en-CA): a machine key for day comparison / "today" / streaks,
 * never a display string. Consolidates wellness-page's former ad-hoc `todayIso()`.
 * `timeZone` omitted → ambient zone (matches the pre-load fallback of its old callers).
 */
export function zonedDateKey(input: DateInput, timeZone?: string): string {
  const date = toDate(input);
  if (!date) return rawFallback(input);
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", options).format(date);
  }
}

/** Today's date key (`YYYY-MM-DD`) in the given timezone. */
export function todayDateKey(timeZone?: string): string {
  return zonedDateKey(new Date(), timeZone);
}

/**
 * React hook returning the user's persisted locale, falling back to {@link DEFAULT_LOCALE}
 * until `/api/me/locale` resolves. Single React-Query entry (`queryKeys.settings.locale`),
 * so the fetch is shared/deduplicated across every surface that formats dates.
 */
export function useUserLocale(): LocaleSettingsDto {
  const query = useQuery({
    queryKey: queryKeys.settings.locale,
    queryFn: () => getLocaleSettings()
  });
  return query.data?.locale ?? DEFAULT_LOCALE;
}
