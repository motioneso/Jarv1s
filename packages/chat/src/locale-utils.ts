import { isValidTimeZone } from "@jarv1s/shared";

/** Extract an IANA timezone string from a raw locale preference blob. Returns null on any invalid input. */
export function extractTimezone(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const tz = (raw as Record<string, unknown>).timezone;
  if (typeof tz !== "string" || tz.length > 100 || !isValidTimeZone(tz)) return null;
  return tz.trim();
}
