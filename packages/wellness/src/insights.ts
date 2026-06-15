// Pure derivation of wellness insights. No I/O — fully unit-testable.
// Faithfully ports wellness-data.js computeInsights() from the design.

import {
  EMOTION_POLARITY,
  type WellnessEmotionCore,
  type WellnessInsightDto
} from "@jarv1s/shared";
import type { Medication, MedicationLog, WellnessCheckin } from "@jarv1s/db";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

export function computeInsights(
  checkins: readonly WellnessCheckin[],
  logs: readonly MedicationLog[],
  meds: readonly Medication[],
  _now: Date,
  totalExpectedSlots?: number
): WellnessInsightDto[] {
  // Low-data guard: suppress all insights until there is at least a week's
  // worth of check-ins. Threshold: ≥7 check-ins AND earliest is ≥7 days ago.
  // Rationale: adherence/pattern insights derived from <7 data points produce
  // misleading numbers (e.g. "0% adherence" with 0 scheduled meds).
  const MIN_CHECKINS = 7;
  const MIN_DAYS = 7;
  if (checkins.length < MIN_CHECKINS) return [];
  const earliest = checkins
    .map((c) => (c.checked_in_at ? new Date(c.checked_in_at).getTime() : Infinity))
    .reduce((a, b) => Math.min(a, b), Infinity);
  const daysSinceFirst = (_now.getTime() - earliest) / 86_400_000;
  if (daysSinceFirst < MIN_DAYS) return [];

  const results: WellnessInsightDto[] = [];

  // ── 1. Most-logged emotion (key: 'common') ─────────────────────────────
  const coreTally = new Map<WellnessEmotionCore, number>();
  for (const c of checkins) {
    if (c.feeling_core) {
      const core = c.feeling_core as WellnessEmotionCore;
      coreTally.set(core, (coreTally.get(core) ?? 0) + 1);
    }
  }
  if (coreTally.size > 0) {
    let topCore: WellnessEmotionCore | undefined;
    let topCount = 0;
    for (const [core, count] of coreTally) {
      if (count > topCount) {
        topCount = count;
        topCore = core;
      }
    }
    if (topCore !== undefined) {
      const polarity = EMOTION_POLARITY[topCore] ?? 0;
      const tone: WellnessInsightDto["tone"] = polarity > 0 ? "pine" : "amber";
      const capitalized = topCore.charAt(0).toUpperCase() + topCore.slice(1);
      results.push({
        key: "common",
        icon: "Activity",
        tone,
        lead: capitalized,
        rest: ` was your most-logged feeling this month — ${topCount.toString()} of ${checkins.length.toString()} check-ins.`,
        emotion: topCore
      });
    }
  }

  // ── 2. Hardest / strongest weekday ────────────────────────────────────
  // Group checkins by ISO day-of-week (0=Sun ... 6=Sat via getUTCDay)
  interface DayBucket {
    total: number;
    offCount: number;
    onCount: number;
  }
  const dayBuckets = new Map<number, DayBucket>();
  for (const c of checkins) {
    const date = c.checked_in_at ? new Date(c.checked_in_at) : null;
    if (!date) continue;
    const dow = date.getUTCDay();
    const existing = dayBuckets.get(dow) ?? { total: 0, offCount: 0, onCount: 0 };
    const polarity = EMOTION_POLARITY[c.feeling_core as WellnessEmotionCore] ?? 0;
    const onTrack = polarity > 0;
    dayBuckets.set(dow, {
      total: existing.total + 1,
      offCount: existing.offCount + (onTrack ? 0 : 1),
      onCount: existing.onCount + (onTrack ? 1 : 0)
    });
  }

  // Only consider weekdays with >= 2 check-ins
  let hardestDow: number | undefined;
  let hardestOffPct = 0;
  let hardestTotal = 0;
  let strongestDow: number | undefined;
  let strongestOnPct = 0;
  let strongestTotal = 0;

  for (const [dow, bucket] of dayBuckets) {
    if (bucket.total < 2) continue;
    const offPct = Math.round((bucket.offCount / bucket.total) * 100);
    const onPct = Math.round((bucket.onCount / bucket.total) * 100);

    if (offPct >= 80) {
      if (offPct > hardestOffPct || (offPct === hardestOffPct && bucket.total > hardestTotal)) {
        hardestDow = dow;
        hardestOffPct = offPct;
        hardestTotal = bucket.total;
      }
    }
    if (onPct >= 80) {
      if (onPct > strongestOnPct || (onPct === strongestOnPct && bucket.total > strongestTotal)) {
        strongestDow = dow;
        strongestOnPct = onPct;
        strongestTotal = bucket.total;
      }
    }
  }

  if (hardestDow !== undefined) {
    const bucket = dayBuckets.get(hardestDow)!;
    const offPct = Math.round((bucket.offCount / bucket.total) * 100);
    const dayName = DAY_NAMES[hardestDow]!;
    results.push({
      key: "hardest",
      icon: "CloudRain",
      tone: "amber",
      lead: `${dayName}s`,
      rest: ` tend to be hardest — ${offPct.toString()}% of them landed in off-track states. Worth a gentler plan.`
    });
  }

  if (strongestDow !== undefined) {
    const bucket = dayBuckets.get(strongestDow)!;
    const onPct = Math.round((bucket.onCount / bucket.total) * 100);
    const dayName = DAY_NAMES[strongestDow]!;
    results.push({
      key: "strongest",
      icon: "Sun",
      tone: "pine",
      lead: `${dayName}s`,
      rest: ` are your strongest day — ${onPct.toString()}% on-track check-ins.`
    });
  }

  // ── 3. Notes worth reviewing (key: 'notes') ────────────────────────────
  const noteworthyCheckins = checkins.filter(
    (c) =>
      (c.feeling_core === "sad" || c.feeling_core === "anger") &&
      c.note !== null &&
      c.note !== undefined &&
      c.note !== ""
  );
  if (noteworthyCheckins.length > 0) {
    const n = noteworthyCheckins.length;
    const plural = n > 1 ? "s" : "";
    results.push({
      key: "notes",
      icon: "NotebookPen",
      tone: "steel",
      lead: `${n.toString()} sad or angry check-in${plural}`,
      rest: " carry a note. Reading them together may surface a recurring trigger.",
      action: "review-notes"
    });
  }

  // ── 4. 30-day medication adherence (key: 'adherence') ─────────────────
  const scheduledMedIds = new Set(
    meds.filter((m) => m.frequency_type !== "as_needed").map((m) => m.id)
  );
  const scheduledLogs = logs.filter(
    (l) => l.scheduled_for !== null && scheduledMedIds.has(l.medication_id)
  );
  const takenCount = scheduledLogs.filter((l) => l.status === "taken").length;
  // Use pre-computed expected slots (from computeSchedule across window) when provided so
  // missed doses (no log row) are counted in the denominator — not just logged rows.
  const totalScheduled = totalExpectedSlots ?? scheduledLogs.length;
  const adh = totalScheduled > 0 ? Math.round((takenCount / totalScheduled) * 100) : 0;
  const adhTone: WellnessInsightDto["tone"] = adh >= 85 ? "pine" : "amber";
  results.push({
    key: "adherence",
    icon: "Pill",
    tone: adhTone,
    lead: `${adh.toString()}% adherence`,
    rest:
      " on your medication over the last 30 days" +
      (adh >= 85 ? " — steady." : " — a few evening doses slipped.")
  });

  return results;
}
