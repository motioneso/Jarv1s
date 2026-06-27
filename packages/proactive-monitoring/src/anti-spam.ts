import type { DataContextDb } from "@jarv1s/db";
import type { ProactiveMonitoringPreferenceV1, ProactiveSource } from "@jarv1s/shared";

import type { CardRepository } from "./card-repository.js";
import { resolveSourcePreference } from "./preferences-repository.js";

export type AntiSpamVerdict =
  | { readonly allow: true; readonly deferredUntil: string | null }
  | { readonly allow: false; readonly reason: string };

export class AntiSpamPolicy {
  constructor(private readonly cardRepository: CardRepository) {}

  async check(
    scopedDb: DataContextDb,
    ownerUserId: string,
    source: ProactiveSource,
    stableKey: string,
    pref: ProactiveMonitoringPreferenceV1,
    nowIso: string,
    timeZone: string
  ): Promise<AntiSpamVerdict> {
    // Dismissed stable key: suppress for 30 days.
    const dismissed = await this.cardRepository.isDismissedStableKeySuppressed(
      scopedDb,
      ownerUserId,
      source,
      stableKey
    );
    if (dismissed) {
      return { allow: false, reason: "dismissed_stable_key_suppressed" };
    }

    const localDayStart = localMidnight(nowIso, timeZone);
    const counts = await this.cardRepository.getActiveCounts(
      scopedDb,
      ownerUserId,
      source,
      nowIso,
      localDayStart
    );

    // Effective source daily cap (may be reduced by too_much feedback — handled by scanner).
    const sourcePref = resolveSourcePreference(pref, source);

    // Global daily cap.
    if (counts.totalToday >= pref.dailyCardCap) {
      return { allow: false, reason: "global_daily_cap" };
    }
    // Per-source daily cap.
    if (counts.sourceToday >= sourcePref.dailyCardCap) {
      return { allow: false, reason: "source_daily_cap" };
    }
    // Per-source hourly cap.
    if (counts.sourceLastHour >= 1) {
      return { allow: false, reason: "source_hourly_cap" };
    }

    // Quiet hours deferral.
    if (pref.quietHours.enabled) {
      const deferredUntil = quietHoursDeferral(nowIso, timeZone, pref.quietHours);
      if (deferredUntil) {
        return { allow: true, deferredUntil };
      }
    }

    return { allow: true, deferredUntil: null };
  }
}

function localMidnight(nowIso: string, timeZone: string): string {
  try {
    const now = new Date(nowIso);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const year = parts.find((p) => p.type === "year")?.value ?? "2000";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return new Date(`${year}-${month}-${day}T00:00:00`).toISOString();
  } catch {
    const d = new Date(nowIso);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
}

function quietHoursDeferral(
  nowIso: string,
  timeZone: string,
  qh: { readonly startLocalTime: string; readonly endLocalTime: string }
): string | null {
  try {
    const now = new Date(nowIso);
    const localTimeStr = now.toLocaleTimeString("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    if (!isInQuietHours(localTimeStr, qh.startLocalTime, qh.endLocalTime)) return null;
    // Defer to quiet-hours end today (or tomorrow if end < start and we're before midnight).
    const localDateStr = now.toLocaleDateString("en-CA", { timeZone });
    const endLocal = parseLocalTime(localDateStr, qh.endLocalTime, timeZone);
    // If end is before now (e.g. end=08:00 and now=23:00), defer to tomorrow's end.
    if (endLocal <= now) {
      const tomorrow = new Date(localDateStr);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toLocaleDateString("en-CA");
      return parseLocalTime(tomorrowStr, qh.endLocalTime, timeZone).toISOString();
    }
    return endLocal.toISOString();
  } catch {
    return null;
  }
}

function isInQuietHours(localTime: string, start: string, end: string): boolean {
  if (start < end) {
    return localTime >= start && localTime < end;
  }
  // Wraps midnight.
  return localTime >= start || localTime < end;
}

function parseLocalTime(localDateStr: string, localTimeStr: string, timeZone: string): Date {
  const [h = 0, m = 0] = localTimeStr.split(":").map(Number);
  const dt = new Date(`${localDateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  // Adjust for timezone offset (naive approach: use the offset from Intl).
  const offset = getTimezoneOffsetMinutes(dt, timeZone);
  return new Date(dt.getTime() - offset * 60 * 1000);
}

function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
    const localStr = date.toLocaleString("en-US", { timeZone });
    return (new Date(localStr).getTime() - new Date(utcStr).getTime()) / 60000;
  } catch {
    return 0;
  }
}
