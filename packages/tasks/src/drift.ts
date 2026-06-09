import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";

/**
 * Tasks with due_at within this many hours of now() are considered "at risk"
 * even if not yet overdue.
 */
const AT_RISK_WINDOW_HOURS = 48;

export class TaskDriftRepository {
  /**
   * Returns all tasks with status='todo' and due_at in the past.
   * Ordered by due_at ascending (most overdue first).
   */
  async getOverdue(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);

    return db.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("status", "=", "todo")
      .where("due_at", "is not", null)
      .where("due_at", "<", sql<Date>`now()`)
      .orderBy("due_at", "asc")
      .execute();
  }

  /**
   * Returns tasks that are at risk of slipping:
   * - status = 'todo'
   * - priority >= 3 (Medium and above; excludes Someday priority < 3 and null priority)
   * - due_at is within the AT_RISK_WINDOW_HOURS window OR do_at is already past
   * - lacking progress: no child task with status = 'done'
   *
   * At-risk SQL predicate:
   *   status = 'todo'
   *   AND priority >= 3
   *   AND (
   *     (due_at IS NOT NULL AND due_at < now() + interval '48 hours')
   *     OR (do_at IS NOT NULL AND do_at < now())
   *   )
   *   AND NOT EXISTS (
   *     SELECT 1 FROM app.tasks child
   *     WHERE child.parent_task_id = t.id AND child.status = 'done'
   *   )
   *
   * Ordered by priority desc, due_at asc.
   */
  async getAtRisk(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);

    return db.db
      .selectFrom("app.tasks as t")
      .selectAll("t")
      .where("t.status", "=", "todo")
      .where("t.priority", ">=", 3)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("t.due_at", "is not", null),
            eb(
              "t.due_at",
              "<",
              sql<Date>`now() + (${AT_RISK_WINDOW_HOURS.toString()} || ' hours')::interval`
            )
          ]),
          eb.and([eb("t.do_at", "is not", null), eb("t.do_at", "<", sql<Date>`now()`)])
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
   * Returns the union of overdue and at-risk tasks, deduplicated by id.
   * Ordered by: priority desc (nulls last), due_at asc (nulls last), effort
   * (quick < medium < large — quick-effort tasks break ties first).
   */
  async getFocus(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);

    const [overdue, atRisk] = await Promise.all([this.getOverdue(db), this.getAtRisk(db)]);

    // Deduplicate: at-risk may overlap with overdue (overdue tasks with priority >= 3).
    const seen = new Set<string>();
    const merged: Task[] = [];
    for (const task of [...overdue, ...atRisk]) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        merged.push(task);
      }
    }

    // Sort: priority desc (nulls last), due_at asc (nulls last), effort (quick first)
    const effortOrder: Record<string, number> = { quick: 0, medium: 1, large: 2 };
    merged.sort((a, b) => {
      // Priority: higher is more urgent; null sorts last
      const aPri = a.priority ?? -Infinity;
      const bPri = b.priority ?? -Infinity;
      if (bPri !== aPri) return bPri - aPri;

      // due_at: earlier is more urgent; null sorts last
      const aDue = a.due_at ? (a.due_at as Date).getTime() : Infinity;
      const bDue = b.due_at ? (b.due_at as Date).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;

      // effort tiebreak: quick first (smallest value)
      const aEffort = a.effort != null ? (effortOrder[a.effort] ?? 3) : 3;
      const bEffort = b.effort != null ? (effortOrder[b.effort] ?? 3) : 3;
      return aEffort - bEffort;
    });

    return merged;
  }
}
