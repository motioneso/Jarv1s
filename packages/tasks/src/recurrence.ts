import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";

export interface RecurrenceSpec {
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  occurrence_date: string; // YYYY-MM-DD
}

const RECURRENCE_OCCURRENCE_CONSTRAINT = "tasks_recurrence_occurrence_idx";
const PG_UNIQUE_VIOLATION = "23505";

export function parseRecurrenceSpec(value: unknown): RecurrenceSpec | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const freq = record["freq"];
  const interval = record["interval"];
  const occurrenceDate = record["occurrence_date"];

  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") {
    return null;
  }
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1) {
    return null;
  }
  if (typeof occurrenceDate !== "string" || !isValidOccurrenceDate(occurrenceDate)) {
    return null;
  }

  return { freq, interval, occurrence_date: occurrenceDate };
}

export function isTasksRecurrenceOccurrenceConflict(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }

  const record = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (
    record.code === PG_UNIQUE_VIOLATION &&
    record.constraint === RECURRENCE_OCCURRENCE_CONSTRAINT
  ) {
    return true;
  }

  return isTasksRecurrenceOccurrenceConflict(record.cause);
}

function isValidOccurrenceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
export function computeNextOccurrenceDate(spec: RecurrenceSpec): string {
  const base = new Date(spec.occurrence_date + "T00:00:00.000Z");

  switch (spec.freq) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + spec.interval);
      break;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + 7 * spec.interval);
      break;
    case "monthly": {
      const day = base.getUTCDate();
      // Move to the 1st before adding months so the month add never overflows the day,
      // then clamp the day to the target month's last day.
      base.setUTCDate(1);
      base.setUTCMonth(base.getUTCMonth() + spec.interval);
      const lastDayOfTargetMonth = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
      ).getUTCDate();
      base.setUTCDate(Math.min(day, lastDayOfTargetMonth));
      break;
    }
  }

  // Return YYYY-MM-DD in UTC
  return base.toISOString().slice(0, 10);
}

/**
 * Advance a Date value by the same delta as the recurrence spec's occurrence_date shift.
 * Returns null if the input date is null.
 */
export function advanceDate(
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
 * Given a recurrence spec and a `today` (YYYY-MM-DD, UTC), return the first
 * occurrence date at-or-after today, computed deterministically from the spec's
 * stored occurrence_date by repeatedly applying computeNextOccurrenceDate.
 *
 * Boundary rule: an occurrence_date that EQUALS today is already "at or after" —
 * it is returned unchanged (not rolled).
 */
export function nextOccurrenceAtOrAfter(spec: RecurrenceSpec, today: string): string {
  let current = spec.occurrence_date;
  // Guard against a pathological spec (interval 0) producing an infinite loop.
  if (!spec.freq || !spec.interval || spec.interval < 1) {
    return current;
  }
  let guard = 0;
  while (current < today && guard < 10_000) {
    current = computeNextOccurrenceDate({ ...spec, occurrence_date: current });
    guard += 1;
  }
  return current;
}

/**
 * Roll a single recurring series forward in place: if its one live (status='todo')
 * instance has occurrence_date < today, advance occurrence_date/due_at/do_at to the
 * next occurrence at-or-after today. One live instance, missed rolls forward without
 * stacking (no new row). Idempotent: a series already at/after today is a no-op.
 *
 * `today` (YYYY-MM-DD) is REQUIRED — it must be the ACTOR's local calendar day, never
 * the server's UTC day (#877 finding 2: a UTC-default here silently advanced a still-due
 * daily task from 5 PM Pacific on, because the server day had already flipped). There is
 * intentionally no default; making the param required forces every caller to compute the
 * actor's day (typically via readActorTimezone + localDay) instead of drifting to UTC.
 *
 * Returns true if a row was advanced, false otherwise.
 */
export async function rollForwardRecurringSeries(
  db: DataContextDb,
  seriesId: string,
  today: string
): Promise<boolean> {
  assertDataContextDb(db);

  // OWNER-ONLY: explicit owner predicate, not just RLS (tasks_update is owner-OR-share;
  // roll-forward must never touch a series merely shared to this actor). Select the single
  // canonical live row (LIMIT 1, oldest occurrence first) so we update by id, never the
  // whole series.
  const live = await db.db
    .selectFrom("app.tasks")
    .selectAll()
    .where("recurrence_series_id", "=", seriesId)
    .where("status", "=", "todo")
    .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
    .orderBy(sql`(recurrence->>'occurrence_date')`, "asc")
    .limit(1)
    .executeTakeFirst();

  if (!live || live.recurrence == null) {
    return false;
  }

  const spec = parseRecurrenceSpec(live.recurrence);
  if (!spec) {
    return false;
  }
  if (spec.occurrence_date >= today) {
    return false; // already current — no-op
  }

  const newOccurrence = nextOccurrenceAtOrAfter(spec, today);
  if (newOccurrence === spec.occurrence_date) {
    return false;
  }

  const nextRecurrence: RecurrenceSpec = {
    freq: spec.freq,
    interval: spec.interval,
    occurrence_date: newOccurrence
  };
  const nextDueAt = advanceDate(live.due_at, spec.occurrence_date, newOccurrence);
  const nextDoAt = advanceDate(live.do_at, spec.occurrence_date, newOccurrence);

  // Convergent in-place update BY ID (never whole-series): a concurrent writer that has
  // already advanced this row past `today` matches zero rows here. The status='todo' guard
  // is CRITICAL — a concurrent completion (generateNext path) can flip this row to 'done'
  // between our SELECT and UPDATE; without it we would mutate a completed historical row.
  // Owner predicate restated for defense-in-depth.
  //
  // Unique-violation guard (mirrors generateNext): setting occurrence_date to newOccurrence
  // can collide with a sibling row already at that date in this series — e.g. a 'done'
  // historical instance, or a concurrent generateNext that minted newOccurrence between our
  // SELECT and UPDATE. The `tasks_recurrence_occurrence_idx` unique index on
  // (recurrence_series_id, (recurrence->>'occurrence_date')) then raises 23505. The series
  // is already at-or-past `today` in that case (someone else converged it), so this is a
  // benign no-op — swallow it rather than 500 the entire list load that triggered the
  // lazy-on-view roll-forward.
  //
  // SAVEPOINT guard: a 23505 inside a BEGIN...COMMIT block (e.g. DataContextRunner) puts
  // Postgres into "aborted" state, making every subsequent query in the same transaction
  // fail — even if the JS try/catch swallows the error. Wrapping the UPDATE in a savepoint
  // lets us roll back only that statement and keep the outer transaction alive.
  await sql`SAVEPOINT roll_fwd`.execute(db.db);
  try {
    const updated = await db.db
      .updateTable("app.tasks")
      .set({
        recurrence: { ...nextRecurrence },
        due_at: nextDueAt,
        do_at: nextDoAt,
        updated_at: new Date()
      })
      .where("id", "=", live.id)
      .where("status", "=", "todo")
      .where(sql<boolean>`(recurrence->>'occurrence_date') < ${today}`)
      .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
      .executeTakeFirst();

    await sql`RELEASE SAVEPOINT roll_fwd`.execute(db.db);
    return Number(updated.numUpdatedRows ?? 0n) > 0;
  } catch (err: unknown) {
    await sql`ROLLBACK TO SAVEPOINT roll_fwd`.execute(db.db);
    if (isTasksRecurrenceOccurrenceConflict(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Roll forward every live recurring series owned by the current actor (RLS-scoped).
 * Finds distinct series with a stale live instance, rolls each via
 * rollForwardRecurringSeries, and returns the count advanced. Idempotent.
 *
 * `today` (YYYY-MM-DD) is REQUIRED and must be the ACTOR's local calendar day — see
 * rollForwardRecurringSeries's doc comment (#877 finding 2). No default is provided on
 * purpose so every caller (drift.ts repository methods, the recurrence worker in
 * jobs.ts) is forced through the compiler to compute it via readActorTimezone + localDay
 * instead of silently falling back to the server's UTC day.
 */
export async function rollForwardOwnedSeries(db: DataContextDb, today: string): Promise<number> {
  assertDataContextDb(db);

  // OWNER-ONLY scan: distinct stale series the ACTOR OWNS (explicit predicate, not just
  // RLS — tasks_select is owner-OR-share, so a manage-shared stale series would otherwise
  // appear here and be rolled by the grantee).
  const stale = await db.db
    .selectFrom("app.tasks")
    .select("recurrence_series_id")
    .distinct()
    .where("recurrence_series_id", "is not", null)
    .where("status", "=", "todo")
    .where(sql<boolean>`owner_user_id = app.current_actor_user_id()`)
    .where(sql<boolean>`(recurrence->>'occurrence_date') < ${today}`)
    .execute();

  let rolled = 0;
  for (const row of stale) {
    const seriesId = row.recurrence_series_id;
    if (seriesId == null) continue;
    if (await rollForwardRecurringSeries(db, seriesId, today)) {
      rolled += 1;
    }
  }
  return rolled;
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

  const spec = parseRecurrenceSpec(task.recurrence);
  if (!spec) {
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
        recurrence: { ...nextRecurrence },
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
    if (isTasksRecurrenceOccurrenceConflict(err)) {
      return null;
    }
    throw err;
  }
}
