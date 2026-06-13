import type { Medication, MedicationLog } from "@jarv1s/db";
import type { ScheduleSlotDto } from "@jarv1s/shared";

/**
 * Pure: given the actor's medications, their same-day dose logs, and a target date,
 * produce an ordered list of schedule slots. Scheduled (non-PRN) meds emit one slot per
 * schedule_time that applies on `date`; as_needed meds emit a single asNeeded affordance.
 * A slot is "taken"/"skipped" if a same-day log has a matching scheduled_for (same clock
 * minute) for that medication, else "pending".
 *
 * Timezone model (deliberate, documented — Codex R1): this uses NAIVE CIVIL time. The
 * caller (web) sends its OWN LOCAL civil date (`YYYY-MM-DD`) as `?date=`; the server parses
 * it as a UTC midnight anchor and builds each slot by attaching the med's civil clock time
 * (`schedule_times`, a `time[]`) to that anchor IN UTC. Because both the slot instant and
 * the matched log's `scheduled_for` are constructed the same civil-as-UTC way, the
 * minute-level match is correct, and the displayed `HH:MM` (via `.slice(11,16)`) shows the
 * civil clock time the user entered. The only requirement is that the client sends its LOCAL
 * date (not a UTC date) so a near-midnight check lands on the right civil day. True
 * per-user-timezone scheduling (DST-aware absolute instants) is explicitly out of scope.
 */
export function computeSchedule(
  medications: readonly Medication[],
  logs: readonly MedicationLog[],
  date: Date
): ScheduleSlotDto[] {
  const slots: ScheduleSlotDto[] = [];
  const isoWeekday = isoWeekdayOf(date);

  for (const med of medications) {
    if (!med.active) continue;

    if (med.frequency_type === "as_needed") {
      slots.push({
        medicationId: med.id,
        name: med.name,
        scheduledFor: null,
        asNeeded: true,
        status: "pending"
      });
      continue;
    }

    if (med.frequency_type === "specific_weekdays") {
      const weekdays = med.weekdays ?? [];
      if (!weekdays.includes(isoWeekday)) continue;
    }

    if (med.frequency_type === "cyclical" && !isCyclicalOnDay(med, date)) {
      continue;
    }

    // every_n_hours generates slots from interval_hours, anchored at the optional first
    // schedule_time (else civil midnight), stepping across the civil day. All other
    // scheduled families emit one slot per enumerated schedule_time.
    const slotInstants =
      med.frequency_type === "every_n_hours"
        ? intervalSlots(date, med.interval_hours, med.schedule_times)
        : (med.schedule_times ?? []).map((time) => combineDateAndTime(date, time));

    for (const scheduledFor of slotInstants) {
      slots.push({
        medicationId: med.id,
        name: med.name,
        scheduledFor: scheduledFor.toISOString(),
        asNeeded: false,
        status: slotStatusFromLogs(med.id, scheduledFor, logs)
      });
    }
  }

  return slots.sort((a, b) => {
    if (a.asNeeded !== b.asNeeded) return a.asNeeded ? 1 : -1;
    return (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? "");
  });
}

/**
 * Civil-day slots for an every_n_hours med. Anchored at the optional first schedule_time
 * (e.g. "06:00" → first dose at 06:00, then every interval); absent any schedule_time it
 * anchors at civil midnight. Steps forward by interval_hours and emits every slot whose
 * civil instant falls strictly before the next civil midnight. interval_hours is validated
 * 1–24 at the route + DB; an absent/<=0 interval yields no slots (defensive, never throws).
 */
function intervalSlots(
  date: Date,
  intervalHours: number | null,
  scheduleTimes: readonly string[] | null
): Date[] {
  if (!intervalHours || intervalHours <= 0) return [];
  const anchorTime = scheduleTimes?.[0];
  const start = anchorTime
    ? combineDateAndTime(date, anchorTime)
    : combineDateAndTime(date, "00:00");
  const dayEnd = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0
  );
  const slots: Date[] = [];
  const stepMs = intervalHours * 60 * 60 * 1000;
  for (let t = start.getTime(); t < dayEnd; t += stepMs) {
    slots.push(new Date(t));
  }
  return slots;
}

function isoWeekdayOf(date: Date): number {
  const day = date.getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

function combineDateAndTime(date: Date, time: string): Date {
  const [hh, mm] = time.split(":");
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      Number(hh ?? 0),
      Number(mm ?? 0),
      0
    )
  );
}

function slotStatusFromLogs(
  medicationId: string,
  scheduledFor: Date,
  logs: readonly MedicationLog[]
): "pending" | "taken" | "skipped" {
  const target = scheduledFor.getTime();
  for (const log of logs) {
    if (log.medication_id !== medicationId) continue;
    if (!log.scheduled_for) continue;
    const logged =
      log.scheduled_for instanceof Date ? log.scheduled_for : new Date(log.scheduled_for);
    if (Math.abs(logged.getTime() - target) < 60_000) {
      if (log.status === "taken") return "taken";
      if (log.status === "skipped") return "skipped";
    }
  }
  return "pending";
}

function isCyclicalOnDay(med: Medication, date: Date): boolean {
  if (!med.cycle_anchor_date || !med.cycle_days_on) return true;
  const anchor = new Date(`${med.cycle_anchor_date}T00:00:00.000Z`);
  const cycleLength = med.cycle_days_on + (med.cycle_days_off ?? 0);
  if (cycleLength <= 0) return true;
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsed = Math.floor((date.getTime() - anchor.getTime()) / dayMs);
  if (elapsed < 0) return false;
  return elapsed % cycleLength < med.cycle_days_on;
}
