# Recurrence JSONB Boundary Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: drive task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock in safe runtime validation at the persisted recurrence JSONB boundary with focused regression tests for valid and malformed persisted shapes.

**Architecture:** The unsafe `as unknown as RecurrenceSpec` double-cast that issue #297 targets was **already removed** in commit `e197216` (#273 overnight batch) and replaced with a runtime guard, `parseRecurrenceSpec(value: unknown): RecurrenceSpec | null`, used at all three boundaries: route input (`optionalRecurrence`), `generateNext`, and `rollForwardRecurringSeries`. The genuine residual is **test coverage**: the guard itself has no direct unit test, and there is no test proving a malformed _persisted_ row is handled as a safe no-op. This plan adds those tests; no production code change is required.

**Tech Stack:** TypeScript, Vitest, Kysely, Postgres (integration via `pnpm db:up`), `@jarv1s/tasks`.

## Global Constraints

- No migrations (relevance check: this is a read-boundary validation + tests change; no schema change). Verified — the `recurrence` column is already `jsonb` typed `Record<string, unknown> | null` in `packages/db/src/types.ts`.
- Honor all CLAUDE.md Hard Invariants. No secrets in tests/logs. `DataContextDb` only; `app.current_actor_user_id()` owner scoping preserved.
- Preserve existing recurrence scheduling semantics for valid rows — tests must not alter behavior, only assert it.
- Stage only changed files; no repo-wide `pnpm format` / broad `git add`.
- Do not touch shared task recurrence contract (`packages/shared/tasks-api.ts`) — `serializeTask` does not emit `recurrence`, so no contract change is in scope.

---

### Task 1: Direct unit tests for `parseRecurrenceSpec` — valid shapes

**Files:**

- Modify: `tests/unit/tasks-recurrence-rollforward.test.ts` (add `parseRecurrenceSpec` to the existing `@jarv1s/tasks` import; append a new `describe` block)
- Test: same file

**Interfaces:**

- Consumes: `parseRecurrenceSpec` from `@jarv1s/tasks` (exported via `recurrence.js` → `index.ts`). Signature: `parseRecurrenceSpec(value: unknown): RecurrenceSpec | null`. `RecurrenceSpec = { freq: "daily" | "weekly" | "monthly"; interval: number; occurrence_date: string }`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `parseRecurrenceSpec` to the existing import**

In `tests/unit/tasks-recurrence-rollforward.test.ts`, extend the existing import block:

```ts
import {
  computeNextOccurrenceDate,
  advanceDate,
  nextOccurrenceAtOrAfter,
  recurrenceCronExpr,
  reconcileRecurrenceSchedule,
  parseRecurrenceSpec
} from "@jarv1s/tasks";
```

- [ ] **Step 2: Write the failing/asserting test block for valid shapes**

Append at the end of the file:

```ts
describe("parseRecurrenceSpec — valid persisted shapes", () => {
  it("accepts a daily spec and returns a normalized object", () => {
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" })
    ).toEqual({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" });
  });

  it("accepts weekly and monthly freqs", () => {
    expect(
      parseRecurrenceSpec({ freq: "weekly", interval: 2, occurrence_date: "2026-06-08" })
    ).toEqual({ freq: "weekly", interval: 2, occurrence_date: "2026-06-08" });
    expect(
      parseRecurrenceSpec({ freq: "monthly", interval: 3, occurrence_date: "2026-01-31" })
    ).toEqual({ freq: "monthly", interval: 3, occurrence_date: "2026-01-31" });
  });

  it("strips unknown keys, returning only the three canonical fields", () => {
    expect(
      parseRecurrenceSpec({
        freq: "daily",
        interval: 1,
        occurrence_date: "2026-06-08",
        injected: "ignore-me",
        occurrence_count: 99
      })
    ).toEqual({ freq: "daily", interval: 1, occurrence_date: "2026-06-08" });
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `vitest run tests/unit/tasks-recurrence-rollforward.test.ts -t "valid persisted shapes"`
Expected: PASS (the guard already exists; these tests document its contract).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/tasks-recurrence-rollforward.test.ts
git commit -m "test(tasks): cover parseRecurrenceSpec valid persisted shapes (#297)"
```

---

### Task 2: Unit tests for `parseRecurrenceSpec` — malformed shapes return null

**Files:**

- Modify: `tests/unit/tasks-recurrence-rollforward.test.ts` (append a second `describe` block)
- Test: same file

**Interfaces:**

- Consumes: `parseRecurrenceSpec` (imported in Task 1).
- Produces: nothing.

- [ ] **Step 1: Write the asserting test block for malformed shapes**

Append at the end of the file:

```ts
describe("parseRecurrenceSpec — malformed persisted shapes return null", () => {
  it("rejects nullish and non-object values", () => {
    expect(parseRecurrenceSpec(null)).toBeNull();
    expect(parseRecurrenceSpec(undefined)).toBeNull();
    expect(parseRecurrenceSpec("not-an-object")).toBeNull();
    expect(parseRecurrenceSpec(42)).toBeNull();
    expect(parseRecurrenceSpec(["freq", "daily"])).toBeNull();
  });

  it("rejects unknown or missing freq", () => {
    expect(parseRecurrenceSpec({ interval: 1, occurrence_date: "2026-06-08" })).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "yearly", interval: 1, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "", interval: 1, occurrence_date: "2026-06-08" })
    ).toBeNull();
  });

  it("rejects non-positive, non-integer, or non-numeric interval", () => {
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 0, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: -1, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1.5, occurrence_date: "2026-06-08" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: "1", occurrence_date: "2026-06-08" })
    ).toBeNull();
  });

  it("rejects a missing, mistyped, or malformed occurrence_date", () => {
    expect(parseRecurrenceSpec({ freq: "daily", interval: 1 })).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: 20260608 })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-6-8" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-13-01" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "2026-02-30" })
    ).toBeNull();
    expect(
      parseRecurrenceSpec({ freq: "daily", interval: 1, occurrence_date: "not-a-date" })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `vitest run tests/unit/tasks-recurrence-rollforward.test.ts -t "malformed persisted shapes"`
Expected: PASS.

NOTE — if `"2026-02-30"` or `"2026-13-01"` does NOT return null, that exposes a real guard gap in `isValidOccurrenceDate`; STOP and escalate to the coordinator rather than weakening the test. (Pre-check: `isValidOccurrenceDate` re-serializes via `Date` and compares the round-tripped `YYYY-MM-DD`, so both should already reject — but the test is the proof.)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/tasks-recurrence-rollforward.test.ts
git commit -m "test(tasks): cover parseRecurrenceSpec malformed persisted shapes (#297)"
```

---

### Task 3: Integration test — malformed persisted recurrence is a safe no-op at the read boundary

**Files:**

- Modify: `tests/integration/tasks.test.ts` (add one `it` inside the existing recurrence-related `describe`; reuse existing helpers `dataContext`, `userAContext`, `repository`, `rollForwardRecurringSeries`, `sql`, `randomUUID`)
- Test: same file

**Interfaces:**

- Consumes: `rollForwardRecurringSeries(db: DataContextDb, seriesId: string, today?: string): Promise<boolean>` and `generateNext(db, task): Promise<Task | null>` from `@jarv1s/tasks`; existing suite fixtures.
- Produces: nothing.

This test writes a deliberately malformed recurrence JSONB directly to a persisted row (bypassing the route guard, exactly as a legacy/corrupt row would), then asserts the read-side consumers treat it as a benign no-op instead of throwing or corrupting data — proving the boundary guard holds for persisted data.

- [ ] **Step 1: Confirm the import line already includes `generateNext` and `rollForwardRecurringSeries`**

Check the top-of-file `@jarv1s/tasks` import in `tests/integration/tasks.test.ts`. If `generateNext` is not already imported, add it to that existing import block. (`rollForwardRecurringSeries` and `isTasksRecurrenceOccurrenceConflict` are already imported — confirmed at lines 578/592.)

- [ ] **Step 2: Write the asserting integration test**

Add inside the existing recurrence `describe` block (near the collision-guard test around line 588):

```ts
it("treats a malformed persisted recurrence JSONB as a safe no-op (read boundary)", async () => {
  // A corrupt/legacy row: interval is a string, freq is unknown — the kind of shape the
  // route guard would reject, but which could exist in persisted data. The series id is
  // self-consistent so the row is selectable; only the spec payload is malformed.
  const seriesId = randomUUID();
  const list = await dataContext.withDataContext(userAContext(), (db) =>
    repository.create(db, { title: "malformed-anchor" })
  );

  const malformedId = randomUUID();
  await dataContext.withDataContext(userAContext(), (db) =>
    db.db
      .insertInto("app.tasks")
      .values({
        id: malformedId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        list_id: list.list_id,
        title: "malformed-recurrence",
        status: "todo",
        position: 0,
        source: "recurrence",
        recurrence: { freq: "weekly-ish", interval: "soon" } as unknown as Record<string, unknown>,
        recurrence_series_id: seriesId
      })
      .execute()
  );

  // rollForwardRecurringSeries must not throw and must report "nothing advanced".
  const rolled = await dataContext.withDataContext(userAContext(), (db) =>
    rollForwardRecurringSeries(db, seriesId, "2026-06-18")
  );
  expect(rolled).toBe(false);

  // generateNext on the same malformed row must not throw and must return null (no new instance).
  const malformedRow = await dataContext.withDataContext(userAContext(), (db) =>
    db.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("id", "=", malformedId)
      .executeTakeFirstOrThrow()
  );
  const generated = await dataContext.withDataContext(userAContext(), (db) =>
    generateNext(db, malformedRow)
  );
  expect(generated).toBeNull();

  // The malformed row is untouched — not corrupted, not advanced, still todo.
  const after = await dataContext.withDataContext(userAContext(), (db) =>
    db.db
      .selectFrom("app.tasks")
      .selectAll()
      .where("id", "=", malformedId)
      .executeTakeFirstOrThrow()
  );
  expect(after.status).toBe("todo");
  expect(after.recurrence).toEqual({ freq: "weekly-ish", interval: "soon" });
});
```

- [ ] **Step 3: Run with Postgres up**

Run: `pnpm db:up && vitest run tests/integration/tasks.test.ts -t "safe no-op"`
Expected: PASS. If `generateNext`'s signature requires fields absent from `selectAll()`, adjust the row read — do not change production code.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/tasks.test.ts
git commit -m "test(tasks): malformed persisted recurrence is a safe read-boundary no-op (#297)"
```

---

### Task 4: Final gate + wrap-up handoff

**Files:** none (verification only)

- [ ] **Step 1: Pre-push trio + rebase**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

- [ ] **Step 2: Targeted recurrence test run**

```bash
pnpm db:up
vitest run tests/unit/tasks-recurrence-rollforward.test.ts
vitest run tests/integration/tasks.test.ts
```

Expected: all green.

- [ ] **Step 3: Hand off to `coordinated-wrap-up`** (open PR, report PR + evidence to `Coordinator`). Do not touch board/milestone/merge.

---

## Self-Review

**1. Spec coverage (#297):**

- "Parse and validate recurrence JSONB into RecurrenceSpec once at the boundary with a small guard" → already satisfied by `parseRecurrenceSpec` (#273); Tasks 1–2 lock it with direct tests.
- "Remove the unsafe double-cast" → already removed in `e197216`; verified absent from the tree. Documented in Architecture so the coordinator/reviewer sees the scope reduction.
- "Add focused tests covering valid recurrence specs and malformed persisted shapes" → Tasks 1 (valid), 2 (malformed inputs to the guard), 3 (malformed _persisted_ shape end-to-end).
- "Preserve existing recurrence scheduling semantics for valid rows" → no production change; existing valid-row tests untouched.
- "Avoid migrations unless relevance proves necessary" → relevance check done: column already `jsonb`; no migration.

**2. Placeholder scan:** none — every code step shows full content.

**3. Type consistency:** `parseRecurrenceSpec`, `rollForwardRecurringSeries`, `generateNext` signatures match `recurrence.ts`. `RecurrenceSpec` shape matches. `Record<string, unknown>` cast in Task 3 mirrors the existing pattern at `tasks.test.ts:564`.

**Escalation note for coordinator:** the code fix this issue describes already landed in main (#273). Scope reduces to regression tests that prove the boundary is safe — no production code change. Flagging because this changes the deliverable from "fix + test" to "test only."
