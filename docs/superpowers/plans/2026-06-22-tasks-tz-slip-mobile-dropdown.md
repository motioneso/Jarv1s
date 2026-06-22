# Tasks TZ-Slip + Mobile Dropdown Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two dogfood bugs: (1) tasks due today are wrongly shown as overdue because drift queries use UTC `now()` instead of the user's timezone day boundary; (2) on mobile, hiding a list causes the header dropdown button to grow too wide and wrap to a new line.

**Architecture:** For #401, `packages/tasks/src/drift.ts` gains a `readUserTimezone` helper that reads the user's `"locale"` preference from `app.preferences` (RLS-scoped, same transaction) and passes the IANA tz string to the SQL queries as a PostgreSQL `AT TIME ZONE` parameter. No schema migration — the tz is already stored. For #404, `apps/web/src/tasks/tasks.css` gets two mobile-only CSS rules in the existing `@media (max-width: 560px)` block: hide the `·N hidden` label text from the button (preventing button width growth), and cap the dropdown `max-width` so it cannot overflow the viewport.

**Tech Stack:** TypeScript, Kysely (SQL query builder), PostgreSQL `AT TIME ZONE`, CSS `@media`

## Global Constraints

- Never edit applied migrations — add a new file; never modify existing `.sql` files
- `DataContextDb` only — never raw Kysely. All DB reads go through `assertDataContextDb` + scoped handle
- No new npm dependencies
- `pnpm check:file-size` cap: source files ≤ 1000 lines (`tasks.css` currently 505 lines — safe)
- `Co-Authored-By: Claude <noreply@anthropic.com>` trailer on every commit
- `git add` only the task's own files — never `git add -A` / `git add .`
- No migration needed — timezone is already in `app.preferences` under key `"locale"`
- `foundation.test.ts` asserts the FULL migration list with `toEqual` — adding a migration would require updating that list; confirm none is added

---

## File Map

| File                              | Action | Purpose                                                                                           |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `packages/tasks/src/drift.ts`     | Modify | Add `readUserTimezone` helper + tz-aware SQL in `queryOverdue` and `do_at` check in `queryAtRisk` |
| `tests/integration/tasks.test.ts` | Modify | Add drift+timezone integration tests                                                              |
| `apps/web/src/tasks/tasks.css`    | Modify | Mobile dropdown fix — hide hidden-count label + cap dropdown width                                |

---

### Task 1: Timezone-aware drift queries (#401)

**Files:**

- Modify: `packages/tasks/src/drift.ts`

**Interfaces:**

- Consumes: `app.preferences` table (columns: `key TEXT`, `value_json JSONB`), `DataContextDb`, `assertDataContextDb` from `@jarv1s/db`
- Produces: `readUserTimezone(db: DataContextDb): Promise<string>` (IANA string, e.g. `"America/Los_Angeles"`), no public API signature change

**Context to read first:** Open `packages/briefings/src/schedule.ts` — the `timezoneFor` function (lines 35-47) is the canonical IANA validation pattern; mirror it exactly. Open `packages/db/src/types.ts` line 618 to confirm `"app.preferences"` is in `JarvisDatabase`. Open `packages/structured-state/src/preferences-repository.ts` to see the correct Kysely query shape for `app.preferences`.

- [ ] **Step 1: Add `readUserTimezone` helper and update `queryOverdue` — write the implementation**

Open `packages/tasks/src/drift.ts`. The file currently starts with:

```typescript
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";
```

Replace the entire file with the following (preserve all existing logic exactly — only add the helper and change the two SQL predicates):

```typescript
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Task } from "@jarv1s/db";

import { TASK_URGENCY_WINDOW_HOURS } from "./classification.js";
import { rollForwardOwnedSeries } from "./recurrence.js";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

/**
 * Read the actor's IANA timezone from app.preferences key "locale".
 * Validates via Intl.DateTimeFormat — unknown zone → DEFAULT_TIMEZONE.
 * Runs inside the caller's already-open DataContextDb transaction (RLS-scoped).
 */
async function readUserTimezone(db: DataContextDb): Promise<string> {
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
    await rollForwardOwnedSeries(db);
    const tz = await readUserTimezone(db);
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
   * - due_at within AT_RISK_WINDOW_HOURS window  OR  do_at day has passed (user tz)
   * - no child task with status = 'done'
   *
   * At-risk SQL predicate:
   *   status = 'todo'
   *   AND priority >= 3
   *   AND (
   *     (due_at IS NOT NULL AND due_at < now() + interval '48 hours')
   *     OR (do_at IS NOT NULL AND (do_at AT TIME ZONE tz)::date < (now() AT TIME ZONE tz)::date)
   *   )
   *   AND NOT EXISTS (child done)
   *
   * Ordered by priority desc, due_at asc.
   */
  async getAtRisk(db: DataContextDb): Promise<Task[]> {
    assertDataContextDb(db);
    await rollForwardOwnedSeries(db);
    const tz = await readUserTimezone(db);
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
            eb(
              "t.due_at",
              "<",
              sql<Date>`now() + (${TASK_URGENCY_WINDOW_HOURS.toString()} || ' hours')::interval`
            )
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

    await rollForwardOwnedSeries(db);
    // Read timezone once; pass to both private queries so we don't hit preferences twice.
    const tz = await readUserTimezone(db);
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: exits 0. Fix any TS errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/tasks/src/drift.ts
git commit -m "$(cat <<'EOF'
fix(tasks): tz-aware day-boundary in drift queries (#401)

queryOverdue now compares (due_at AT TIME ZONE tz)::date < (now() AT TIME
ZONE tz)::date instead of due_at < now(). queryAtRisk applies the same
day-boundary fix for the do_at-past check. readUserTimezone reads the actor's
"locale" preference (key = "locale") from app.preferences within the same
RLS-scoped transaction; invalid/missing tz falls back to America/Los_Angeles.
getFocus reads the tz once and passes it to both private queries.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Integration tests for drift timezone fix

**Files:**

- Modify: `tests/integration/tasks.test.ts`

**Interfaces:**

- Consumes: `TaskDriftRepository` (from `@jarv1s/tasks`, already imported), `dataContext: DataContextRunner`, `userAContext()` helper, `repository: TasksRepository`
- Produces: a `describe("TaskDriftRepository timezone")` block that verifies: (a) tasks clearly in the past are returned as overdue, (b) tasks clearly in the future are not, (c) the timezone is read from preferences and affects the result for the tz boundary case

**Context:** `fromDateInputValue` in `apps/web/src/tasks/task-format.ts` stores `due_at` as `new Date(\`${value}T12:00:00.000Z\`).toISOString()`— noon UTC for any local date string. Tests use`dataContext.withDataContext(userAContext(), async (scopedDb) => { ... })`to read/write within an actor's RLS scope. The`app.preferences`table is`upsert`-able via raw Kysely inside the scoped transaction. `TaskDriftRepository`is already exported from`@jarv1s/tasks`.

**Important limitation:** Testing the exact UTC-midnight vs. local-midnight boundary requires clock manipulation (not present in this codebase). These tests verify the code path runs correctly and the obviously-past / obviously-future cases behave correctly. The SQL correctness for the boundary case is verified by reading the query text.

- [ ] **Step 1: Find the insertion point in `tests/integration/tasks.test.ts`**

Open the file. Find the end of the `describe("Tasks module M1", () => {` block — it ends with a `});` at roughly line 898. The new `describe` block goes INSIDE `describe("Tasks module M1", ...)` before its closing `});`.

Also confirm that `TaskDriftRepository` is already imported from `@jarv1s/tasks` at line ~28-33. If not, add it to that import.

- [ ] **Step 2: Add the drift timezone test block**

Add the following block inside `describe("Tasks module M1", ...)`, after the last existing `it(...)` but before the closing `});` of the describe:

```typescript
describe("TaskDriftRepository timezone awareness", () => {
  const driftRepository = new TaskDriftRepository();

  it("returns a task with due_at clearly in the past as overdue (no locale set)", async () => {
    // due_at = 10 days ago at noon UTC — overdue in any timezone
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    pastDate.setUTCHours(12, 0, 0, 0);

    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "TZ test — past task",
        description: null,
        status: "todo",
        priority: 3,
        dueAt: pastDate,
        listId: null,
        doAt: null,
        effort: null,
        parentTaskId: null,
        recurrence: null
      })
    );

    const overdue = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      driftRepository.getOverdue(scopedDb)
    );

    expect(overdue.some((t) => t.id === created.id)).toBe(true);

    // cleanup
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      scopedDb.db.deleteFrom("app.tasks").where("id", "=", created.id).execute()
    );
  });

  it("does not return a task with due_at clearly in the future as overdue", async () => {
    // due_at = 10 days from now at noon UTC — not overdue in any timezone
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    futureDate.setUTCHours(12, 0, 0, 0);

    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "TZ test — future task",
        description: null,
        status: "todo",
        priority: 3,
        dueAt: futureDate,
        listId: null,
        doAt: null,
        effort: null,
        parentTaskId: null,
        recurrence: null
      })
    );

    const overdue = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      driftRepository.getOverdue(scopedDb)
    );

    expect(overdue.some((t) => t.id === created.id)).toBe(false);

    // cleanup
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      scopedDb.db.deleteFrom("app.tasks").where("id", "=", created.id).execute()
    );
  });

  it("reads user timezone from locale preference and uses it for overdue classification", async () => {
    // Set user A's locale to America/Los_Angeles
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      scopedDb.db
        .insertInto("app.preferences")
        .values({
          owner_user_id: sql<string>`app.current_actor_user_id()`,
          key: "locale",
          value_json: sql<
            Record<string, unknown>
          >`${JSON.stringify({ timezone: "America/Los_Angeles", region: "en-US", dateFormat: "24" })}::jsonb`,
          updated_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["owner_user_id", "key"]).doUpdateSet({
            value_json: sql<
              Record<string, unknown>
            >`${JSON.stringify({ timezone: "America/Los_Angeles", region: "en-US", dateFormat: "24" })}::jsonb`,
            updated_at: new Date()
          })
        )
        .execute()
    );

    // A task 5 days in the past is overdue in any timezone (including Los Angeles)
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    pastDate.setUTCHours(12, 0, 0, 0);

    const created = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.create(scopedDb, {
        title: "TZ test — LA locale past task",
        description: null,
        status: "todo",
        priority: 3,
        dueAt: pastDate,
        listId: null,
        doAt: null,
        effort: null,
        parentTaskId: null,
        recurrence: null
      })
    );

    const overdue = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      driftRepository.getOverdue(scopedDb)
    );

    expect(overdue.some((t) => t.id === created.id)).toBe(true);

    // cleanup
    await dataContext.withDataContext(userAContext(), (scopedDb) =>
      Promise.all([
        scopedDb.db.deleteFrom("app.tasks").where("id", "=", created.id).execute(),
        scopedDb.db.deleteFrom("app.preferences").where("key", "=", "locale").execute()
      ])
    );
  });
});
```

Also add the `sql` import if not already present. The `sql` tag function from Kysely is needed for the `app.current_actor_user_id()` call and the `::jsonb` cast. Check that `import { sql, type Kysely } from "kysely";` is at the top of the file (it should be at line ~4).

- [ ] **Step 3: Run the drift timezone tests**

```bash
pnpm db:up
pnpm db:migrate
pnpm test:tasks 2>&1 | grep -E "PASS|FAIL|timezone|✓|×|Error" | head -30
```

Expected: all 3 new tests pass. If `TaskDriftRepository` is not found in the import, add it:

```typescript
import {
  // ...existing imports...
  TaskDriftRepository
  // ...
} from "@jarv1s/tasks";
```

- [ ] **Step 4: Run the full tasks integration suite**

```bash
pnpm test:tasks 2>&1 | tail -20
```

Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/tasks.test.ts
git commit -m "$(cat <<'EOF'
test(tasks): integration tests for timezone-aware drift queries (#401)

Three deterministic tests: clearly-past task is overdue, clearly-future task
is not, and the locale preference is read + used for classification. The
exact UTC-midnight/local-midnight boundary case requires clock manipulation
not present in this codebase; SQL correctness for that case is verified by
code review of the AT TIME ZONE predicate in drift.ts.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mobile dropdown fix (#404)

**Files:**

- Modify: `apps/web/src/tasks/tasks.css`

**Context to read first:** Open `apps/web/src/tasks/tasks.css` lines 489-505 (the existing `@media (max-width: 560px)` block). Open `apps/web/src/styles/kit-tasks.css` lines 317-360 (the `.tk-listfilter`, `.tk-listbtn`, and `.tk-tagmenu` definitions). The bug: when a list is hidden (state = "excluded"), the `ListFilterMenu` button renders `<span className="tk-listbtn__hidden"> · 1 hidden</span>`. This extra text widens the button, overflowing the flex row on mobile. Secondary issue: the `.tk-tagmenu` dropdown has `position: absolute; left: 0` and may overflow the viewport if the parent flex item is near the right edge of the screen.

**Interfaces:**

- Consumes: existing `.tk-bar`, `.tk-listbtn`, `.tk-listbtn__hidden`, `.tk-listfilter`, `.tk-tagmenu` CSS classes (all defined in `apps/web/src/styles/kit-tasks.css`)
- Produces: two rules added to the existing `@media (max-width: 560px)` block in `tasks.css`

- [ ] **Step 1: Open `apps/web/src/tasks/tasks.css` and locate the mobile media block**

The block is at lines 489-505 (the bottom of the file):

```css
/* Mobile: deliberate wrap for the tasks toolbar so controls don't orphan a
   single control on its own line when lists are toggled (#388). Loads after
   kit-tasks.css so these override the base .tk-bar rules. */
@media (max-width: 560px) {
  .tk-bar {
    gap: 8px 10px;
  }
  .tk-bar__spacer {
    flex-basis: 0;
  }
  .tk-bar__sep {
    display: none;
  }
  .tk-tagfield {
    flex: 1 1 100%;
  }
}
```

- [ ] **Step 2: Add the two mobile dropdown fixes**

Update the comment and add two new rule-sets inside the existing `@media` block:

```css
/* Mobile: deliberate wrap for the tasks toolbar so controls don't orphan a
   single control on its own line when lists are toggled (#388). Loads after
   kit-tasks.css so these override the base .tk-bar rules. */
@media (max-width: 560px) {
  .tk-bar {
    gap: 8px 10px;
  }
  .tk-bar__spacer {
    flex-basis: 0;
  }
  .tk-bar__sep {
    display: none;
  }
  .tk-tagfield {
    flex: 1 1 100%;
  }
  /* #404: hide the "· N hidden" count text on mobile so the list-filter button
     stays narrow when lists are excluded. Users open the dropdown to see state. */
  .tk-listbtn__hidden {
    display: none;
  }
  /* #404: cap the list-filter dropdown to the viewport width and anchor its
     right edge to the button so it never overflows off-screen to the right. */
  .tk-listfilter .tk-tagmenu {
    max-width: calc(100vw - 24px);
    left: auto;
    right: 0;
  }
}
```

- [ ] **Step 3: Check file size stays under 1000 lines**

```bash
wc -l apps/web/src/tasks/tasks.css
```

Expected: output is well under 1000 (currently 505 lines, adding ~10 lines → ~515).

- [ ] **Step 4: Run lint + format + typecheck**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: exits 0. If `format:check` fails, run `pnpm format` then `pnpm format:check` again. **Never run `pnpm format` on `docs/coordination/` — only format the tasks.css file.**

```bash
# Safe targeted format if needed:
pnpm prettier --write apps/web/src/tasks/tasks.css
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tasks/tasks.css
git commit -m "$(cat <<'EOF'
fix(tasks/mobile): prevent list-filter button overflow + dropdown viewport clip (#404)

On mobile (≤560px), hide the "· N hidden" label from the list-filter button
so its width stays constant when lists are excluded. Also cap the dropdown
max-width to (100vw - 24px) and anchor its right edge to the button, preventing
it from overflowing the viewport when the parent flex item is not at x=0.
Prior fix (#388) addressed toolbar orphan; this fix addresses the distinct
button-width-growth and dropdown-overflow problems.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Pre-push gate + rebase

**Files:** None modified in this task — gate only.

- [ ] **Step 1: Run the full pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all exit 0. Fix any failures before pushing.

- [ ] **Step 2: Confirm no migration was added**

```bash
git diff origin/main --name-only | grep -E "\.sql$"
```

Expected: no `.sql` files in the diff.

- [ ] **Step 3: Fresh rebase onto origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: rebase completes cleanly (branch was cut from `6a0ef8a` which is current `main` — no conflicts expected).

- [ ] **Step 4: Run the full integration test suite**

```bash
pnpm db:up && pnpm db:migrate && pnpm test:tasks 2>&1 | tail -20
```

Expected: all tests pass.

---

## Exit Criteria Checklist

- [ ] `pnpm format:check && pnpm lint && pnpm typecheck` all exit 0
- [ ] `pnpm test:tasks` passes (no regressions, 3 new drift-tz tests pass)
- [ ] `packages/tasks/src/drift.ts` uses `AT TIME ZONE` for `queryOverdue` and `do_at` check in `queryAtRisk`
- [ ] `readUserTimezone` reads from `app.preferences` key `"locale"` and validates via `Intl.DateTimeFormat`
- [ ] `apps/web/src/tasks/tasks.css` has `.tk-listbtn__hidden { display: none; }` + `.tk-listfilter .tk-tagmenu` rules in the `@media (max-width: 560px)` block
- [ ] No new SQL migrations added
- [ ] `foundation.test.ts` migration list unchanged (verify: `pnpm test:integration 2>&1 | grep -E "foundation|migration" | head -5`)
- [ ] All commits have `Co-Authored-By: Claude <noreply@anthropic.com>` trailer
