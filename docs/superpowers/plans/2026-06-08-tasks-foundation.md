# Tasks Foundation Implementation Plan — Plan 1 of 3 (Data + Repository + REST)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Build agents run on Sonnet; each task commits green; `git add` only that task's files.**

**Goal:** Build the core Task data model and its REST/query contract — the backend substrate the briefing and other areas depend on.

**Architecture:** Additive migration `0039` (new Lists/Tags/preferences tables + new `app.tasks` columns + safe backfill + triggers), narrowed status contract, a decomposed tasks repository (`lists.ts`, `breakdown.ts`, `recurrence.ts`, `drift.ts`, slimmer `repository.ts`), and Fastify routes. No AI execution, no web UI (those are Plans 2 and 3).

**Tech Stack:** PostgreSQL (RLS/FORCE RLS), Kysely, Fastify, Vitest integration tests against `pnpm db:up`.

**Spec:** `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` (rev 3). **Decision:** `docs/architecture/decisions/0004-tasks-single-action-surface.md`.

**Companion plans (write after this lands):** Plan 2 — assistant **read** tools authored as `execute()` handlers on the **module-owned `ModuleAssistantToolManifest` contract** from Phase-2 MCP (PR #33 / issue #34), NOT the legacy central `invokeReadTool` switch; prerequisite is PR #33 merged + main integrated. Tasks **write** tools are Phase 2's surface, not ours. Plan 3 — web UI (priority-grouped + Matrix views, capture, detail, lists/tags). **At merge:** keep the _union_ of this branch's `CONTEXT.md` glossary with the Phase-2 assistant/tools terms added on PR #33.

---

## Pre-flight (one-time, before Task 1)

- [ ] Confirm clean tree on a fresh branch off `main` (the `/start` build stage handles branch creation). Ensure `CONTEXT.md`, the spec, and ADR 0004 are committed (they are design inputs this plan references).
- [ ] `pnpm install` && `pnpm db:up` && `pnpm db:migrate` && `pnpm test:tasks` — confirm the existing tasks suite is green **before** changing anything.

---

## File Structure

| File                                           | Responsibility                                                            | Action |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| `packages/tasks/sql/0039_tasks_foundation.sql` | New tables, columns, backfill, constraints, triggers, RLS, grants         | Create |
| `packages/tasks/src/manifest.ts`               | Register migration; add `shareableResources`/permissions unchanged        | Modify |
| `packages/db/src/types.ts`                     | New table interfaces; narrow `TaskStatus`; new column types; `actor_kind` | Modify |
| `packages/shared/src/tasks-api.ts`             | Narrow `TASK_STATUSES`; extend `TaskDto`+schemas; List/Tag DTOs+schemas   | Modify |
| `packages/tasks/src/repository.ts`             | Core task CRUD (slimmed; re-exports submodules)                           | Modify |
| `packages/tasks/src/lists.ts`                  | Lists + Tags repositories                                                 | Create |
| `packages/tasks/src/breakdown.ts`              | Hierarchy + breakdown + completion cascade                                | Create |
| `packages/tasks/src/recurrence.ts`             | Fixed-schedule next-instance generation                                   | Create |
| `packages/tasks/src/drift.ts`                  | `getOverdue`/`getAtRisk`/`getFocus` queries                               | Create |
| `packages/tasks/src/routes.ts`                 | Extended task routes + lists/tags/breakdown/query/recurrence routes       | Modify |
| `packages/tasks/src/index.ts`                  | Re-export new modules                                                     | Modify |
| `tests/integration/tasks.test.ts`              | Extend; **invert** the `in_progress` assertion                            | Modify |

---

## Task 1: Migration `0039` — new tables, columns, safe backfill, triggers, RLS

**Files:**

- Create: `packages/tasks/sql/0039_tasks_foundation.sql`
- Modify: `packages/tasks/src/manifest.ts:37` (add the migration to the `migrations` array)
- Test: `tests/integration/tasks.test.ts` (a migration-shape assertion)

- [ ] **Step 1: Write the failing test** (append to `tasks.test.ts`, inside the `describe`)

```ts
it("migration 0039: every task has a list, in_progress is retired, new columns exist", async () => {
  // every existing/seeded task got a Personal list
  const orphan = await appDb
    .selectFrom("app.tasks")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("list_id", "is", null)
    .executeTakeFirstOrThrow();
  expect(Number(orphan.n)).toBe(0);

  // in_progress mapped away
  const inProgress = await appDb
    .selectFrom("app.tasks")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("status", "=", "in_progress")
    .executeTakeFirstOrThrow();
  expect(Number(inProgress.n)).toBe(0);

  // every user has a Personal list
  const lists = await appDb
    .selectFrom("app.task_lists")
    .select(["owner_user_id", "name"])
    .where("name", "=", "Personal")
    .execute();
  expect(lists.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vitest run tests/integration/tasks.test.ts -t "migration 0039"`
Expected: FAIL (`app.task_lists` does not exist / `list_id` column missing).

- [ ] **Step 3: Write the migration** — `packages/tasks/sql/0039_tasks_foundation.sql`

```sql
-- M-A5 Tasks Foundation. Additive. Order matters: create+seed+alter+backfill happen
-- BEFORE RLS is enabled on the new tables; the one backfill that touches the already
-- FORCE-RLS app.tasks uses a transient migration-scoped policy (precedent: shares_internal_select, 0017).

-- 1. New tables (no RLS yet) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_lists_owner_name_idx
  ON app.task_lists (owner_user_id, lower(name));

CREATE TABLE IF NOT EXISTS app.task_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES app.task_lists(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_tags_list_name_idx
  ON app.task_tags (list_id, lower(name));

CREATE TABLE IF NOT EXISTS app.task_tag_assignments (
  task_id uuid NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES app.task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS app.task_preferences (
  owner_user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  default_view text NOT NULL DEFAULT 'priority' CHECK (default_view IN ('priority','matrix')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed a Personal list for every user (tables still RLS-free) -------------------
INSERT INTO app.task_lists (owner_user_id, name)
SELECT id, 'Personal' FROM app.users
ON CONFLICT DO NOTHING;

-- 3. Add new columns to app.tasks (nullable for now) ------------------------------
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES app.task_lists(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES app.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS do_at timestamptz,
  ADD COLUMN IF NOT EXISTS effort text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS external_key text,
  ADD COLUMN IF NOT EXISTS recurrence jsonb,
  ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;

-- 4. Backfill app.tasks under a transient migration policy ------------------------
CREATE POLICY tasks_migration_backfill ON app.tasks
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

UPDATE app.tasks t
  SET list_id = l.id
  FROM app.task_lists l
  WHERE l.owner_user_id = t.owner_user_id AND l.name = 'Personal' AND t.list_id IS NULL;

UPDATE app.tasks SET status = 'todo' WHERE status = 'in_progress';

UPDATE app.tasks
  SET priority = NULL
  WHERE priority IS NOT NULL AND (priority < 1 OR priority > 5);

DROP POLICY tasks_migration_backfill ON app.tasks;

-- 5. Constrain app.tasks ----------------------------------------------------------
ALTER TABLE app.tasks ALTER COLUMN list_id SET NOT NULL;
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_priority_range CHECK (priority IS NULL OR priority BETWEEN 1 AND 5),
  ADD CONSTRAINT tasks_effort_values CHECK (effort IS NULL OR effort IN ('quick','medium','large'));

CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_external_key_idx
  ON app.tasks (owner_user_id, source, external_key) WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_occurrence_idx
  ON app.tasks (recurrence_series_id, (recurrence->>'occurrence_date'))
  WHERE recurrence_series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_drift_idx
  ON app.tasks (owner_user_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS tasks_parent_position_idx
  ON app.tasks (parent_task_id, position);

-- 6. Triggers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tasks_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    IF NEW.parent_task_id = NEW.id THEN
      RAISE EXCEPTION 'task cannot be its own parent';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.parent_task_id IS NOT NULL) THEN
      RAISE EXCEPTION 'subtasks may not have children (one-level hierarchy)';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.recurrence IS NOT NULL) THEN
      RAISE EXCEPTION 'a recurring task may not be a parent';
    END IF;
  END IF;
  IF NEW.recurrence IS NOT NULL
     AND EXISTS (SELECT 1 FROM app.tasks c WHERE c.parent_task_id = NEW.id) THEN
    RAISE EXCEPTION 'a recurring task may not be a parent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_hierarchy_guard ON app.tasks;
CREATE TRIGGER tasks_hierarchy_guard BEFORE INSERT OR UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_hierarchy_guard();

CREATE OR REPLACE FUNCTION app.task_tag_list_match() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.tasks t JOIN app.task_tags g ON g.id = NEW.tag_id
    WHERE t.id = NEW.task_id AND g.list_id = t.list_id
  ) THEN
    RAISE EXCEPTION 'tag must belong to the task''s list';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_tag_list_match ON app.task_tag_assignments;
CREATE TRIGGER task_tag_list_match BEFORE INSERT OR UPDATE ON app.task_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION app.task_tag_list_match();

-- 7. Enable RLS + policies + grants on new tables ---------------------------------
ALTER TABLE app.task_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_lists FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_tag_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_preferences FORCE ROW LEVEL SECURITY;

-- task_lists: owner-only (forward-compatible with a future has_share('list',...) disjunct)
CREATE POLICY task_lists_rw ON app.task_lists FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY task_tags_rw ON app.task_tags FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

-- assignments gated on parent-task visibility (mirrors task_activity pattern)
CREATE POLICY task_tag_assignments_rw ON app.task_tag_assignments FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id));

CREATE POLICY task_preferences_rw ON app.task_preferences FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_lists TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_tags TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_tag_assignments TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_preferences TO jarvis_app_runtime;
GRANT SELECT ON app.task_lists TO jarvis_worker_runtime;
GRANT SELECT ON app.task_tags TO jarvis_worker_runtime;
GRANT SELECT ON app.task_tag_assignments TO jarvis_worker_runtime;
GRANT SELECT ON app.task_preferences TO jarvis_worker_runtime;

-- 8. task_activity gains actor_kind ----------------------------------------------
ALTER TABLE app.task_activity
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'user'
  CHECK (actor_kind IN ('user','jarvis','system'));
```

- [ ] **Step 4: Register the migration** — `packages/tasks/src/manifest.ts:37`

```ts
    migrations: ["sql/0003_tasks_module.sql", "sql/0019_tasks_owner_or_share.sql", "sql/0039_tasks_foundation.sql"],
```

(Match the existing array's contents — verify whether `0019` is already listed; add `0039` regardless.)

- [ ] **Step 5: Apply + run the test**

Run: `pnpm db:migrate && vitest run tests/integration/tasks.test.ts -t "migration 0039"`
Expected: PASS. If `resetFoundationDatabase()` rebuilds from migrations, the seed/backfill run against seeded users.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/sql/0039_tasks_foundation.sql packages/tasks/src/manifest.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): migration 0039 — lists/tags/preferences + task columns + safe backfill"
```

---

## Task 2: `@jarv1s/db` types — new tables, columns, actor_kind

> **Sequencing note (discovered during build):** do **NOT** narrow `TaskStatus` here. `pnpm typecheck` includes the **web** app (Plan 3 scope); narrowing the union now breaks web typecheck and violates green-per-commit. In Plan 1, `in_progress` is rejected _behaviorally_ at the route layer (Task 9). The **type/schema narrowing of `TaskStatus`/`TASK_STATUSES` + the web updates + the type-level guard test are an atomic task in Plan 3.** `TaskStatus` keeps `in_progress` as a value for now (the DB enum keeps it regardless).

**Files:**

- Modify: `packages/db/src/types.ts` (the tasks region ~143–175 + the `JarvisDatabase` table map ~435)

- [ ] **Step 1: Write the failing test** (`tasks.test.ts`) — use RAW `sql` (typed tables land in this task, but keep the assertion behavioral)

```ts
it("db types: new task columns and tables are queryable", async () => {
  const cols = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema='app' and table_name='tasks'
      and column_name in ('list_id','parent_task_id','do_at','effort','source','recurrence_series_id')
  `.execute(appDb);
  expect(cols.rows.length).toBe(6);
});
```

- [ ] **Step 2: Run it** — `vitest run tests/integration/tasks.test.ts -t "new task columns"`. (This passes already from Task 1's migration; the real deliverable of Task 2 is the TS types compiling against the new columns — verified by typecheck in Step 4.)

- [ ] **Step 3: Edit `packages/db/src/types.ts`** — **keep `TaskStatus` as-is** (`"todo" | "in_progress" | "done" | "archived"`). Extend `TasksTable` with the new columns:

```ts
export interface TasksTable {
  id: string;
  owner_user_id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number | null;
  position: number;
  due_at: NullableTimestampColumn;
  do_at: NullableTimestampColumn;
  completed_at: NullableTimestampColumn;
  effort: "quick" | "medium" | "large" | null;
  source: string;
  source_ref: string | null;
  external_key: string | null;
  recurrence: Record<string, unknown> | null;
  recurrence_series_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface TaskActivityTable {
  id: string;
  task_id: string;
  actor_user_id: string;
  actor_kind: "user" | "jarvis" | "system";
  activity_type: string;
  body: string | null;
  created_at: TimestampColumn;
}

export interface TaskListsTable {
  id: string;
  owner_user_id: string;
  name: string;
  position: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
export interface TaskTagsTable {
  id: string;
  owner_user_id: string;
  list_id: string;
  name: string;
  created_at: TimestampColumn;
}
export interface TaskTagAssignmentsTable {
  task_id: string;
  tag_id: string;
}
export interface TaskPreferencesTable {
  owner_user_id: string;
  default_view: "priority" | "matrix";
  updated_at: TimestampColumn;
}
```

Add to the `JarvisDatabase` map (~line 435) and the `Selectable` exports (~466):

```ts
  "app.task_lists": TaskListsTable;
  "app.task_tags": TaskTagsTable;
  "app.task_tag_assignments": TaskTagAssignmentsTable;
  "app.task_preferences": TaskPreferencesTable;
```

```ts
export type TaskList = Selectable<TaskListsTable>;
export type TaskTag = Selectable<TaskTagsTable>;
export type TaskPreferences = Selectable<TaskPreferencesTable>;
```

- [ ] **Step 4: Run** — `pnpm typecheck`. Expected: the db package compiles; downstream packages now error on `in_progress` (fixed in Tasks 3/6/routes).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/types.ts tests/integration/tasks.test.ts
git commit -m "feat(db): tasks foundation table types; narrow TaskStatus; add actor_kind"
```

---

## Task 3: `@jarv1s/shared` contract — extend Task DTO, List/Tag DTOs (status narrowing deferred to Plan 3)

> **Do NOT narrow `TASK_STATUSES` here** (same reason as Task 2 — it would break web typecheck). `in_progress` stays in the union/schema for now; behavioral rejection is at the route layer (Task 9). Plan 3 narrows the type + updates web atomically.

**Files:**

- Modify: `packages/shared/src/tasks-api.ts`

- [ ] **Step 1: Write the failing test** (`tasks.test.ts`)

```ts
it("shared: Task DTO carries the new fields", () => {
  // compile-time guard: a TaskDto literal must accept the new fields
  const dto: Pick<TaskDto, "listId" | "doAt" | "effort" | "source"> = {
    listId: "x",
    doAt: null,
    effort: "quick",
    source: "manual"
  };
  expect(dto.source).toBe("manual");
});
```

(Add `TaskDto` to the test's type imports from `@jarv1s/shared`.)

- [ ] **Step 2: Run** — `pnpm --filter @jarv1s/shared typecheck`. Expected: FAIL (`listId`/`doAt`/`effort` not on `TaskDto` yet).

- [ ] **Step 3: Edit `packages/shared/src/tasks-api.ts`** — **keep `TASK_STATUSES` as-is.**
- Extend `TaskDto` with: `listId: string; parentTaskId: string | null; position: number; doAt: string | null; effort: "quick"|"medium"|"large"|null; source: string; sourceRef: string | null;` and the matching `taskDtoSchema` properties + `required`.
- Change `priority` schema in `createTaskRequestSchema`/`updateTaskRequestSchema` to `{ anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }] }`.
- Add to create/update request schemas: `listId` (string, optional), `doAt` (nullable string), `effort` (`{ anyOf: [{ type:"string", enum:["quick","medium","large"] }, { type:"null" }] }`), `recurrence` (nullable object).
- Add `TaskListDto`/`TaskTagDto` interfaces + `taskListDtoSchema`/`taskTagDtoSchema` + `listTaskListsResponseSchema`/`listTaskTagsResponseSchema` + `createTaskListRequestSchema`/`createTaskTagRequestSchema` + route schemas (`listTaskListsRouteSchema`, etc.), mirroring the existing schema style in this file.

(Full field lists are enumerated in the spec §"Schema deltas"; reproduce the exact property objects following the `nullableStringSchema` pattern already in the file.)

- [ ] **Step 4: Run** — `vitest run tests/integration/tasks.test.ts -t "TASK_STATUSES"` → PASS; `pnpm --filter @jarv1s/shared typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tasks-api.ts tests/integration/tasks.test.ts
git commit -m "feat(shared): narrow TaskStatus; extend Task DTO; add List/Tag contracts"
```

---

## Task 4: Lists + Tags repository (`lists.ts`) + get-or-create Personal

**Files:**

- Create: `packages/tasks/src/lists.ts`
- Modify: `packages/tasks/src/index.ts`
- Test: `tests/integration/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("lists: get-or-create Personal is idempotent; tags are list-scoped", async () => {
  const listsRepo = new TaskListsRepository();
  const a = await dataContext.withDataContext(userAContext(), (db) =>
    listsRepo.getOrCreateDefault(db)
  );
  const b = await dataContext.withDataContext(userAContext(), (db) =>
    listsRepo.getOrCreateDefault(db)
  );
  expect(a.id).toBe(b.id);
  expect(a.name).toBe("Personal");

  const tag = await dataContext.withDataContext(userAContext(), (db) =>
    listsRepo.createTag(db, a.id, "Visa")
  );
  const tags = await dataContext.withDataContext(userAContext(), (db) =>
    listsRepo.listTags(db, a.id)
  );
  expect(tags.map((t) => t.name)).toContain("Visa");
  expect(tag.list_id).toBe(a.id);
});
```

(Import `TaskListsRepository` from `@jarv1s/tasks`.)

- [ ] **Step 2: Run** — `vitest run tests/integration/tasks.test.ts -t "list-scoped"`. Expected: FAIL (no export).

- [ ] **Step 3: Implement `packages/tasks/src/lists.ts`**

```ts
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { assertDataContextDb, type DataContextDb, type TaskList, type TaskTag } from "@jarv1s/db";

export class TaskListsRepository {
  async getOrCreateDefault(db: DataContextDb): Promise<TaskList> {
    return this.getOrCreate(db, "Personal");
  }

  async getOrCreate(db: DataContextDb, name: string): Promise<TaskList> {
    assertDataContextDb(db);
    const existing = await db.db
      .selectFrom("app.task_lists")
      .selectAll()
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .executeTakeFirst();
    if (existing) return existing;
    return db.db
      .insertInto("app.task_lists")
      .values({ id: randomUUID(), owner_user_id: sql<string>`app.current_actor_user_id()`, name })
      .onConflict((oc) => oc.columns(["owner_user_id"]).doNothing())
      .returningAll()
      .executeTakeFirst()
      .then((row) => row ?? this.getOrCreate(db, name)); // lost race → re-select
  }

  async list(db: DataContextDb): Promise<TaskList[]> {
    assertDataContextDb(db);
    return db.db
      .selectFrom("app.task_lists")
      .selectAll()
      .orderBy("position")
      .orderBy("name")
      .execute();
  }

  async createTag(db: DataContextDb, listId: string, name: string): Promise<TaskTag> {
    assertDataContextDb(db);
    return db.db
      .insertInto("app.task_tags")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        list_id: listId,
        name
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listTags(db: DataContextDb, listId: string): Promise<TaskTag[]> {
    assertDataContextDb(db);
    return db.db
      .selectFrom("app.task_tags")
      .selectAll()
      .where("list_id", "=", listId)
      .orderBy("name")
      .execute();
  }
}
```

> Note the `onConflict` target is the unique `(owner_user_id, lower(name))` index — Kysely needs `onConflict` on the index columns; if the expression index can't be targeted directly, use `sql` raw `ON CONFLICT DO NOTHING` and re-select. Verify against the generated SQL.

Add to `packages/tasks/src/index.ts`: `export * from "./lists.js";`

- [ ] **Step 4: Run** — `vitest run tests/integration/tasks.test.ts -t "list-scoped"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/lists.ts packages/tasks/src/index.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): lists + list-scoped tags repository with idempotent default list"
```

---

## Task 5: Task create/update with new fields + provenance idempotency

**Files:**

- Modify: `packages/tasks/src/repository.ts` (CreateTaskInput/UpdateTaskInput + create/update), `packages/tasks/src/routes.ts` (`serializeTask`)
- Test: `tests/integration/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("create defaults to Personal list, accepts new fields, and is idempotent on (source, external_key)", async () => {
  const listsRepo = new TaskListsRepository();
  const made = await dataContext.withDataContext(userAContext(), async (db) => {
    const list = await listsRepo.getOrCreateDefault(db);
    return repository.create(db, {
      title: "ship the deck",
      priority: 4,
      effort: "medium",
      doAt: new Date("2026-06-10"),
      source: "chat",
      externalKey: "chat:42",
      listId: list.id
    });
  });
  expect(made.priority).toBe(4);
  expect(made.effort).toBe("medium");

  const second = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "dup", source: "chat", externalKey: "chat:42" })
  );
  expect(second.id).toBe(made.id); // idempotent: same (source, external_key) → same task
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — extend `CreateTaskInput`/`UpdateTaskInput` with `listId?`, `doAt?`, `effort?`, `parentTaskId?`, `source?`, `sourceRef?`, `externalKey?`, `recurrence?`. In `create`: default `list_id` via `TaskListsRepository.getOrCreateDefault` when absent; set `source ?? 'manual'`; when `externalKey` is set, first `SELECT` an existing task for `(source, external_key)` and return it if found (idempotency); insert the new columns. Constrain `priority` to 1–5 at the route layer. Update `serializeTask` to emit the new DTO fields (`listId`, `parentTaskId`, `position`, `doAt`, `effort`, `source`, `sourceRef`).

- [ ] **Step 4: Run** → PASS. `pnpm typecheck` green.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/repository.ts packages/tasks/src/routes.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): task create/update with list/do-date/effort/provenance + idempotency"
```

---

## Task 6: Hierarchy + breakdown + completion cascade (`breakdown.ts`)

**Files:**

- Create: `packages/tasks/src/breakdown.ts`; Modify: `packages/tasks/src/repository.ts` (complete/cascade), `index.ts`
- Test: `tests/integration/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("breakdown augments into a parent; all children done auto-closes parent; grandchild rejected", async () => {
  const breakdown = new TaskBreakdownRepository();
  const { parent, children } = await dataContext.withDataContext(userAContext(), async (db) => {
    const p = await repository.create(db, { title: "clean kitchen" });
    const kids = await breakdown.breakDown(db, p.id, ["unload dishwasher", "wipe counters"]);
    return { parent: p, children: kids };
  });
  expect(children).toHaveLength(2);
  expect(children[0].parent_task_id).toBe(parent.id);

  // grandchild rejected
  await expect(
    dataContext.withDataContext(userAContext(), (db) =>
      breakdown.breakDown(db, children[0].id, ["nope"])
    )
  ).rejects.toThrow(/one-level hierarchy/);

  // completing all children auto-closes the parent
  await dataContext.withDataContext(userAContext(), async (db) => {
    for (const c of children) await repository.updateStatus(db, c.id, "done");
  });
  const reloaded = await dataContext.withDataContext(userAContext(), (db) =>
    repository.getById(db, parent.id)
  );
  expect(reloaded?.status).toBe("done");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `breakdown.ts` `breakDown(db, parentId, steps)` — insert ordered children (`position` 0..n) inheriting the parent's `list_id`, emit a `broken_down` activity row. In `repository.update`/`updateStatus`: after a child reaches `done`, if all siblings are `done`, set the parent `done`; when a parent is set `done`/`archived`, close its open children. Emit activity for cascade transitions. (Triggers enforce no-grandchild / recurring-parent; the cascade is repository-level so activity is recorded.)

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/breakdown.ts packages/tasks/src/repository.ts packages/tasks/src/index.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): one-level hierarchy, breakdown, completion cascade"
```

---

## Task 7: Fixed-schedule recurrence (`recurrence.ts`)

**Files:** Create `packages/tasks/src/recurrence.ts`; Modify `repository.ts` (hook into complete), `index.ts`; Test `tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("completing a recurring task generates exactly one next instance; idempotent", async () => {
  const made = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, {
      title: "take out trash",
      recurrence: { freq: "weekly", interval: 1, occurrence_date: "2026-06-08" },
      dueAt: new Date("2026-06-08")
    })
  );
  await dataContext.withDataContext(userAContext(), (db) =>
    repository.updateStatus(db, made.id, "done")
  );
  const series = await dataContext.withDataContext(userAContext(), (db) =>
    db.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("recurrence_series_id", "=", made.recurrence_series_id!)
      .execute()
  );
  const open = series.filter((t) => t.status === "todo");
  expect(open).toHaveLength(1);
  expect(open[0].id).not.toBe(made.id);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — on `create` with `recurrence`, assign a `recurrence_series_id` (new uuid) and store `occurrence_date`. `recurrence.ts` `generateNext(db, task)` computes the next `occurrence_date`/`due_at`/`do_at` from `freq`+`interval`, inserts a new instance (`source='recurrence'`, same series, advanced dates) — relying on the `(recurrence_series_id, occurrence_date)` unique index for idempotency (catch unique violation → no-op). Call `generateNext` from the complete path when the completed task has a `recurrence`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/recurrence.ts packages/tasks/src/repository.ts packages/tasks/src/index.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): fixed-schedule recurrence, one live instance, idempotent generation"
```

---

## Task 8: Drift + focus queries (`drift.ts`)

**Files:** Create `packages/tasks/src/drift.ts`; Modify `index.ts`; Test `tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("drift: overdue + at-risk surface Medium+ only; focus orders them", async () => {
  const drift = new TaskDriftRepository();
  await dataContext.withDataContext(userAContext(), async (db) => {
    await repository.create(db, {
      title: "overdue-critical",
      priority: 5,
      dueAt: new Date("2000-01-01")
    });
    await repository.create(db, {
      title: "overdue-someday",
      priority: 1,
      dueAt: new Date("2000-01-01")
    });
  });
  const overdue = await dataContext.withDataContext(userAContext(), (db) => drift.getOverdue(db));
  const atRisk = await dataContext.withDataContext(userAContext(), (db) => drift.getAtRisk(db));
  expect(overdue.map((t) => t.title)).toContain("overdue-critical");
  expect(atRisk.map((t) => t.title)).not.toContain("overdue-someday"); // priority < 3 excluded
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `drift.ts` — `getOverdue` (status `todo` AND `due_at < now()`), `getAtRisk` (status `todo`, `priority >= 3`, `due_at` within window OR `do_at < now()`, AND lacking progress), `getFocus` (union ordered by priority desc, due_at asc, effort). Pure selects; no writes.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/drift.ts packages/tasks/src/index.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): drift (overdue/at-risk Medium+) and focus queries"
```

---

## Task 9: Routes — lists/tags/breakdown/recurrence/query + invert in_progress

**Files:** Modify `packages/tasks/src/routes.ts`, `packages/tasks/src/manifest.ts` (route declarations), `tests/integration/tasks.test.ts`

- [ ] **Step 1: Write/adjust failing tests**
  - **Invert** the existing assertion (`tasks.test.ts:~360-396`): change the PATCH payload `status: "in_progress"` test to expect `400` and assert the body is unchanged. New assertion:
    ```ts
    expect(patchResponse.statusCode).toBe(400); // in_progress retired
    ```
  - Add route tests for: `GET /api/tasks/lists`, `POST /api/tasks/lists`, `POST /api/tasks/lists/:id/tags`, `POST /api/tasks/:id/breakdown`, `GET /api/tasks/focus`, `GET /api/tasks/at-risk`, `GET /api/tasks` with `?quadrant=do`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** new routes in `routes.ts` (reuse the existing `withDataContext` + `handleRouteError` pattern), register them in `manifest.ts` `routes` with their `@jarv1s/shared` schemas. **Reject `in_progress` behaviorally** (the JSON schema still lists it — type narrowing is Plan 3): in `optionalTaskStatus`/`requiredTaskStatus`/`parseDeferredStatusBody`, explicitly `throw new HttpError(400, "status is invalid")` when the value is `"in_progress"`. Assert the inverted test gets 400.

> **Deferred to Plan 3 (atomic with web):** narrow `TASK_STATUSES`/`@jarv1s/shared` + `@jarv1s/db` `TaskStatus` to `todo|done|archived`, update `apps/web/src/tasks/task-format.ts` + `tasks-page.tsx`, and remove the now-redundant runtime guard. Doing it there keeps every Plan 1 commit's `pnpm typecheck` (which includes web) green.

- [ ] **Step 4: Run** — `pnpm test:tasks` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/routes.ts packages/tasks/src/manifest.ts tests/integration/tasks.test.ts
git commit -m "feat(tasks): REST for lists/tags/breakdown/recurrence/focus/drift; reject in_progress"
```

---

## Task 10: Full gate + close-out of Plan 1

- [ ] **Step 1:** `pnpm verify:foundation` → green (lint, format:check, check:file-size — confirm no tasks file > 1000 lines after decomposition, typecheck, db:migrate, integration tests).
- [ ] **Step 2:** `pnpm audit:release-hardening` → green.
- [ ] **Step 3:** Update epic #6 — check off the migration / lists-tags / hierarchy / priority-fields / recurrence / statuses / activity / drift exit-criteria boxes that Plan 1 satisfies (leave UI + assistant-tools boxes for Plans 2/3).
- [ ] **Step 4:** Save an agentmemory/file-memory note for any non-obvious decision surfaced during build (e.g. the Kysely `onConflict` expression-index workaround).

---

## Self-Review (done while writing)

- **Spec coverage:** schema deltas, lists/tags, hierarchy/breakdown, priority/effort/do-date, recurrence, drift/focus, status narrowing, provenance + idempotency, activity `actor_kind` — all have tasks. **Matrix view + priority-grouped default view + `default_view` preference UI** are Plan 3 (web); the `default_view` _table_ is created in Task 1. **Read assistant tools** are Plan 2. **@Jarvis / write tools** are out of milestone.
- **Placeholder scan:** the two prose-described areas (Task 3 schema property objects, Task 9 route bodies) point to the exact spec section + the existing in-file pattern to copy; no "TBD"/"add error handling" placeholders. Flag for the builder: reproduce those following the cited existing patterns.
- **Type consistency:** `TaskListsRepository`, `TaskBreakdownRepository`, `TaskDriftRepository`, `getOrCreateDefault`, `breakDown`, `getOverdue`/`getAtRisk`/`getFocus`, `recurrence_series_id`, `occurrence_date` used consistently across tasks and match the Task 2 types.
