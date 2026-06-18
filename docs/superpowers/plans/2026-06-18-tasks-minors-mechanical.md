# Tasks Minors Mechanical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the issue #299 tasks-only mechanical minors without touching the design question or other subsystem minors.

**Architecture:** Keep recurrence validation at the route/parser boundary, remove dead task serializer public surface, keep shared REST DTOs aligned with accepted recurrence specs, and make the quadrant rule single-sourced for backend and frontend through browser-safe shared constants. Drop the assistant-tool `idempotencyKey` from `tasks.updateStatus` because this tool performs the write synchronously and has no job enqueue/dedupe path to carry the key through.

**Tech Stack:** TypeScript, Fastify JSON schemas, Kysely, Vitest, pnpm workspace packages `@jarv1s/shared` and `@jarv1s/tasks`.

---

## File Structure

- Modify `packages/shared/src/tasks-api.ts`
  - Add `RecurrenceSpecDto` (`freq`, `interval`, `occurrence_date`) and closed `recurrenceSpecDtoSchema`.
  - Change `CreateTaskRequest.recurrence` and `UpdateTaskRequest.recurrence` to `RecurrenceSpecDto | null`.
  - Reuse `recurrenceSpecDtoSchema` in create/update request JSON schemas.
- Modify `packages/shared/src/tasks-view.ts`
  - Keep browser-safe task view helpers.
  - Add/export `TASK_URGENCY_WINDOW_HOURS`, `TASK_URGENCY_WINDOW_MS`, `TASK_IMPORTANT_PRIORITY_MIN`, and `TASK_QUADRANT_AXES`.
  - Update `quadrantOf` to derive from those constants/matrix.
- Modify `packages/tasks/src/classification.ts`
  - Import/re-export shared quadrant constants/types from `@jarv1s/shared`.
  - Keep backend-only `isTaskImportant`, `isTaskUrgent`, and `classifyTaskQuadrant` because they accept DB `Task` rows.
- Modify `packages/tasks/src/serialize.ts`
  - Delete dead `getQuadrant` and `filterByQuadrant` exports.
- Modify `packages/tasks/src/repository.ts`
  - Remove unreachable recurrence `occurrence_date` derivation branch in `create`; route parsing now requires a normalized `RecurrenceSpec`.
  - Keep series id assignment and JSON clone.
- Modify `packages/tasks/src/tools.ts`
  - Remove unused `idempotencyKey` from `taskUpdateStatusExecute` input cast.
- Modify `packages/tasks/src/manifest.ts`
  - Remove `idempotencyKey` from `tasks.updateStatus` input schema.
- Modify `tests/integration/tasks-tools.test.ts`
  - Remove `getQuadrant` import/test.
  - Add/adjust manifest assertion proving `tasks.updateStatus` no longer advertises `idempotencyKey`.
- Modify `tests/integration/tasks-view.test.ts`
  - Add tests proving frontend `quadrantOf` uses exported matrix/constants for all four quadrants.
- Modify `tests/unit/shared-contract-schemas.test.ts`
  - Add Fastify schema tests proving recurrence accepts only the closed DTO shape and strips unknown nested keys.
- Run focused tests with `JARVIS_PGDATABASE=jarvis_build_tasks299` for integration tests.

## Scope Decisions

- `filterByQuadrant`: delete. `rg` shows no production callers; only old test surface remains.
- `getQuadrant`: delete. It is only a forwarding shim to `classifyTaskQuadrant`; current only caller is its own test import. Backend canonical API remains `classifyTaskQuadrant`.
- Recurrence DTO: tighten shared request types and schemas to match `parseRecurrenceSpec`.
- Repository recurrence derivation: delete because `CreateTaskInput.recurrence` is already `RecurrenceSpec`, and `parseRecurrenceSpec` rejects missing `occurrence_date`.
- `tasks.updateStatus` idempotency: drop from assistant-tool manifest instead of wiring through. The tool is synchronous; route-level deferred status already carries `idempotencyKey` through pg-boss.
- Frontend quadrant mirror: include mechanical share by moving pure constants/matrix to `@jarv1s/shared`, which is already browser-safe and already consumed by `@jarv1s/tasks`. Re-export from `packages/tasks/src/classification.ts` to preserve backend import paths.

## Tasks

### Task 1: Recurrence DTO Contract

**Files:**

- Modify: `packages/shared/src/tasks-api.ts`
- Modify: `tests/unit/shared-contract-schemas.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add imports in `tests/unit/shared-contract-schemas.test.ts`:

```ts
import {
  createTaskRequestSchema,
  updateTaskRequestSchema
  // existing imports unchanged
} from "@jarv1s/shared";
```

Add tests after the existing create-required-field test:

```ts
it("createTaskRequestSchema accepts normalized recurrence and strips nested unknown keys", async () => {
  const { status, body } = await parseBody(createTaskRequestSchema, {
    title: "T",
    recurrence: {
      freq: "weekly",
      interval: 1,
      occurrence_date: "2026-06-08",
      extra: "drop-me"
    }
  });

  expect(status).toBe(200);
  expect(body?.recurrence).toEqual({
    freq: "weekly",
    interval: 1,
    occurrence_date: "2026-06-08"
  });
});

it("updateTaskRequestSchema rejects malformed recurrence DTOs", async () => {
  const missingOccurrence = await parseBody(updateTaskRequestSchema, {
    recurrence: { freq: "weekly", interval: 1 }
  });
  const badFreq = await parseBody(updateTaskRequestSchema, {
    recurrence: { freq: "yearly", interval: 1, occurrence_date: "2026-06-08" }
  });
  const badInterval = await parseBody(updateTaskRequestSchema, {
    recurrence: { freq: "weekly", interval: 0, occurrence_date: "2026-06-08" }
  });

  expect(missingOccurrence.status).toBe(400);
  expect(badFreq.status).toBe(400);
  expect(badInterval.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/unit/shared-contract-schemas.test.ts
```

Expected: FAIL because current recurrence schema is open and accepts missing/invalid fields.

- [ ] **Step 3: Implement shared DTO and closed schema**

In `packages/shared/src/tasks-api.ts`, add after `TaskEffort`:

```ts
export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFrequencyDto = (typeof RECURRENCE_FREQUENCIES)[number];

export interface RecurrenceSpecDto {
  readonly freq: RecurrenceFrequencyDto;
  readonly interval: number;
  readonly occurrence_date: string;
}
```

Change request fields:

```ts
readonly recurrence?: RecurrenceSpecDto | null;
```

Add near schemas:

```ts
export const recurrenceSpecDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["freq", "interval", "occurrence_date"],
  properties: {
    freq: { type: "string", enum: RECURRENCE_FREQUENCIES },
    interval: { type: "integer", minimum: 1 },
    occurrence_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
  }
} as const;
```

Replace create/update recurrence schema with:

```ts
recurrence: {
  anyOf: [recurrenceSpecDtoSchema, { type: "null" }];
}
```

- [ ] **Step 4: Run focused unit test**

Run:

```bash
pnpm vitest run tests/unit/shared-contract-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tasks-api.ts tests/unit/shared-contract-schemas.test.ts
git commit -m "fix(tasks): tighten recurrence request contract" -m "Co-Authored-By: Claude"
```

### Task 2: Dead Serializer Quadrant Surface

**Files:**

- Modify: `packages/tasks/src/serialize.ts`
- Modify: `tests/integration/tasks-tools.test.ts`

- [ ] **Step 1: Remove dead tests/imports first**

In `tests/integration/tasks-tools.test.ts`, remove `getQuadrant` from the `@jarv1s/tasks` import and delete:

```ts
it("getQuadrant classifies urgency from the injected clock", () => {
  const task = {
    priority: 5,
    due_at: "2026-06-18T00:00:00.000Z"
  };

  expect(getQuadrant(task as never, new Date("2026-06-16T12:00:00.000Z"))).toBe("do");
  expect(getQuadrant(task as never, new Date("2026-06-10T12:00:00.000Z"))).toBe("schedule");
});
```

- [ ] **Step 2: Verify current production callers**

Run:

```bash
rg -n "filterByQuadrant|getQuadrant" packages tests
```

Expected before implementation: only `packages/tasks/src/serialize.ts` remains, or the just-deleted test references if not yet saved.

- [ ] **Step 3: Delete dead exports**

In `packages/tasks/src/serialize.ts`, remove:

```ts
import { classifyTaskQuadrant, type TaskQuadrant } from "./classification.js";

export function getQuadrant(task: Task, now: Date = new Date()): TaskQuadrant {
  return classifyTaskQuadrant(task, now);
}

export function filterByQuadrant(
  tasks: Task[],
  quadrant: TaskQuadrant,
  now: Date = new Date()
): Task[] {
  return tasks.filter((t) => getQuadrant(t, now) === quadrant);
}
```

- [ ] **Step 4: Run focused integration test**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: PASS after DB is up/migrated.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/serialize.ts tests/integration/tasks-tools.test.ts
git commit -m "fix(tasks): remove dead quadrant serializer helpers" -m "Co-Authored-By: Claude"
```

### Task 3: Repository Recurrence Branch

**Files:**

- Modify: `packages/tasks/src/repository.ts`
- Existing tests: `tests/unit/tasks-recurrence-rollforward.test.ts`, `tests/integration/tasks-rename-recurrence.test.ts`, `tests/integration/tasks-verticals.test.ts`

- [ ] **Step 1: Confirm parser rejects missing occurrence date**

Run:

```bash
pnpm vitest run tests/unit/tasks-recurrence-rollforward.test.ts
```

Expected: PASS, including `parseRecurrenceSpec({ freq: "daily", interval: 1 })` returning null.

- [ ] **Step 2: Remove unreachable derivation**

In `packages/tasks/src/repository.ts`, replace the recurrence create block with:

```ts
// Recurrence specs are normalized at the route boundary by parseRecurrenceSpec.
let recurrenceValue: RecurrenceSpec | null = null;
let recurrenceSeriesId: string | null = null;
if (input.recurrence != null) {
  recurrenceSeriesId = randomUUID();
  recurrenceValue = { ...input.recurrence };
}
```

- [ ] **Step 3: Run recurrence-focused tests**

Run:

```bash
pnpm vitest run tests/unit/tasks-recurrence-rollforward.test.ts
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-rename-recurrence.test.ts tests/integration/tasks-verticals.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/tasks/src/repository.ts
git commit -m "fix(tasks): rely on normalized recurrence specs" -m "Co-Authored-By: Claude"
```

### Task 4: Drop Unused Tool Idempotency Parameter

**Files:**

- Modify: `packages/tasks/src/tools.ts`
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `tests/integration/tasks-tools.test.ts`

- [ ] **Step 1: Add manifest assertion**

In the existing `tasks.updateStatus: execute is defined for confirmation-gated writes` test, add:

```ts
expect(
  (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
).not.toHaveProperty("idempotencyKey");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: FAIL because manifest currently advertises `idempotencyKey`.

- [ ] **Step 3: Remove schema property and unused cast field**

In `packages/tasks/src/manifest.ts`, change the `tasks.updateStatus` input schema properties to:

```ts
        properties: {
          taskId: { type: "string" },
          status: taskStatusSchema
        }
```

In `packages/tasks/src/tools.ts`, change:

```ts
const { taskId, status } = input as { taskId: string; status: unknown };
```

- [ ] **Step 4: Run focused integration test**

Run:

```bash
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/tools.ts packages/tasks/src/manifest.ts tests/integration/tasks-tools.test.ts
git commit -m "fix(tasks): drop unused update-status tool idempotency key" -m "Co-Authored-By: Claude"
```

### Task 5: Share Quadrant Constants With Frontend

**Files:**

- Modify: `packages/shared/src/tasks-view.ts`
- Modify: `packages/tasks/src/classification.ts`
- Modify: `tests/integration/tasks-view.test.ts`
- Existing tests: `tests/integration/tasks-tools.test.ts`

- [ ] **Step 1: Write shared-matrix frontend test**

Change import in `tests/integration/tasks-view.test.ts`:

```ts
import {
  groupByPriority,
  PRIORITY_LEVELS,
  quadrantOf,
  TASK_IMPORTANT_PRIORITY_MIN,
  TASK_QUADRANT_AXES,
  TASK_URGENCY_WINDOW_HOURS,
  type TaskDto
} from "@jarv1s/shared";
```

Add:

```ts
it("exports the quadrant matrix and thresholds used by quadrantOf", () => {
  expect(TASK_IMPORTANT_PRIORITY_MIN).toBe(4);
  expect(TASK_URGENCY_WINDOW_HOURS).toBe(48);
  expect(TASK_QUADRANT_AXES).toEqual({
    do: { important: true, urgent: true },
    schedule: { important: true, urgent: false },
    delegate: { important: false, urgent: true },
    eliminate: { important: false, urgent: false }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/integration/tasks-view.test.ts
```

Expected: FAIL because constants are not exported from shared yet.

- [ ] **Step 3: Move pure quadrant constants into shared**

In `packages/shared/src/tasks-view.ts`, add:

```ts
export const TASK_URGENCY_WINDOW_HOURS = 48;
export const TASK_URGENCY_WINDOW_MS = TASK_URGENCY_WINDOW_HOURS * 60 * 60 * 1000;
export const TASK_IMPORTANT_PRIORITY_MIN = 4;

export const TASK_QUADRANT_AXES: Record<TaskQuadrant, { important: boolean; urgent: boolean }> = {
  do: { important: true, urgent: true },
  schedule: { important: true, urgent: false },
  delegate: { important: false, urgent: true },
  eliminate: { important: false, urgent: false }
};
```

Change `quadrantOf` to:

```ts
export function quadrantOf(task: TaskDto): TaskQuadrant {
  const important = task.priority !== null && task.priority >= TASK_IMPORTANT_PRIORITY_MIN;
  let urgent = false;
  if (task.dueAt) {
    urgent = new Date(task.dueAt).getTime() - Date.now() <= TASK_URGENCY_WINDOW_MS;
  }
  const quadrant = (Object.keys(TASK_QUADRANT_AXES) as TaskQuadrant[]).find(
    (q) => TASK_QUADRANT_AXES[q].important === important && TASK_QUADRANT_AXES[q].urgent === urgent
  );
  return quadrant ?? "eliminate";
}
```

In `packages/tasks/src/classification.ts`, replace local constants/type/matrix with:

```ts
import type { Task } from "@jarv1s/db";
import {
  TASK_IMPORTANT_PRIORITY_MIN,
  TASK_QUADRANT_AXES,
  TASK_URGENCY_WINDOW_MS,
  type TaskQuadrant
} from "@jarv1s/shared";

export {
  TASK_IMPORTANT_PRIORITY_MIN,
  TASK_QUADRANT_AXES,
  TASK_URGENCY_WINDOW_HOURS,
  TASK_URGENCY_WINDOW_MS,
  type TaskQuadrant
} from "@jarv1s/shared";
```

Keep `isTaskImportant`, `isTaskUrgent`, and `classifyTaskQuadrant` unchanged except they use imported constants.

- [ ] **Step 4: Run focused frontend/backend quadrant tests**

Run:

```bash
pnpm vitest run tests/integration/tasks-view.test.ts
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tasks-view.ts packages/tasks/src/classification.ts tests/integration/tasks-view.test.ts
git commit -m "fix(tasks): share quadrant matrix with frontend" -m "Co-Authored-By: Claude"
```

## Verification

- [ ] Run focused unit tests:

```bash
pnpm vitest run tests/unit/shared-contract-schemas.test.ts tests/unit/tasks-recurrence-rollforward.test.ts
```

- [ ] Run focused integration tests with lane DB:

```bash
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm vitest run tests/integration/tasks-tools.test.ts tests/integration/tasks-view.test.ts tests/integration/tasks-rename-recurrence.test.ts tests/integration/tasks-verticals.test.ts
```

- [ ] Run package typecheck before wrap-up:

```bash
pnpm --filter @jarv1s/shared typecheck
pnpm --filter @jarv1s/tasks typecheck
```

- [ ] Before every push, run coordinated-build pre-push trio and rebase:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

- [ ] At closeout, use `coordinated-wrap-up` and run full lane-specific gates:

```bash
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm verify:foundation > /tmp/cb-vf-299-tasks.log 2>&1; echo "VF_EXIT=$?"
JARVIS_PGDATABASE=jarvis_build_tasks299 pnpm audit:release-hardening > /tmp/cb-audit-299-tasks.log 2>&1; echo "AUDIT_EXIT=$?"
```

## Self-Review

- Spec coverage: covers all allowed tasks bullets from issue #299 and handoff. Excludes AI/chat, settings/source-behavior, connectors/infra/scripts, memory/file-size, and design-question bullets.
- Placeholder scan: no placeholder markers; every task has files, commands, and expected results.
- Type consistency: `RecurrenceSpecDto` fields match `RecurrenceSpec` and route parser names; quadrant constants stay browser-safe and are re-exported from backend classification for existing imports.
