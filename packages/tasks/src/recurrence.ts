import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";

export interface RecurrenceSpec {
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  occurrence_date: string; // YYYY-MM-DD
}

/**
 * Compute the next occurrence_date given a RecurrenceSpec.
 *
 * Date arithmetic is deterministic from the stored occurrence_date — never
 * from wall-clock — so test results are stable regardless of when the test runs.
 *
 * - daily:   +interval days
 * - weekly:  +7*interval days
 * - monthly: +interval calendar months (same day-of-month, clamped by JS Date)
 */
function computeNextOccurrenceDate(spec: RecurrenceSpec): string {
  const base = new Date(spec.occurrence_date + "T00:00:00.000Z");

  switch (spec.freq) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + spec.interval);
      break;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + 7 * spec.interval);
      break;
    case "monthly":
      base.setUTCMonth(base.getUTCMonth() + spec.interval);
      break;
  }

  // Return YYYY-MM-DD in UTC
  return base.toISOString().slice(0, 10);
}

/**
 * Advance a Date value by the same delta as the recurrence spec's occurrence_date shift.
 * Returns null if the input date is null.
 */
function advanceDate(
  original: Date | string | null | undefined,
  oldOccurrence: string,
  newOccurrence: string
): Date | null {
  if (original == null) return null;

  const oldMs = new Date(oldOccurrence + "T00:00:00.000Z").getTime();
  const newMs = new Date(newOccurrence + "T00:00:00.000Z").getTime();
  const deltaMs = newMs - oldMs;

  const d = typeof original === "string" ? new Date(original) : original;
  return new Date(d.getTime() + deltaMs);
}

/**
 * Generate the next instance of a recurring task in the same series.
 *
 * Idempotency: the `tasks_recurrence_occurrence_idx` unique index on
 * `(recurrence_series_id, (recurrence->>'occurrence_date'))` ensures that a
 * duplicate insert is caught as a unique-violation error. We catch that error
 * and treat it as a no-op (returns null), so double-firing is safe.
 *
 * Returns the new Task if created, or null if the next instance already existed.
 */
export async function generateNext(db: DataContextDb, task: Task): Promise<Task | null> {
  assertDataContextDb(db);

  if (task.recurrence == null || task.recurrence_series_id == null) {
    return null;
  }

  const spec = task.recurrence as unknown as RecurrenceSpec;
  if (!spec.freq || !spec.interval || !spec.occurrence_date) {
    return null;
  }

  const nextOccurrenceDate = computeNextOccurrenceDate(spec);

  const nextRecurrence: RecurrenceSpec = {
    freq: spec.freq,
    interval: spec.interval,
    occurrence_date: nextOccurrenceDate
  };

  // Advance due_at and do_at by the same delta as the occurrence_date shift
  const nextDueAt = advanceDate(task.due_at, spec.occurrence_date, nextOccurrenceDate);
  const nextDoAt = advanceDate(task.do_at, spec.occurrence_date, nextOccurrenceDate);

  const now = new Date();

  try {
    const inserted = await db.db
      .insertInto("app.tasks")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        list_id: task.list_id,
        parent_task_id: null,
        title: task.title,
        description: task.description,
        status: "todo",
        priority: task.priority,
        position: 0,
        due_at: nextDueAt,
        do_at: nextDoAt,
        effort: task.effort,
        source: "recurrence",
        source_ref: null,
        external_key: null,
        recurrence: nextRecurrence as unknown as Record<string, unknown>,
        recurrence_series_id: task.recurrence_series_id,
        completed_at: null,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirst();

    return inserted ?? null;
  } catch (err: unknown) {
    // Unique index violation on (recurrence_series_id, occurrence_date) means
    // the next instance already exists — treat as no-op.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("tasks_recurrence_occurrence_idx") || message.includes("unique")) {
      return null;
    }
    throw err;
  }
}
