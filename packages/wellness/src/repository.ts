import { sql } from "kysely";

import {
  assertDataContextDb,
  type DataContextDb,
  type Medication,
  type MedicationLog,
  type WellnessCheckin
} from "@jarv1s/db";
import type {
  MedicationFrequencyTypeApi,
  MedicationLogStatusApi,
  WellnessFeelingCore
} from "@jarv1s/shared";

export interface CreateCheckinInput {
  readonly feelingCore: WellnessFeelingCore;
  readonly feelingSecondary?: string | null;
  readonly feelingTertiary?: string | null;
  readonly sensations?: readonly string[];
  readonly intensity?: number | null;
  readonly energy?: number | null;
  readonly note?: string | null;
  readonly identifiedVia?: "wheel" | "assisted";
}

export interface ListCheckinsOptions {
  readonly since?: Date;
  readonly limit?: number;
}

export interface CreateMedicationInput {
  readonly name: string;
  readonly dosage?: string | null;
  readonly form?: string | null;
  readonly frequencyType: MedicationFrequencyTypeApi;
  readonly timesPerDay?: number | null;
  readonly intervalHours?: number | null;
  readonly weekdays?: readonly number[] | null;
  readonly scheduleTimes?: readonly string[] | null;
  readonly cycleDaysOn?: number | null;
  readonly cycleDaysOff?: number | null;
  readonly cycleAnchorDate?: string | null;
  readonly notes?: string | null;
}

export interface UpdateMedicationInput {
  readonly name?: string;
  readonly dosage?: string | null;
  readonly form?: string | null;
  readonly active?: boolean;
  readonly notes?: string | null;
}

export interface LogDoseInput {
  readonly status: MedicationLogStatusApi;
  readonly dose?: string | null;
  readonly prnReason?: string | null;
  readonly scheduledFor?: string | null;
}

export class WellnessRepository {
  // ── Check-ins ──────────────────────────────────────────────────────────
  async createCheckin(
    scopedDb: DataContextDb,
    input: CreateCheckinInput
  ): Promise<WellnessCheckin> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .insertInto("app.wellness_checkins")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        feeling_core: input.feelingCore,
        feeling_secondary: input.feelingSecondary ?? null,
        feeling_tertiary: input.feelingTertiary ?? null,
        sensations: [...(input.sensations ?? [])],
        intensity: input.intensity ?? null,
        energy: input.energy ?? null,
        note: input.note ?? null,
        identified_via: input.identifiedVia ?? "wheel"
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as WellnessCheckin;
  }

  async listCheckins(
    scopedDb: DataContextDb,
    options: ListCheckinsOptions = {}
  ): Promise<WellnessCheckin[]> {
    assertDataContextDb(scopedDb);
    let query = scopedDb.db
      .selectFrom("app.wellness_checkins")
      .selectAll()
      .orderBy("checked_in_at", "desc");
    if (options.since) query = query.where("checked_in_at", ">=", options.since);
    query = query.limit(options.limit ?? 50);
    const rows = await query.execute();
    return rows as WellnessCheckin[];
  }

  // ── Medications ────────────────────────────────────────────────────────
  async createMedication(
    scopedDb: DataContextDb,
    input: CreateMedicationInput
  ): Promise<Medication> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .insertInto("app.medications")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        name: input.name,
        dosage: input.dosage ?? null,
        form: input.form ?? null,
        frequency_type: input.frequencyType,
        times_per_day: input.timesPerDay ?? null,
        interval_hours: input.intervalHours ?? null,
        weekdays: input.weekdays ? [...input.weekdays] : null,
        schedule_times: input.scheduleTimes ? [...input.scheduleTimes] : null,
        cycle_days_on: input.cycleDaysOn ?? null,
        cycle_days_off: input.cycleDaysOff ?? null,
        cycle_anchor_date: input.cycleAnchorDate ?? null,
        notes: input.notes ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as Medication;
  }

  async listMedications(scopedDb: DataContextDb): Promise<Medication[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.medications")
      .selectAll()
      .orderBy("active", "desc")
      .orderBy("name", "asc")
      .execute();
    return rows as Medication[];
  }

  async getMedication(scopedDb: DataContextDb, id: string): Promise<Medication | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.medications")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row as Medication | undefined;
  }

  async updateMedication(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateMedicationInput
  ): Promise<Medication | undefined> {
    assertDataContextDb(scopedDb);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates["name"] = input.name;
    if (input.dosage !== undefined) updates["dosage"] = input.dosage;
    if (input.form !== undefined) updates["form"] = input.form;
    if (input.active !== undefined) updates["active"] = input.active;
    if (input.notes !== undefined) updates["notes"] = input.notes;
    // schedule_times is NOT updatable in this slice (would need full discriminator re-validation).
    const row = await scopedDb.db
      .updateTable("app.medications")
      .set(updates)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row as Medication | undefined;
  }

  // ── Dose logs ──────────────────────────────────────────────────────────
  async logDose(
    scopedDb: DataContextDb,
    medicationId: string,
    input: LogDoseInput
  ): Promise<MedicationLog> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .insertInto("app.medication_logs")
      .values({
        medication_id: medicationId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        status: input.status,
        dose: input.dose ?? null,
        prn_reason: input.prnReason ?? null,
        scheduled_for: input.scheduledFor ? new Date(input.scheduledFor) : null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as MedicationLog;
  }

  async listRecentLogs(
    scopedDb: DataContextDb,
    options: { readonly sinceDays?: number } = {}
  ): Promise<MedicationLog[]> {
    assertDataContextDb(scopedDb);
    const sinceDays = options.sinceDays ?? 7;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await scopedDb.db
      .selectFrom("app.medication_logs")
      .selectAll()
      .where("logged_at", ">=", since)
      .orderBy("logged_at", "desc")
      .execute();
    return rows as MedicationLog[];
  }

  /**
   * Logs that satisfy a SCHEDULED slot on `date` — filtered by `scheduled_for` (the slot
   * instant), NOT `logged_at` (Codex R2). A dose logged late/early (e.g. just after midnight)
   * still matches its slot's civil day. PRN logs (scheduled_for IS NULL) are excluded: they
   * are unscheduled and computeSchedule never matches them to a slot.
   */
  async listLogsForDate(scopedDb: DataContextDb, date: Date): Promise<MedicationLog[]> {
    assertDataContextDb(scopedDb);
    const dayStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0)
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const rows = await scopedDb.db
      .selectFrom("app.medication_logs")
      .selectAll()
      .where("scheduled_for", ">=", dayStart)
      .where("scheduled_for", "<", dayEnd)
      .execute();
    return rows as MedicationLog[];
  }
}
