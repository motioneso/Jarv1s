/** Extract an IANA timezone string from a raw locale preference blob. Returns null on any invalid input. */
export function extractTimezone(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const tz = (raw as Record<string, unknown>).timezone;
  if (typeof tz !== "string" || tz.trim().length === 0 || tz.length > 100) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }); // throws RangeError on invalid tz
    return tz.trim();
  } catch {
    return null;
  }
}
