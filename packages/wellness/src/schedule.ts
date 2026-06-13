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

    const times = med.schedule_times ?? [];
    for (const time of times) {
      const scheduledFor = combineDateAndTime(date, time);
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
