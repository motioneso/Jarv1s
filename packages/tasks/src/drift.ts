import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";
import { localDay } from "@jarv1s/shared";

import { TASK_URGENCY_WINDOW_HOURS } from "./classification.js";
import { rollForwardOwnedSeries } from "./recurrence.js";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const AT_RISK_DUE_WINDOW_DAYS = TASK_URGENCY_WINDOW_HOURS / 24;

/**
 * Read the actor's IANA timezone from app.preferences key "locale".
 * Validates via Intl.DateTimeFormat — unknown zone → DEFAULT_TIMEZONE.
 * Runs inside the caller's already-open DataContextDb transaction (RLS-scoped).
 *
 * Exported (was private `readUserTimezone`) so jobs.ts's recurrence worker can reuse the
 * same preferences read before rolling that actor's series forward (#877 finding 2),
 * instead of duplicating this lookup.
 */
export async function readActorTimezone(db: DataContextDb): Promise<string> {
  assertDataContextDb(db);
  const row = await db.db
    .selectFrom("app.preferences")
    .select("value_json")
    .where("key", "=", "locale")
    .executeTakeFirst();
  const raw = row?.value_json;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_TIMEZONE;
  const tz = (raw as Record<string, unknown>).timezone;
  if (typeof tz !== "string" || !tz.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export class TaskDriftRepository {
  /**
   * Returns all tasks with status='todo' and due_at in the past — using the
   * actor's timezone for day-boundary comparison (not UTC). Ordered by due_at asc.
   */
  async getOverdue(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);
    // Read tz FIRST, then roll forward on the actor's local day — not the server's UTC
    // day (#877 finding 2). Reordered from the old tz-after-roll sequence, which let the
    // roll silently default to UTC and advance a still-due task before evening Pacific.
    const tz = await readActorTimezone(db);
    await rollForwardOwnedSeries(db, localDay(new Date(), tz));
    return this.queryOverdue(db, tz);
  }

  private async queryOverdue(db: DataContextDb, tz: string): Promise<Task[]> {
    return db.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("status", "=", "todo")
      .where("due_at", "is not", null)
      .where(sql<boolean>`(due_at AT TIME ZONE ${tz})::date < (now() AT TIME ZONE ${tz})::date`)
      .orderBy("due_at", "asc")
      .execute();
  }

  /**
   * Returns tasks at risk of slipping:
   * - status = 'todo'
   * - priority >= 3 (Medium and above)
   * - due_at within the frontend day window (user tz) OR do_at day has passed (user tz)
   * - no child task with status = 'done'
   *
   * At-risk SQL predicate:
   *   status = 'todo'
   *   AND priority >= 3
   *   AND (
   *     (due_at IS NOT NULL AND (due_at AT TIME ZONE tz)::date <= (now() AT TIME ZONE tz)::date + 2)
   *     OR (do_at IS NOT NULL AND (do_at AT TIME ZONE tz)::date < (now() AT TIME ZONE tz)::date)
   *   )
   *   AND NOT EXISTS (child done)
   *
   * Ordered by priority desc, due_at asc.
   */
  async getAtRisk(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);
    // Read tz FIRST, then roll forward on the actor's local day (#877 finding 2) — see
    // getOverdue's comment above.
    const tz = await readActorTimezone(db);
    await rollForwardOwnedSeries(db, localDay(new Date(), tz));
    return this.queryAtRisk(db, tz);
  }

  private async queryAtRisk(db: DataContextDb, tz: string): Promise<Task[]> {
    return db.db
      .selectFrom("app.tasks as t")
      .selectAll("t")
      .where("t.status", "=", "todo")
      .where("t.priority", ">=", 3)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("t.due_at", "is not", null),
            sql<boolean>`(t.due_at AT TIME ZONE ${tz})::date <= (now() AT TIME ZONE ${tz})::date + ${AT_RISK_DUE_WINDOW_DAYS}::int`
          ]),
          eb.and([
            eb("t.do_at", "is not", null),
            sql<boolean>`(t.do_at AT TIME ZONE ${tz})::date < (now() AT TIME ZONE ${tz})::date`
          ])
        ])
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("app.tasks as child")
              .select(sql<number>`1`.as("one"))
              .whereRef("child.parent_task_id", "=", "t.id")
              .where("child.status", "=", "done")
          )
        )
      )
      .orderBy("t.priority", "desc")
      .orderBy("t.due_at", "asc")
      .execute();
  }

  /**
   * Union of overdue and at-risk tasks, deduplicated by id.
   * Ordered by: priority desc (nulls last), due_at asc (nulls last), effort (quick first).
   */
  async getFocus(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);

    // Read timezone once — reused for the roll-forward day AND both private queries below,
    // so we don't hit preferences twice and the roll uses the actor's local day (#877
    // finding 2), not the server's UTC day.
    const tz = await readActorTimezone(db);
    await rollForwardOwnedSeries(db, localDay(new Date(), tz));
    const [overdue, atRisk] = await Promise.all([
      this.queryOverdue(db, tz),
      this.queryAtRisk(db, tz)
    ]);

    const seen = new Set<string>();
    const merged: Task[] = [];
    for (const task of [...overdue, ...atRisk]) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        merged.push(task);
      }
    }

    const effortOrder: Record<string, number> = { quick: 0, medium: 1, large: 2 };
    merged.sort((a, b) => {
      const aPri = a.priority ?? -Infinity;
      const bPri = b.priority ?? -Infinity;
      if (bPri !== aPri) return bPri - aPri;

      const aDue = a.due_at ? (a.due_at as Date).getTime() : Infinity;
      const bDue = b.due_at ? (b.due_at as Date).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;

      const aEffort = a.effort != null ? (effortOrder[a.effort] ?? 3) : 3;
      const bEffort = b.effort != null ? (effortOrder[b.effort] ?? 3) : 3;
      return aEffort - bEffort;
    });

    return merged;
  }
}
