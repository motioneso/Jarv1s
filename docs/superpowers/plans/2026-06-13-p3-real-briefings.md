# Implementation Plan — Phase 3: Real Briefings + Ritual Design Direction

**Plan for:** Epic #48 (Phase 3 · Core Value) — criterion #2 ("Real briefings") and criterion #4
("Design direction (#16) applied to the briefing UI + a coherent pass on existing screens").
**Approved specs:**

- `docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md` (real-briefings — the engine)
- `docs/superpowers/specs/2026-06-13-p3-design-direction-ritual-design.md` (design-direction — the surface)

**Grounded on:** branch `phase2-portable-deploy` at `244dc42` (`chore(chat): gate fixups for portable
CLI chat adapter`) — this is the active build branch; the engine code (briefings/chat/ai/jobs/memory)
verified against it. This slice branches from `phase2-portable-deploy` (or its merge into `main`, if
that has landed by build time — confirm the base before branching). Run `pnpm audit:preflight` before
building; it must exit 0. Record the verified commit in the PR. (Migration high-water at grounding:
`0064`, so `0065`+ are free.)

**Executed by:** an autonomous overnight build. This plan is self-contained and dependency-ordered.
Every task is bite-sized TDD: write a failing test → run it and SEE it fail → minimal implementation
with COMPLETE code → run it and SEE it pass → commit with an explicit `git add <paths>` (NEVER
`git add -A` / `git add .` — another session may share this tree).

---

## Goal

Turn the briefings module from a deterministic string-concat summary into a real morning ritual: a
daily, per-user, timezone-correct briefing that is **LLM-synthesized** (provider-agnostic, economy
tier, via the HTTP `generateChat` adapter with in-worker credential decryption) and **grounded** in
the user's commitments, tasks, today's calendar, email signals, vault notes, and the day's chats —
fired by **native per-definition pg-boss cron**, with a "Your morning briefing is ready" notification
on scheduled completion and a **deterministic degraded fallback** whenever synthesis or a source is
unavailable. Implement the NO-OP `handleExtractFactsJob` so chats leave durable facts behind. Then
apply the locked **Ritual** visual direction: a semantic token layer, lightweight UI primitives, an
editorial briefing reading surface, and a coherent token pass across screens — **gated on Ben's
mockup sign-off** before any app-wide CSS restyle.

## Architecture

The trigger/worker/persistence skeleton is unchanged: a scheduled run and a manual run differ only in
`run_kind` (`"scheduled"` vs `"manual"`) and trigger (pg-boss cron vs `POST /:id/run`). Both land on
`BRIEFINGS_RUN_QUEUE`, both execute in `registerDataContextWorker` → `withDataContext(owner)`
(RLS-scoped), both call `BriefingsRepository.generateRun`. Summary generation is extracted to a new
`packages/briefings/src/compose.ts` (keeps `repository.ts` under the 1000-line cap): gather
fixed-priority sections under per-source caps → build one bounded economy prompt → resolve the user's
`summarization`/economy model via the capability router → decrypt the provider credential in-worker →
synthesize through `HttpApiAdapter.generateChat` → persist the narrative to `summary_text` with
provenance/counts/gaps in `source_metadata` (`jsonb`). On any synthesis failure, a deterministic
narrative-shaped fallback is persisted (status `succeeded`, `source_metadata.degraded = true`).

Scheduling is native per-definition pg-boss cron: enable the cron engine at the **worker** call site
only (`createPgBossClient(connectionString, { schedule: true })`), and drive `boss.schedule` /
`boss.unschedule` keyed on `definition.id` from actor-scoped definition mutations + a per-session
self-heal. There is **no cross-user "what's due" read** anywhere.

The design-direction work is presentation-only: a `tokens.css` semantic layer (the only file with hex
literals), a `styles.css` split to stay under the line cap, 4–6 `apps/web/src/ui/` primitives, an
editorial briefing reading surface, static HTML mockups — then, **after Ben signs off the mockups**,
the screen-by-screen token restyle and the briefing-path e2e.

**CRITICAL invariant for the build:** `BriefingRunStatus` is `"succeeded" | "blocked" | "failed"` —
there is **no `"degraded"` status**. "Degraded" is a `source_metadata.degraded` boolean; degraded runs
persist with status `succeeded`. Do NOT add a `degraded` enum value or a migration for it.

## Tech Stack

- **Runtime/build:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, Node 20+.
- **DB:** Postgres 17 (`pgvector/pgvector:pg17`), Kysely query builder, RLS via
  `app.current_actor_user_id()`, branded `DataContextDb` handle. Migrations run by `pnpm db:migrate`.
- **Jobs:** pg-boss `^12.18.2` (`pgboss.schedule` table is `PRIMARY KEY (name, key)`; `ScheduleOptions`
  carries `tz` + `key`). Metadata-only payloads enforced by `ALLOWED_PAYLOAD_KEYS`.
- **AI:** provider-agnostic capability router (`AiRepository.selectModelForCapability`),
  `HttpApiAdapter` (`generateChat`), AES-256-GCM credential envelopes (`createAiSecretCipher`,
  `AiSecretCipher.decryptJson`).
- **Memory:** `MemoryRetriever` (semantic), `MemoryRepository` (pgvector + recency), local embeddings.
- **Tests:** Vitest integration suites against Postgres from `pnpm db:up`; Playwright e2e (mocked REST).
- **Web:** React + Vite + plain CSS + `var()` tokens (NO Tailwind, NO CSS-modules), TanStack Query.

---

## File Structure

### New files

| Path | Purpose |
| --- | --- |
| `packages/briefings/src/compose.ts` | Grounded LLM synthesis: gather sections, build prompt, synthesize, degraded fallback, persist metadata shape. |
| `packages/briefings/src/schedule.ts` | Pure cron-mapping helpers (`cronExprFor`, `timezoneFor`) + `reconcileSchedule` / `reconcileOwnedSchedules`. |
| `packages/structured-state/src/tools.ts` | `commitments.listVisible` read-tool `execute`. |
| `packages/structured-state/sql/0065_commitments_worker_grant.sql` | Worker-role SELECT grant + owner-or-share policy on `app.commitments` (new migration; never edit applied ones). |
| `packages/calendar/sql/<next>_calendar_worker_grant.sql`, `packages/email/sql/<next>_email_worker_grant.sql` | Worker-role SELECT grant + policy mirroring each table's app-role SELECT policy (so the worker can read today's calendar/email). |
| `packages/chat/src/tools.ts` | `chat.listTodaysTurns` read-tool `execute` (non-incognito, today in user tz). |
| `apps/web/src/styles/tokens.css` | Semantic token layer (primitive ramps → semantic tokens → dark/amber overlays). Only file with hex. |
| `apps/web/src/ui/index.ts` | Barrel for UI primitives. |
| `apps/web/src/ui/Card.tsx`, `Stack.tsx`, `SectionHeader.tsx`, `Badge.tsx`, `TimeBucket.tsx`, `ProvisionalRegion.tsx` | Presentational primitives. |
| `apps/web/src/briefings/briefing-reading-view.tsx` | Editorial single-column reading surface for `BriefingRunDto.summaryText`. |
| `apps/web/src/briefings/briefings.css` | Reading-surface styles. |
| `docs/brand/mockups/briefing-reading.html`, `day-view-buckets.html`, `form-heavy.html` | Static taste-gate mockups (self-contained, no build step). |
| `tests/e2e/briefing-reading.spec.ts` | (Post-gate) Playwright spec for the briefing reading path. |

### Modified files

| Path | Change |
| --- | --- |
| `apps/worker/src/worker.ts` | `createPgBossClient(connectionString, { schedule: true })` (cron engine in worker only). |
| `packages/briefings/src/repository.ts` | `generateRun` delegates to `compose.ts`; remove deterministic `generateSummary` body; add local-day idempotency; add deps param. |
| `packages/briefings/src/jobs.ts` | Mint `briefingRunId` for scheduled runs; thread synthesis + notification deps; fire notification on scheduled `succeeded`. |
| `packages/briefings/src/routes.ts` | Reconcile schedule after create/update (failure-isolated). |
| `packages/structured-state/src/manifest.ts` | Add `permissions` + `assistantTools` (`commitments.listVisible`); register new SQL migration. |
| `packages/calendar/src/manifest.ts`, `packages/email/src/manifest.ts` | Register the new worker-grant SQL migrations. |
| `packages/ai/src/chat-adapter.ts`, `packages/ai/src/adapters/http-api.ts` | Add optional `maxOutputTokens` to `GenerateChatInput`; clamp provider `max_tokens` (economy budget). |
| `packages/jobs/src/pg-boss.ts` (+ barrel) | `export` `assertMetadataOnlyPayload` for the schedule-payload guard. |
| `packages/chat/src/manifest.ts` | Add `assistantTools` (`chat.listTodaysTurns`). |
| `packages/chat/src/jobs.ts` | Implement `handleExtractFactsJob`; thread AI deps through `RegisterChatJobWorkersOptions`. |
| `packages/module-registry/src/index.ts` | Inject AI/cipher/fetch/memory/notifications deps into briefings + chat `registerWorkers`. |
| `apps/web/src/styles.css` | Move hex into `tokens.css`; reference semantic `var()`; drop below 1000 lines. |
| `apps/web/src/main.tsx` | Import `styles/tokens.css` first, then `styles.css`, then feature CSS. |
| `apps/web/src/tasks/tasks.css` | (Post-gate) Replace hardcoded hex with semantic tokens; remove inline fallbacks. |
| `apps/web/src/briefings/briefings-page.tsx` | (Post-gate) Render selected run via `BriefingRunView`. |
| `apps/web/src/tasks/tasks-page.tsx`, settings/chat/notifications/auth pages | (Post-gate) Token-adoption restyle. |
| `tests/integration/briefings.test.ts` | Update concat-expectation tests (282-306, 488-526); add synthesis/scheduling/notification/idempotency coverage. |
| `tests/integration/chat.test.ts` (or `tests/integration/memory.test.ts` per existing suite layout) | Add `handleExtractFactsJob` coverage. |

> Before editing a test file, READ it first (Read tool) to confirm exact current assertions and helper
> setup — the line numbers above are from grounding `aaf2ddf` and may have drifted.

---

# Part A — The Briefings Engine (real-briefings spec)

## Task A1 — `schedule.ts`: `cronExprFor` + `timezoneFor` (pure helpers)

**Files**

- Create: `packages/briefings/src/schedule.ts`
- Test: `packages/briefings/test/schedule.test.ts` (Vitest unit; no DB)

**Step 1 — Write the failing test.** Create `packages/briefings/test/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { cronExprFor, timezoneFor } from "../src/schedule.js";

describe("cronExprFor", () => {
  it("maps a HH:MM targetTime to a daily cron expression", () => {
    expect(cronExprFor({ targetTime: "06:00" })).toBe("0 6 * * *");
    expect(cronExprFor({ targetTime: "23:45" })).toBe("45 23 * * *");
  });

  it("defaults to 07:00 when targetTime is absent", () => {
    expect(cronExprFor({})).toBe("0 7 * * *");
  });

  it("defaults to 07:00 when targetTime is malformed", () => {
    expect(cronExprFor({ targetTime: "not-a-time" })).toBe("0 7 * * *");
    expect(cronExprFor({ targetTime: "25:00" })).toBe("0 7 * * *");
    expect(cronExprFor({ targetTime: "6" })).toBe("0 7 * * *");
  });
});

describe("timezoneFor", () => {
  it("returns a valid IANA timezone", () => {
    expect(timezoneFor({ timezone: "America/New_York" })).toBe("America/New_York");
  });

  it("defaults to UTC when absent or invalid", () => {
    expect(timezoneFor({})).toBe("UTC");
    expect(timezoneFor({ timezone: "Not/AZone" })).toBe("UTC");
    expect(timezoneFor({ timezone: 42 as unknown as string })).toBe("UTC");
  });
});
```

**Step 2 — Run it, SEE it FAIL** (module does not exist):

```
pnpm exec vitest run packages/briefings/test/schedule.test.ts
```

**Step 3 — Minimal implementation.** Create `packages/briefings/src/schedule.ts` (helpers only for
this task; `reconcileSchedule` is added in A2):

```ts
import type { PgBoss } from "pg-boss";

import type { BriefingDefinition, DataContextDb } from "@jarv1s/db";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { BRIEFINGS_RUN_QUEUE } from "./manifest.js";
import type { BriefingsRepository } from "./repository.js";

const DEFAULT_TARGET_TIME_CRON = "0 7 * * *";
const DEFAULT_TIMEZONE = "UTC";

/**
 * Derive a daily cron expression from `schedule_metadata.targetTime` ("HH:MM").
 * Defaults to 07:00 local when absent or malformed. Daily cadence only — weekly
 * is out of scope for this slice.
 */
export function cronExprFor(scheduleMetadata: Record<string, unknown>): string {
  const raw = scheduleMetadata.targetTime;
  if (typeof raw !== "string") {
    return DEFAULT_TARGET_TIME_CRON;
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    return DEFAULT_TARGET_TIME_CRON;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return `${minute} ${hour} * * *`;
}

/**
 * Read an IANA timezone from `schedule_metadata.timezone`, validated via
 * Intl.DateTimeFormat. Defaults to UTC when absent or invalid.
 */
export function timezoneFor(scheduleMetadata: Record<string, unknown>): string {
  const raw = scheduleMetadata.timezone;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_TIMEZONE;
  }
  try {
    // Throws RangeError for an unknown timezone — that is our validity check.
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(0);
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
```

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run packages/briefings/test/schedule.test.ts
```

**Step 5 — Commit:**

```
git add packages/briefings/src/schedule.ts packages/briefings/test/schedule.test.ts
git commit -m "feat(briefings): cron + timezone mapping helpers for per-definition scheduling

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A2 — `schedule.ts`: `reconcileSchedule` + `reconcileOwnedSchedules`

**Files**

- Modify: `packages/briefings/src/schedule.ts`
- Test: `packages/briefings/test/schedule.test.ts` (extend with a fake boss; still no DB)

**Step 1 — Write the failing test.** Append to `packages/briefings/test/schedule.test.ts`:

```ts
import { reconcileSchedule } from "../src/schedule.js";
import { BRIEFINGS_RUN_QUEUE } from "../src/manifest.js";
import type { BriefingDefinition } from "@jarv1s/db";

interface ScheduleCall {
  readonly name: string;
  readonly cron: string;
  readonly data: Record<string, unknown>;
  readonly options: { tz?: string; key?: string };
}

function fakeBoss() {
  const scheduleCalls: ScheduleCall[] = [];
  const unscheduleCalls: Array<{ name: string; key: string }> = [];
  return {
    scheduleCalls,
    unscheduleCalls,
    boss: {
      async schedule(name: string, cron: string, data: unknown, options: unknown) {
        scheduleCalls.push({
          name,
          cron,
          data: data as Record<string, unknown>,
          options: options as { tz?: string; key?: string }
        });
      },
      async unschedule(name: string, key: string) {
        unscheduleCalls.push({ name, key });
      }
    }
  };
}

function definition(overrides: Partial<BriefingDefinition>): BriefingDefinition {
  return {
    id: "def-1",
    owner_user_id: "owner-1",
    title: "Morning",
    cadence: "daily",
    schedule_metadata: { targetTime: "06:00", timezone: "America/New_York" },
    enabled: true,
    selected_tool_names: ["tasks.listVisible"],
    last_run_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  } as BriefingDefinition;
}

describe("reconcileSchedule", () => {
  it("schedules a daily enabled definition keyed by id with tz and metadata-only data", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({}));
    expect(unscheduleCalls).toHaveLength(0);
    expect(scheduleCalls).toHaveLength(1);
    const call = scheduleCalls[0]!;
    expect(call.name).toBe(BRIEFINGS_RUN_QUEUE);
    expect(call.cron).toBe("0 6 * * *");
    expect(call.options).toEqual({ tz: "America/New_York", key: "def-1" });
    expect(call.data).toEqual({
      actorUserId: "owner-1",
      definitionId: "def-1",
      runKind: "scheduled"
    });
  });

  it("unschedules when cadence is not daily", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({ cadence: "manual" }));
    expect(scheduleCalls).toHaveLength(0);
    expect(unscheduleCalls).toEqual([{ name: BRIEFINGS_RUN_QUEUE, key: "def-1" }]);
  });

  it("unschedules when disabled", async () => {
    const { boss, scheduleCalls, unscheduleCalls } = fakeBoss();
    await reconcileSchedule(boss as never, definition({ enabled: false }));
    expect(scheduleCalls).toHaveLength(0);
    expect(unscheduleCalls).toEqual([{ name: BRIEFINGS_RUN_QUEUE, key: "def-1" }]);
  });
});
```

**Step 2 — Run it, SEE it FAIL** (`reconcileSchedule` not exported):

```
pnpm exec vitest run packages/briefings/test/schedule.test.ts
```

**Step 3a — Export the metadata guard from `@jarv1s/jobs`.** `assertMetadataOnlyPayload`
(`packages/jobs/src/pg-boss.ts:60`) is currently a file-private `function`. Add `export` to it and
confirm `packages/jobs/src/index.ts` re-exports it (the barrel does `export * from "./pg-boss.js"`; if it
uses a named list, add `assertMetadataOnlyPayload`). It throws on a forbidden key, so `reconcileSchedule`
can call it directly. No behavior change for existing callers (it was already invoked by `sendJob`).

**Step 3b — Minimal implementation.** Append to `packages/briefings/src/schedule.ts`:

```ts
/**
 * Reconcile pg-boss schedule rows for one definition. Keyed on definition.id so
 * create/update/cadence-change/tz-change all upsert through the same (name, key).
 * The scheduled-run data is metadata-only ({actorUserId, definitionId, runKind});
 * the worker mints briefingRunId at fire time. Schedule writes happen in the
 * owner's request context only — there is no cross-user read here.
 */
export async function reconcileSchedule(
  boss: PgBoss,
  definition: BriefingDefinition
): Promise<void> {
  if (definition.cadence === "daily" && definition.enabled) {
    const cron = cronExprFor(definition.schedule_metadata);
    const tz = timezoneFor(definition.schedule_metadata);
    const data = {
      actorUserId: definition.owner_user_id,
      definitionId: definition.id,
      runKind: "scheduled" as const
    };
    // Defense-in-depth: boss.schedule does NOT route through sendJob's metadata guard,
    // so assert the cron payload is metadata-only here too (Hard Invariant). All three
    // keys are in ALLOWED_PAYLOAD_KEYS today; this catches a future drift at the source.
    assertMetadataOnlyPayload(data);
    await boss.schedule(BRIEFINGS_RUN_QUEUE, cron, data, { tz, key: definition.id });
    return;
  }
  await boss.unschedule(BRIEFINGS_RUN_QUEUE, definition.id);
}

/**
 * Per-session self-heal: reconcile only the definitions the actor OWNS. `listDefinitions`
 * is owner-OR-share under RLS (verified: `briefing_definitions_select` is
 * `owner_user_id = current_actor OR has_share(...)`), so we MUST filter to
 * `owner_user_id === actorUserId` — otherwise a viewer-actor would schedule/unschedule a
 * definition they merely have shared view on (a cross-user schedule write). Best-effort:
 * a single reconcile failure is logged (name+message) and does not abort the rest.
 */
export async function reconcileOwnedSchedules(
  boss: PgBoss,
  scopedDb: DataContextDb,
  repository: BriefingsRepository,
  actorUserId: string
): Promise<void> {
  const definitions = await repository.listDefinitions(scopedDb);
  const owned = definitions.filter((d) => d.owner_user_id === actorUserId);
  for (const definition of owned) {
    try {
      await reconcileSchedule(boss, definition);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      console.error(
        JSON.stringify({
          event: "briefing_schedule_reconcile_failed",
          definitionId: definition.id,
          error: e.name,
          message: e.message.slice(0, 200)
        })
      );
    }
  }
}
```

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run packages/briefings/test/schedule.test.ts
```

**Step 5 — Commit:**

```
git add packages/briefings/src/schedule.ts packages/briefings/test/schedule.test.ts
git commit -m "feat(briefings): per-definition schedule reconcile (upsert on definition id)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A3 — `commitments.listVisible` read tool + worker-role grant migration

This is a hard prerequisite for the commitments grounding section. The briefing worker runs as
`jarvis_worker_runtime`; `app.commitments` (migration `0031`) grants SELECT to `jarvis_app_runtime`
ONLY and its SELECT policy targets `jarvis_app_runtime` ONLY. Without a new grant + policy, the worker
cannot read commitments. (Tasks/chat already grant the worker role; commitments does not.)

**Files**

- Create: `packages/structured-state/sql/0065_commitments_worker_grant.sql`
- Create: `packages/structured-state/src/tools.ts`
- Modify: `packages/structured-state/src/manifest.ts`
- Test: `tests/integration/structured-state.test.ts` (extend — READ it first for setup helpers)

**Step 1 — Write the failing test.** Add to `tests/integration/structured-state.test.ts` a test that
(a) the manifest exposes `commitments.listVisible` as a `risk:"read"` tool, and (b) executing it under
a worker-role data context returns the owner's commitments. Mirror the existing module-test setup
(read the file's `beforeAll`/helpers first). Skeleton:

```ts
it("exposes commitments.listVisible as a read tool returning owner-scoped commitments", async () => {
  const tool = (structuredStateModuleManifest.assistantTools ?? []).find(
    (t) => t.name === "commitments.listVisible"
  );
  expect(tool?.risk).toBe("read");
  expect(tool?.permissionId).toBeTruthy();

  // Seed a commitment as the owner, then read via the tool under the SAME actor.
  await dataContext.withDataContext({ actorUserId: ownerId, requestId: "test" }, async (scopedDb) => {
    await commitmentsRepository.create(scopedDb, {
      title: "Pay invoice",
      provenance: "manual"
    });
    const result = await tool!.execute!(scopedDb, {}, {
      actorUserId: ownerId,
      requestId: "test",
      chatSessionId: ""
    });
    const commitments = (result.data as { commitments: unknown[] }).commitments;
    expect(commitments.length).toBeGreaterThanOrEqual(1);
  });
});
```

Also extend the migration-grants assertion (the structured-state suite likely has a grants test like
the briefings one at `briefings.test.ts:102`) to assert `jarvis_worker_runtime` has SELECT on
`app.commitments`.

**Step 2 — Run it, SEE it FAIL:**

```
pnpm db:up && pnpm db:migrate
pnpm exec vitest run tests/integration/structured-state.test.ts
```

(Fails: no such tool / no worker grant.)

**Step 3 — Minimal implementation.**

Create `packages/structured-state/sql/0065_commitments_worker_grant.sql`:

```sql
-- Phase 3 real-briefings: the briefings pg-boss worker runs as jarvis_worker_runtime
-- and must read commitments through the commitments.listVisible read tool. Migration
-- 0031 granted SELECT and a SELECT policy to jarvis_app_runtime only. Add the worker
-- role to both. RLS still scopes to the owner OR an explicit share (mirroring 0031
-- EXACTLY — do not weaken it to owner-only, which would drop shared-commitment
-- visibility for a briefing). New file — never edit the applied 0031.

GRANT SELECT ON app.commitments TO jarvis_worker_runtime;

DROP POLICY IF EXISTS commitments_select_worker ON app.commitments;
CREATE POLICY commitments_select_worker ON app.commitments
  FOR SELECT TO jarvis_worker_runtime
  USING (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('commitment', id, 'view')
  );
```

> CRITICAL: the live `0031` `commitments_select` policy is
> `USING (owner_user_id = app.current_actor_user_id() OR app.has_share('commitment', id, 'view'))`
> — the worker policy above mirrors it EXACTLY (verified at grounding). An owner-only worker policy is a
> shareability regression (see RLS Shareability Map: commitment is owner-or-share). Mirror the FULL
> clause; do not simplify. `0065` is the next free migration number (verified: highest applied is `0064`).
> If a concurrent slice lands `0065` first, bump to the next free number and update the manifest
> `migrations` array to match.

**Step 3a — Add a shared-commitment worker-read test.** In addition to the owner-read test, add a test
that creates a commitment owned by user B, grants user A `view` via the shares mechanism, then under a
**worker-role** data context scoped to user A asserts `commitments.listVisible` returns B's shared
commitment. (Mirror the share-grant helper the shareability suites already use; READ
`tests/integration/structured-state.test.ts` for the exact helper.) This proves the worker policy did
not regress shareability.

Create `packages/structured-state/src/tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { CommitmentsRepository } from "./commitments-repository.js";

const repository = new CommitmentsRepository();

export const commitmentsListVisibleExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const commitments = await repository.listVisible(scopedDb);
  return {
    data: {
      commitments: commitments.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        counterparty: c.counterparty,
        dueAt: c.due_at instanceof Date ? c.due_at.toISOString() : c.due_at
      }))
    }
  };
};
```

> Confirm the `Commitment` field names (`status`, `counterparty`, `due_at`) against
> `packages/structured-state/src/commitments-repository.ts` and `packages/db/src/types.ts` before
> finalizing — adjust the serializer if a name differs.

Modify `packages/structured-state/src/manifest.ts` to register the migration, add a `permissions`
entry, and add the `assistantTools`:

```ts
import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import { commitmentsListVisibleExecute } from "./tools.js";

export const STRUCTURED_STATE_MODULE_ID = "structured-state";
export const structuredStateSqlMigrationDirectory = fileURLToPath(
  new URL("../sql", import.meta.url)
);

export const structuredStateModuleManifest: JarvisModuleManifest = {
  id: STRUCTURED_STATE_MODULE_ID,
  name: "Structured State",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "required",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: true
  },
  database: {
    migrations: [
      "sql/0031_structured_state.sql",
      "sql/0065_commitments_worker_grant.sql"
    ],
    migrationDirectories: ["packages/structured-state/sql"],
    ownedTables: ["app.commitments", "app.entities", "app.preferences"]
  },
  permissions: [
    {
      id: "commitments.view",
      label: "View commitments",
      description: "Read commitments visible to the active actor.",
      scope: "user",
      actions: ["view"]
    }
  ],
  assistantTools: [
    {
      name: "commitments.listVisible",
      description: "List commitments owned by or shared with the active actor.",
      permissionId: "commitments.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: commitmentsListVisibleExecute
    }
  ],
  shareableResources: [
    { resourceType: "commitment", grantLevels: ["view"] },
    { resourceType: "entity", grantLevels: ["view"] }
  ]
};
```

> If the `assistantTools` entry type requires an `outputSchema` (check
> `packages/module-sdk/src/index.ts` `AiAssistantTool*` / how calendar's manifest omits/includes it),
> either add a minimal response schema in `packages/shared/src/structured-state-api.ts` and reference
> it, or follow the exact optionality the SDK type allows. Match the calendar manifest's shape.

**Step 4 — Run it, SEE it PASS:**

```
pnpm db:migrate
pnpm exec vitest run tests/integration/structured-state.test.ts
```

**Step 5 — Commit:**

```
git add packages/structured-state/sql/0065_commitments_worker_grant.sql \
        packages/structured-state/src/tools.ts \
        packages/structured-state/src/manifest.ts \
        tests/integration/structured-state.test.ts
git commit -m "feat(structured-state): commitments.listVisible read tool + worker-role SELECT grant

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A4 — `chat.listTodaysTurns` read tool

Chat tables already grant `jarvis_worker_runtime` SELECT (migration `0036`), so no migration is needed.
The tool lists the actor's non-incognito chat turns created today in the user's tz.

**Files**

- Create: `packages/chat/src/tools.ts`
- Modify: `packages/chat/src/manifest.ts`, `packages/chat/src/repository.ts` (add `listThreadsByActivity`)
- Test: `tests/integration/chat.test.ts` (extend — READ it first)

**Step 1 — Write the failing test.** Add to `tests/integration/chat.test.ts`:

```ts
it("exposes chat.listTodaysTurns as a read tool excluding incognito threads", async () => {
  const tool = (chatModuleManifest.assistantTools ?? []).find(
    (t) => t.name === "chat.listTodaysTurns"
  );
  expect(tool?.risk).toBe("read");

  await dataContext.withDataContext({ actorUserId: ownerId, requestId: "test" }, async (scopedDb) => {
    const normal = await chatRepository.openNewThread(scopedDb, { title: "Today" });
    const secret = await chatRepository.openNewThread(scopedDb, { title: "Secret", incognito: true });
    await chatRepository.recordCompletedTurn(scopedDb, /* ...normal thread, user+assistant... */);
    await chatRepository.recordCompletedTurn(scopedDb, /* ...secret thread... */);

    const result = await tool!.execute!(scopedDb, {}, {
      actorUserId: ownerId,
      requestId: "test",
      chatSessionId: ""
    });
    const turns = (result.data as { turns: Array<{ threadTitle: string }> }).turns;
    expect(turns.some((t) => t.threadTitle === "Today")).toBe(true);
    expect(turns.some((t) => t.threadTitle === "Secret")).toBe(false);
  });
});
```

> Read `chat/repository.ts` for the exact `recordCompletedTurn` signature before writing the seed
> calls; adapt the skeleton.

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/chat.test.ts
```

**Step 3 — Minimal implementation.**

First add a small recency-ordered list method to `packages/chat/src/repository.ts` (the existing
`listThreads` orders by `updated_at`, which is NOT bumped on a turn — see the tool's note; we must order
by `last_active_at` so the scan cap is safe):

```ts
  /**
   * Threads ordered by REAL activity (last_active_at, bumped on every turn via
   * touchThread), most-active first, capped at `limit`. Used by the briefing's
   * today's-chats scan so a long-lived thread active today is never dropped.
   */
  async listThreadsByActivity(scopedDb: DataContextDb, limit: number): Promise<ChatThread[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.chat_threads")
      .selectAll()
      .orderBy("last_active_at", "desc")
      .orderBy("id")
      .limit(limit)
      .execute();
  }
```

> Confirm `last_active_at` is the column name and is non-null for threads (it is set on insert and bumped
> by `touchThread`). Add a test asserting a thread whose only `updated_at` is old but whose
> `last_active_at` is today appears in `listThreadsByActivity` ahead of newer-`updated_at` idle threads.

Create `packages/chat/src/tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { ChatRepository } from "./repository.js";

const repository = new ChatRepository();

const MAX_TURNS = 40;
const EXCERPT_CHARS = 280;
// Bound the thread scan by REAL activity. NOTE: ChatRepository.listThreads orders by
// `updated_at`, which is NOT bumped on a turn (recordCompletedTurn inserts messages;
// touchThread bumps `last_active_at`, not `updated_at`) — so an `updated_at`-ordered cap
// could drop a thread that was active today but created long ago. This tool therefore
// uses a dedicated `listThreadsByActivity` (ordered by `last_active_at DESC`), so the
// most recently active N threads — which hold all of today's turns — are scanned.
const MAX_THREADS_SCANNED = 20;

/**
 * The tool seam carries no tz input, so it conservatively over-includes the last 36h
 * (covers any IANA offset's "today" without dropping an early-morning turn). The
 * AUTHORITATIVE local-day filter is applied by compose, which DOES know the
 * definition's timezone (see A6 `withinLocalDay` on `createdAt`). This window must be
 * wider than any tz offset so compose never sees a turn the tool already dropped.
 */
function startOfTodayUtcWindow(now: Date): Date {
  return new Date(now.getTime() - 36 * 60 * 60 * 1000);
}

export const chatListTodaysTurnsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);

  // Ordered by last_active_at (bumped on every turn), so a long-lived thread active
  // today is NOT dropped by the scan cap. See MAX_THREADS_SCANNED note above.
  const threads = await repository.listThreadsByActivity(scopedDb, MAX_THREADS_SCANNED);
  const since = startOfTodayUtcWindow(new Date());
  const turns: Array<{ role: string; excerpt: string; threadTitle: string; createdAt: string }> = [];

  for (const thread of threads) {
    if (thread.incognito) {
      continue;
    }
    const messages = await repository.listMessages(scopedDb, thread.id);
    for (const message of messages) {
      if (message.status !== "stored") {
        continue;
      }
      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }
      const createdAt = message.created_at instanceof Date ? message.created_at : new Date(message.created_at);
      if (createdAt < since) {
        continue;
      }
      turns.push({
        role: message.role,
        excerpt: message.body.slice(0, EXCERPT_CHARS),
        threadTitle: thread.title,
        createdAt: createdAt.toISOString()
      });
    }
  }

  turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { data: { turns: turns.slice(0, MAX_TURNS) } };
};
```

> Confirm `ChatMessage` field names (`status`, `role`, `body`, `created_at`) and `ChatThread`
> (`incognito`, `title`, `id`) against `packages/db/src/types.ts` before finalizing.

Modify `packages/chat/src/manifest.ts`: add the import and an `assistantTools` array reusing the
existing `chat.view` permission:

```ts
import { chatListTodaysTurnsExecute } from "./tools.js";
```

```ts
  assistantTools: [
    {
      name: "chat.listTodaysTurns",
      description: "List today's non-incognito chat turns for the active actor.",
      permissionId: "chat.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: chatListTodaysTurnsExecute
    }
  ],
```

> Insert `assistantTools` into the existing `satisfies JarvisModuleManifest` object. Match the SDK's
> `assistantTools` typing (mirror calendar's manifest for `outputSchema` optionality).

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/chat.test.ts
```

**Step 5 — Commit:**

```
git add packages/chat/src/tools.ts packages/chat/src/manifest.ts packages/chat/src/repository.ts tests/integration/chat.test.ts
git commit -m "feat(chat): chat.listTodaysTurns read tool (non-incognito, today)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A4b — Worker-role SELECT grants for calendar + email (so the briefing can read them)

The briefing's headline value is "today's calendar + email signals." But `calendar.listVisibleEvents`
and `email.listVisibleMessages` run in the worker as `jarvis_worker_runtime`, and (verified at
grounding) **neither `packages/calendar/sql/*` nor `packages/email/sql/*` grants the worker role SELECT
or a worker SELECT policy** — so without this task the worker silently reads ZERO rows and every
briefing degrades calendar/email to an `empty_cache` gap even when caches are full. That is
under-engineering disguised as graceful degradation. Add the grants now (same cheap pattern as A3),
mirroring each table's existing app-role SELECT policy EXACTLY (owner-or-share where applicable).

**Files**

- Create: `packages/calendar/sql/<next>_calendar_worker_grant.sql`
- Create: `packages/email/sql/<next>_email_worker_grant.sql`
- Modify: `packages/calendar/src/manifest.ts`, `packages/email/src/manifest.ts` (register the new SQL)
- Test: `tests/integration/calendar-email.test.ts` (extend — READ it first)

> Migration numbers are GLOBAL by landing order. Use the next two free numbers after the structured-state
> grant landed in A3 (e.g. `0066`, `0067` if A3 took `0065`). Verify the current max with
> `find packages -path '*/sql/*.sql' | grep -oE '00[0-9]{2}_' | sort -u | tail`.

**Step 1 — Write the failing test.** In `tests/integration/calendar-email.test.ts`, add: under a
**worker-role** data context scoped to the owner, `calendar.listVisibleEvents` and
`email.listVisibleMessages` each return the owner's seeded rows (today they return zero because the
worker has no grant). Also extend the grants assertion to require `jarvis_worker_runtime` SELECT on
`app.calendar_events` and `app.email_messages`.

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/calendar-email.test.ts
```

**Step 3 — Minimal implementation.** First READ `packages/calendar/sql/<the calendar table migration>`
and `packages/email/sql/<the email table migration>` to copy each table's EXACT app-role SELECT policy
USING clause. Then create each grant file mirroring it for the worker role. Calendar example (verify the
real policy first — calendar events are connector-synced, likely owner-or-share):

```sql
-- Phase 3 real-briefings: briefings worker (jarvis_worker_runtime) reads today's
-- calendar via calendar.listVisibleEvents. Mirror the app-role SELECT policy EXACTLY.
GRANT SELECT ON app.calendar_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS calendar_events_select_worker ON app.calendar_events;
CREATE POLICY calendar_events_select_worker ON app.calendar_events
  FOR SELECT TO jarvis_worker_runtime
  USING ( /* paste the EXACT USING clause from the live app-role policy */ );
```

Register each new file in the owning module's `manifest.ts` `database.migrations` array. Do NOT edit any
applied migration.

> If a live app policy uses a clause you cannot safely mirror for the worker (e.g. a session-variable
> the worker context does not set), STOP and flag it in the PR rather than weakening RLS — do not ship a
> broader worker policy than the app policy.

**Step 4 — Run it, SEE it PASS:**

```
pnpm db:migrate
pnpm exec vitest run tests/integration/calendar-email.test.ts
```

**Step 5 — Commit:**

```
git add packages/calendar/sql/ packages/calendar/src/manifest.ts \
        packages/email/sql/ packages/email/src/manifest.ts \
        tests/integration/calendar-email.test.ts
git commit -m "feat(calendar,email): worker-role SELECT grants so briefings can read today's data

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A5 — Vault recency seam (`MemoryRepository.listRecentChunks` + `MemoryRetriever.retrieveRecent`)

**Files**

- Modify: `packages/memory/src/repository.ts`
- Modify: `packages/memory/src/retrieval.ts`
- Test: `tests/integration/memory.test.ts` (extend — READ it first)

**Step 1 — Write the failing test.** Add to `tests/integration/memory.test.ts` a test that seeds two
vault files at different `ingested_at` and asserts `listRecentChunks` returns the most-recent first,
filtered to `source_kind = 'vault'`. Skeleton:

```ts
it("lists recent vault chunks ordered by ingestion recency", async () => {
  await dataContext.withDataContext({ actorUserId: ownerId, requestId: "test" }, async (scopedDb) => {
    // seed two vault files (upsertFileChunks + upsertFileIndex) — older then newer
    const recent = await memoryRepository.listRecentChunks(scopedDb, 5, "vault");
    expect(recent.length).toBeGreaterThanOrEqual(1);
    // newest source_path appears before the older one
  });
});
```

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/memory.test.ts
```

**Step 3 — Minimal implementation.** Add to `packages/memory/src/repository.ts` (inside
`MemoryRepository`), joining chunks to the file index for `ingested_at`:

```ts
  /**
   * Recent chunks for a source kind, ordered by their file's ingestion recency.
   * Used by briefings' hybrid vault retrieval (semantic ∪ recency). RLS scopes to
   * the owner via app.current_actor_user_id().
   */
  async listRecentChunks(
    scopedDb: DataContextDb,
    limit: number,
    sourceKind: string = "vault"
  ): Promise<RetrievedChunk[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<{
      id: string;
      source_path: string;
      line_start: number;
      line_end: number;
      text: string;
    }>`
      SELECT c.id, c.source_path, c.line_start, c.line_end, c.text
      FROM app.memory_chunks c
      JOIN app.memory_file_index fi
        ON fi.owner_user_id = c.owner_user_id
       AND fi.source_kind = c.source_kind
       AND fi.source_path = c.source_path
      WHERE c.owner_user_id = app.current_actor_user_id()
        AND c.source_kind = ${sourceKind}
      ORDER BY fi.ingested_at DESC, c.line_start ASC
      LIMIT ${limit}
    `.execute(scopedDb.db);

    return result.rows.map((r) => ({
      id: r.id,
      sourcePath: r.source_path,
      lineStart: r.line_start,
      lineEnd: r.line_end,
      text: r.text,
      similarity: 0
    }));
  }
```

> Verify the `memory_file_index` column is `ingested_at` and the join keys match the schema in
> `packages/memory/sql/`. The worker role already has memory grants (migration `0054_worker_memory_rls`).

Add to `packages/memory/src/retrieval.ts` (inside `MemoryRetriever`):

```ts
  async retrieveRecent(
    scopedDb: DataContextDb,
    limit: number = 10,
    sourceKind: string = "vault"
  ): Promise<RetrievedChunk[]> {
    return this.repository.listRecentChunks(scopedDb, limit, sourceKind);
  }
```

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/memory.test.ts
```

**Step 5 — Commit:**

```
git add packages/memory/src/repository.ts packages/memory/src/retrieval.ts tests/integration/memory.test.ts
git commit -m "feat(memory): recency retrieval seam for hybrid vault grounding

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A5b — Output token budget on `GenerateChatInput` (enforce the economy envelope)

The spec promises an "economy token budget," but (verified at grounding) `GenerateChatInput`
(`packages/ai/src/chat-adapter.ts`) has NO output-budget field and `HttpApiAdapter` hardcodes
`max_tokens: 8192` for Anthropic (`packages/ai/src/adapters/http-api.ts:79`). The input-side section
caps bound the PROMPT, but a runaway generation can still emit up to 8192 output tokens — the cost lever
the economy tier is supposed to control is unbounded. Add an optional `maxOutputTokens` to
`GenerateChatInput` and clamp the provider request to it when present.

**Files**

- Modify: `packages/ai/src/chat-adapter.ts` (add the field to `GenerateChatInput`)
- Modify: `packages/ai/src/adapters/http-api.ts` (use it in `buildRequest` for every provider branch)
- Test: `tests/integration/ai.test.ts` (extend — READ it first; reuse its `fetch`-spy harness)

**Step 1 — Write the failing test.** Add a test that calls `HttpApiAdapter.generateChat` with
`maxOutputTokens: 1024` through an injected fake `fetch` capturing the request body, and asserts the
serialized body's token cap is `1024` (Anthropic: `max_tokens`; OpenAI-compatible: `max_tokens` /
`max_completion_tokens` — match each branch's existing field). Also assert that when `maxOutputTokens`
is OMITTED, the existing default (`8192`) is preserved (no behavior change for current callers).

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/ai.test.ts
```

**Step 3 — Minimal implementation.**

In `packages/ai/src/chat-adapter.ts`, extend the input interface:

```ts
export interface GenerateChatInput {
  readonly model: { readonly provider_kind: string; readonly provider_model_id: string };
  readonly messages: readonly ChatTurn[];
  /** Optional output-token ceiling. When set, clamps the provider's max_tokens. Omitted = provider default. */
  readonly maxOutputTokens?: number;
  // ...preserve every other existing field exactly (READ the file; do not drop onActivity etc.).
}
```

In `packages/ai/src/adapters/http-api.ts` `buildRequest`, replace the hardcoded `max_tokens: 8192` (and
the equivalent field in any other provider branch) with
`max_tokens: input.maxOutputTokens ?? 8192` (use each branch's existing field name; only change the
value source). Do NOT change the default when the field is absent.

> READ `buildRequest` fully first — apply the clamp in EVERY provider branch that sends a token cap, not
> just Anthropic, so the budget is provider-agnostic (Hard Invariant). If a branch has no token field
> today, add `max_tokens: input.maxOutputTokens` only when defined (do not invent a default for a
> provider that didn't have one).

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/ai.test.ts
```

**Step 5 — Commit:**

```
git add packages/ai/src/chat-adapter.ts packages/ai/src/adapters/http-api.ts tests/integration/ai.test.ts
git commit -m "feat(ai): optional maxOutputTokens budget on generateChat (economy envelope)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A6 — `compose.ts`: section gathering + bounded prompt (no synthesis yet)

Build the gathering + prompt-assembly core in isolation with injected deps so it is unit-testable
without a real provider. Synthesis + persistence are wired in A7.

**Files**

- Create: `packages/briefings/src/compose.ts`
- Test: `packages/briefings/test/compose.test.ts` (Vitest; fakes for tools/retriever/adapter)

**Step 1 — Write the failing test.** Create `packages/briefings/test/compose.test.ts`. Assert:
(a) sections are gathered in fixed priority order commitments > tasks > calendar > email > vault >
chats; (b) a failing source yields a `gaps[]` entry and does not throw; (c) the assembled prompt
includes provenance for present sections. Use a fake `ComposeDeps` (fake module manifests whose
`execute` returns canned data, a fake retriever, a fake `generateChat`). Skeleton:

```ts
import { describe, expect, it, vi } from "vitest";

import { composeBriefing } from "../src/compose.js";

describe("composeBriefing — gathering", () => {
  it("gathers sections in fixed priority order and assembles a prompt", async () => {
    const capturedMessages: unknown[] = [];
    let capturedBudget: number | undefined;
    const deps = makeFakeDeps({
      generateChat: async (input) => {
        capturedMessages.push(input.messages);
        capturedBudget = input.maxOutputTokens;
        return { text: "synth narrative" };
      }
    });
    const result = await composeBriefing(fakeScopedDb, definition, runInput, deps);
    expect(result.summaryText).toBe("synth narrative");
    // economy envelope: compose passes a bounded output budget (F9).
    expect(capturedBudget).toBe(1024);
    const prompt = JSON.stringify(capturedMessages);
    // order: commitments index < tasks index < calendar < email < vault < chats
    expect(prompt.indexOf("COMMITMENTS")).toBeLessThan(prompt.indexOf("TASKS"));
    expect(prompt.indexOf("TASKS")).toBeLessThan(prompt.indexOf("CALENDAR"));
    expect(prompt.indexOf("CALENDAR")).toBeLessThan(prompt.indexOf("EMAIL"));
    expect(prompt.indexOf("EMAIL")).toBeLessThan(prompt.indexOf("VAULT"));
    expect(prompt.indexOf("VAULT")).toBeLessThan(prompt.indexOf("CHATS"));
  });

  it("records a gaps[] entry for a failing source and does not throw", async () => {
    const deps = makeFakeDeps({ failTool: "email.listVisibleMessages" });
    const result = await composeBriefing(fakeScopedDb, definition, runInput, deps);
    const gaps = (result.sourceMetadata.gaps ?? []) as Array<{ source: string; reason: string }>;
    expect(gaps.some((g) => g.source === "email")).toBe(true);
    expect(result.status).toBe("succeeded");
  });
});
```

> Build `makeFakeDeps` to supply: `moduleManifests` (with `execute` per tool name), a
> `MemoryRetriever`-shaped object with `retrieve` + `retrieveRecent`, an `aiRepository` whose
> `selectModelForCapability` + `selectProviderWithCredential` return canned rows, a `cipher` whose
> `decryptJson` returns `{ apiKey: "fake" }`, and an injected `generateChat` (so no real
> `HttpApiAdapter` constructs). See A7 for how the real adapter is constructed; in compose, accept an
> injectable `createAdapter` factory defaulting to the real `HttpApiAdapter` so tests inject a fake.

**Step 2 — Run it, SEE it FAIL** (module/function missing):

```
pnpm exec vitest run packages/briefings/test/compose.test.ts
```

**Step 3 — Minimal implementation.** Create `packages/briefings/src/compose.ts`. COMPLETE code:

```ts
import { randomUUID } from "node:crypto";

import type { AiRepository } from "@jarv1s/ai";
import type { AiSecretCipher } from "@jarv1s/ai";
import { HttpApiAdapter } from "@jarv1s/ai";
import type { ChatTurn, GenerateChatInput, ProviderKind } from "@jarv1s/ai";
import type { BriefingDefinition, BriefingRunStatus, DataContextDb } from "@jarv1s/db";
import type { MemoryRetriever } from "@jarv1s/memory";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import { timezoneFor } from "./schedule.js";

// ── Caps (one conservative economy budget) ─────────────────────────────────────
const SECTION_ITEM_CAP = 8;
const SECTION_CHAR_CAP = 1200;
const VAULT_CHUNK_CAP = 6;
const VAULT_EXCERPT_CHARS = 400;
// Output budget for the economy tier. Bounds the synthesized narrative so a runaway
// generation can't blow the economy cost envelope. Wired into the adapter via
// GenerateChatInput.maxOutputTokens (see A5b) — the adapter clamps its provider
// max_tokens to this when present.
const ECONOMY_MAX_OUTPUT_TOKENS = 1024;

export type GenerateChatFn = (input: GenerateChatInput) => Promise<{ readonly text: string }>;

export interface ComposeDeps {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly memoryRetriever: MemoryRetriever;
  /** Injectable for tests; defaults to constructing a real HttpApiAdapter. */
  readonly createAdapter?: (
    kind: ProviderKind,
    apiKey: string,
    baseUrl: string | null
  ) => { generateChat: GenerateChatFn };
}

export interface ComposeRunInput {
  readonly runKind: "manual" | "scheduled";
  readonly runId?: string;
  readonly jobId?: string;
  /** Single captured "now" from the caller so lock-day, idempotency, and the local-day
   *  content window all agree across a midnight boundary. Defaults to a fresh Date(). */
  readonly now?: Date;
}

export interface BriefingGap {
  readonly source: string;
  // No `empty_cache`: we cannot distinguish synced-empty from not-synced-yet until the
  // connector-sync slice lands cache state, so an empty source is just `empty`.
  readonly reason: "tool_failed" | "truncated" | "empty";
}

export interface ComposeResult {
  readonly status: BriefingRunStatus;
  readonly summaryText: string;
  readonly sourceMetadata: Record<string, unknown>;
}

interface Section {
  readonly key: string;
  readonly label: string;
  readonly lines: readonly string[];
  readonly count: number;
}

function ctxFor(definition: BriefingDefinition, input: ComposeRunInput) {
  return {
    actorUserId: definition.owner_user_id,
    requestId: input.jobId ? `pgboss:${input.jobId}` : `briefing:${input.runId ?? randomUUID()}`,
    chatSessionId: ""
  };
}

/**
 * Authoritative per-user local-day check for a field we are EXPLICITLY day-bounding.
 * `timeZone` is the definition's IANA tz (from `timezoneFor(...)`). An item whose
 * timestamp falls on a different local calendar day than `now` is excluded. FAILS
 * CLOSED: a missing/unparseable timestamp on a day-bound field cannot be confirmed to
 * be "today", so it is EXCLUDED (a stale row with no usable date must not leak into a
 * today-bounded section). Each exclusion is recorded by the caller as a `truncated`-
 * adjacent signal via the count delta; a malformed-date item is simply dropped.
 */
function withinLocalDay(isoOrDate: unknown, now: Date, timeZone: string): boolean {
  if (typeof isoOrDate !== "string" || isoOrDate.trim() === "") {
    return false;
  }
  const ts = new Date(isoOrDate);
  if (Number.isNaN(ts.getTime())) {
    return false;
  }
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  return fmt(ts) === fmt(now);
}

function findExecute(
  manifests: readonly JarvisModuleManifest[],
  toolName: string
) {
  return manifests.flatMap((m) => m.assistantTools ?? []).find((t) => t.name === toolName);
}

function capLines(lines: string[]): { lines: string[]; truncated: boolean } {
  const itemCapped = lines.slice(0, SECTION_ITEM_CAP);
  let total = 0;
  const out: string[] = [];
  let truncated = lines.length > SECTION_ITEM_CAP;
  for (const line of itemCapped) {
    if (total + line.length > SECTION_CHAR_CAP) {
      truncated = true;
      break;
    }
    out.push(line);
    total += line.length;
  }
  return { lines: out, truncated };
}

/** Gather one tool-backed section; never throws — failures become gaps. */
async function gatherToolSection(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: ComposeRunInput,
  deps: ComposeDeps,
  args: {
    readonly key: string;
    readonly label: string;
    readonly toolName: string;
    readonly arrayKey: string;
    readonly format: (item: Record<string, unknown>) => string;
    /** When set, items are filtered to the definition's local day on this field. */
    readonly localDayField?: string;
  },
  gaps: BriefingGap[],
  now: Date,
  timeZone: string
): Promise<Section> {
  const tool = findExecute(deps.moduleManifests, args.toolName);
  if (!tool?.execute) {
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0 };
  }
  try {
    const result = await tool.execute(scopedDb, {}, ctxFor(definition, input));
    const data = result.data ?? {};
    const raw = (data as Record<string, unknown>)[args.arrayKey];
    let items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    // Authoritative per-user local-day bound (tools return all visible rows; sync
    // slice not built yet so there is no source-side date filter — compose enforces it).
    if (args.localDayField) {
      items = items.filter((it) => withinLocalDay(it[args.localDayField!], now, timeZone));
    }
    if (items.length === 0) {
      // Neutral `empty` only: we cannot distinguish "synced and empty" from
      // "not synced yet" until the connector-sync slice lands cache state. Do NOT
      // claim `empty_cache` — that would over-state knowledge we don't have.
      gaps.push({ source: args.key, reason: "empty" });
      return { key: args.key, label: args.label, lines: [], count: 0 };
    }
    const allLines = items.map(args.format).filter((l) => l.length > 0);
    const { lines, truncated } = capLines(allLines);
    if (truncated) {
      gaps.push({ source: args.key, reason: "truncated" });
    }
    return { key: args.key, label: args.label, lines, count: items.length };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "briefing_tool_failed",
        tool: args.toolName,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
    gaps.push({ source: args.key, reason: "tool_failed" });
    return { key: args.key, label: args.label, lines: [], count: 0 };
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function composeBriefing(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: ComposeRunInput,
  deps: ComposeDeps
): Promise<ComposeResult> {
  const gaps: BriefingGap[] = [];
  // Use the caller's captured `now` (so the idempotency lock-day and the content window
  // agree); fall back to a fresh Date() for a direct/manual call that omits it.
  const now = input.now ?? new Date();
  // Per-user IANA tz — the SAME helper the scheduler uses, so cron fire time and the
  // local-day content window agree. No cross-user read: tz comes off this definition.
  const timeZone = timezoneFor(definition.schedule_metadata);

  const commitments = await gatherToolSection(scopedDb, definition, input, deps, {
    key: "commitments",
    label: "COMMITMENTS",
    toolName: "commitments.listVisible",
    arrayKey: "commitments",
    format: (c) => [str(c.title), str(c.status), str(c.dueAt), str(c.counterparty)].filter(Boolean).join(" · ")
  }, gaps, now, timeZone);

  const tasks = await gatherToolSection(scopedDb, definition, input, deps, {
    key: "tasks",
    label: "TASKS",
    toolName: "tasks.listVisible",
    arrayKey: "items",
    format: (t) => [str(t.title), str(t.status)].filter(Boolean).join(" · ")
  }, gaps, now, timeZone);

  const calendar = await gatherToolSection(scopedDb, definition, input, deps, {
    key: "calendar",
    label: "CALENDAR",
    toolName: "calendar.listVisibleEvents",
    arrayKey: "events",
    // "Today's calendar": bound to the definition's local day on the event start.
    localDayField: "startsAt",
    format: (e) => [str(e.startsAt), str(e.title)].filter(Boolean).join(" · ")
  }, gaps, now, timeZone);

  const email = await gatherToolSection(scopedDb, definition, input, deps, {
    key: "email",
    label: "EMAIL SUMMARIES + SIGNALS",
    toolName: "email.listVisibleMessages",
    arrayKey: "messages",
    // Email "signals" = recent unread/important; keep the source's own recency
    // (no day-bound — a 2-day-old unresolved thread is still a morning signal).
    format: (m) => [str(m.sender), str(m.subject), str(m.snippet)].filter(Boolean).join(" · ")
  }, gaps, now, timeZone);

  // Vault: semantic ∪ recency, deduped by id/source path. Best-effort.
  const vaultLines: string[] = [];
  const vaultNotes: Array<{ path: string; id: string; excerpt: string }> = [];
  try {
    const query = [...commitments.lines, ...tasks.lines, ...calendar.lines].join(" ").slice(0, 500);
    const semantic = query.trim() ? await deps.memoryRetriever.retrieve(scopedDb, query, VAULT_CHUNK_CAP, "vault") : [];
    const recent = await deps.memoryRetriever.retrieveRecent(scopedDb, VAULT_CHUNK_CAP, "vault");
    const seen = new Set<string>();
    for (const chunk of [...semantic, ...recent]) {
      const dedupeKey = chunk.id || `${chunk.sourcePath}:${chunk.lineStart}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const excerpt = chunk.text.slice(0, VAULT_EXCERPT_CHARS).replace(/\s+/g, " ").trim();
      vaultLines.push(`${chunk.sourcePath} · ${excerpt}`);
      vaultNotes.push({ path: chunk.sourcePath, id: chunk.id, excerpt });
      if (vaultLines.length >= VAULT_CHUNK_CAP) break;
    }
    if (vaultLines.length === 0) {
      gaps.push({ source: "vault", reason: "empty" });
    }
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(JSON.stringify({ event: "briefing_tool_failed", tool: "vault", error: e.name, message: e.message.slice(0, 200) }));
    gaps.push({ source: "vault", reason: "tool_failed" });
  }
  const vault: Section = { key: "vault", label: "VAULT", lines: vaultLines, count: vaultLines.length };

  const chats = await gatherToolSection(scopedDb, definition, input, deps, {
    key: "chats",
    label: "THE DAY'S CHATS",
    toolName: "chat.listTodaysTurns",
    arrayKey: "turns",
    // Authoritative local-day bound on the turn timestamp (the tool over-includes 36h).
    localDayField: "createdAt",
    format: (t) => [str(t.role), str(t.excerpt)].filter(Boolean).join(": ")
  }, gaps, now, timeZone);

  const sections: Section[] = [commitments, tasks, calendar, email, vault, chats];

  // ── Resolve the model (provider-agnostic) ────────────────────────────────────
  const model = await deps.aiRepository.selectModelForCapability(scopedDb, "summarization", "economy");
  if (!model) {
    return fallback(sections, gaps, "no_model", commitments, tasks, calendar, email, vault, chats, vaultNotes);
  }

  // ── Decrypt credential in worker scope only ──────────────────────────────────
  let apiKey: string;
  let baseUrl: string | null = null;
  try {
    const provider = await deps.aiRepository.selectProviderWithCredential(scopedDb, model.provider_config_id);
    if (!provider?.encrypted_credential) {
      return fallback(sections, gaps, "credential_error", commitments, tasks, calendar, email, vault, chats, vaultNotes);
    }
    const decrypted = deps.cipher.decryptJson(provider.encrypted_credential);
    const key = decrypted.apiKey;
    if (typeof key !== "string" || key.length === 0) {
      return fallback(sections, gaps, "credential_error", commitments, tasks, calendar, email, vault, chats, vaultNotes);
    }
    apiKey = key;
    baseUrl = provider.base_url;
  } catch {
    // Never log the raw error — it can carry the decrypted key.
    return fallback(sections, gaps, "credential_error", commitments, tasks, calendar, email, vault, chats, vaultNotes);
  }

  // ── Synthesize ───────────────────────────────────────────────────────────────
  const messages = buildMessages(sections);
  try {
    const adapter = (deps.createAdapter ?? defaultCreateAdapter)(
      model.provider_kind as ProviderKind,
      apiKey,
      baseUrl
    );
    const { text } = await adapter.generateChat({
      model: { provider_kind: model.provider_kind, provider_model_id: model.provider_model_id },
      messages,
      maxOutputTokens: ECONOMY_MAX_OUTPUT_TOKENS
    });
    return {
      status: "succeeded",
      summaryText: text,
      sourceMetadata: {
        commitmentCount: commitments.count,
        taskCount: tasks.count,
        calendarCount: calendar.count,
        emailCount: email.count,
        vaultCount: vault.count,
        chatTurnCount: chats.count,
        notes: vaultNotes,
        aiModel: { id: model.id, displayName: model.display_name, tier: model.tier },
        gaps,
        degraded: false
      }
    };
  } catch {
    return fallback(sections, gaps, "synthesis_failed", commitments, tasks, calendar, email, vault, chats, vaultNotes);
  }
}

function defaultCreateAdapter(kind: ProviderKind, apiKey: string, baseUrl: string | null) {
  return new HttpApiAdapter(kind, apiKey, baseUrl ? { baseUrl } : {});
}

function buildMessages(sections: readonly Section[]): ChatTurn[] {
  const system =
    "You are a calm morning-briefing writer. Synthesize a concise, scannable morning briefing " +
    "with light section headers. Ground strictly in the provided items; do not invent. Where a " +
    "section is empty, note it briefly. Keep it warm and non-judgmental about missed or at-risk items.";
  const body = sections
    .map((s) => `## ${s.label}\n${s.lines.length > 0 ? s.lines.map((l) => `- ${l}`).join("\n") : "(none today)"}`)
    .join("\n\n");
  return [
    { role: "user", content: `${system}\n\n${body}` }
  ];
}

function fallback(
  sections: readonly Section[],
  gaps: BriefingGap[],
  reason: "no_model" | "credential_error" | "synthesis_failed",
  commitments: Section,
  tasks: Section,
  calendar: Section,
  email: Section,
  vault: Section,
  chats: Section,
  vaultNotes: Array<{ path: string; id: string; excerpt: string }>
): ComposeResult {
  const text = sections
    .map((s) => `${s.label}: ${s.count} item${s.count === 1 ? "" : "s"}${s.lines.length > 0 ? `\n${s.lines.map((l) => `- ${l}`).join("\n")}` : ""}`)
    .join("\n\n");
  return {
    status: "succeeded",
    summaryText: text || "Briefing did not produce visible source items.",
    sourceMetadata: {
      commitmentCount: commitments.count,
      taskCount: tasks.count,
      calendarCount: calendar.count,
      emailCount: email.count,
      vaultCount: vault.count,
      chatTurnCount: chats.count,
      notes: vaultNotes,
      aiModel: null,
      gaps,
      degraded: true,
      degradedReason: reason
    }
  };
}
```

> **Day-bounding scope decision (F6/F7):** the local-day filter runs in compose AFTER each tool returns
> its visible rows, rather than pushing date bounds + `LIMIT` into the three shared tool/repository
> contracts (calendar/email/chat). This is a deliberate, bounded choice for a single-user personal-scale
> cache: calendar/email "today" sets are small, the chat scan is capped (`MAX_THREADS_SCANNED` + a 36h
> query window), and widening three module read-tool contracts now would be premature coupling before the
> connector-sync slice defines real cache/sync semantics. When sync lands (and datasets grow), add
> `since`/`until`/`limit` inputs to the read tools and have compose pass the local-day UTC bounds — note
> this as the documented follow-up in the PR. The correctness (right items in "today") is already
> guaranteed by `withinLocalDay`; only the fetch breadth is deferred.

> Re-export `ChatTurn`, `GenerateChatInput`, `ProviderKind` from `@jarv1s/ai` are confirmed present in
> `chat-adapter.ts`. Verify `AiSecretCipher` is exported from `@jarv1s/ai` (it is, via `crypto.ts`); if
> the package barrel does not re-export it, add it to `packages/ai/src/index.ts`. Confirm the decrypted
> credential field name is `apiKey` against how `ai/routes.ts` stores `credentialPayload` (it stores
> the caller's object verbatim; the convention is `{ apiKey }` — verify against
> `packages/shared/src/ai-api.ts` and any onboarding seed; if the field is named differently, match it
> and note it in the PR).

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run packages/briefings/test/compose.test.ts
```

**Step 5 — Commit:**

```
git add packages/briefings/src/compose.ts packages/briefings/test/compose.test.ts
git commit -m "feat(briefings): grounded compose pipeline (sections, prompt, synthesis, degraded fallback)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A7 — Wire `compose.ts` into `generateRun` + local-day idempotency

Replace the deterministic `generateSummary` body with a call to `composeBriefing`, add the synthesis
deps to `generateRun`, and add the scheduled-only local-day idempotency check.

**Files**

- Modify: `packages/briefings/src/repository.ts`
- Test: `tests/integration/briefings.test.ts` (update existing concat tests; add synthesis + idempotency)

**Step 1 — Write/Update the failing tests.** READ `tests/integration/briefings.test.ts` first. Then:

- Update the "generates deterministic summaries" test (≈282-306): pass `composeDeps` with a fake
  `generateChat` returning `"synth narrative"`; assert `summary_text === "synth narrative"` and
  `source_metadata.degraded === false`, `source_metadata.taskCount`/`emailCount` present.
- Update the "records economy-tier AI model" test (≈488-526): the model now lives at
  `source_metadata.aiModel.tier === "economy"` from a real synthesis path.
- Add a degraded test: no configured model → `summary_text` is the deterministic fallback,
  `source_metadata.degraded === true`, `degradedReason === "no_model"`, status `succeeded`.
- Add a secrets test: configure a provider whose decrypted credential is `"sk-SECRET-123"`; assert
  `"sk-SECRET-123"` appears in NONE of `summary_text`, `JSON.stringify(source_metadata)`.
- Add a local-day idempotency test: two scheduled `generateRun` calls for the same definition on the
  same day → the second returns the existing run id with `created === false`; only one `briefing_runs`
  row exists. The FIRST call returns `created === true`.

`generateRun` now REQUIRES a `composeDeps` argument: `GenerateBriefingRunInput.composeDeps: ComposeDeps`
(required — see the interface below; there is no optional/fallback variant). The ONLY production caller is
the worker (A8), which always builds `composeDeps`. Manual runs go through that same worker path
(`POST /:id/run` enqueues a job — there is no direct in-process `generateRun` call from the route). Any
existing TEST that called `generateRun` without deps must be updated to pass a fake `composeDeps` (the
A7/A8 tests already do). Do NOT add an optional-with-deterministic-fallback path — `compose.ts` already
contains the deterministic fallback (the degraded branch), so a second fallback in `generateRun` would be
dead, redundant logic (no-stale-concepts).

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 3 — Minimal implementation.** In `packages/briefings/src/repository.ts`:

- Import compose: `import { composeBriefing, type ComposeDeps } from "./compose.js";`
- Extend `GenerateBriefingRunInput`:

```ts
export interface GenerateBriefingRunInput {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly runKind: BriefingRunKind;
  readonly runId?: string;
  readonly jobId?: string;
  readonly composeDeps: ComposeDeps;
}
```

- Replace `generateRun` body. It now returns `{ run, created }` so the worker can fire the
  ready-notification ONLY for a NEWLY-created scheduled run (an idempotent skip returns the existing run
  with `created:false` and must NOT re-notify — F1). Add the local-day idempotency check for scheduled
  runs, then call `composeBriefing`, keeping the blocked-tool guard:

```ts
  /** `created:false` means an existing same-day scheduled run was returned (idempotent skip). */
  async generateRun(
    scopedDb: DataContextDb,
    definitionId: string,
    input: GenerateBriefingRunInput
  ): Promise<{ run: BriefingRun; created: boolean } | undefined> {
    assertDataContextDb(scopedDb);

    const definition = await this.getOwnedDefinitionById(scopedDb, definitionId);
    if (!definition) {
      return undefined;
    }

    // Blocked-tool guard preserved: a non-read selected tool blocks the run.
    const blocked = definition.selected_tool_names.some((name) => {
      const tool = findAssistantToolFromManifests(input.moduleManifests, name);
      return !tool || tool.risk !== "read";
    });
    if (blocked) {
      const run = await this.persistRun(scopedDb, definition, input, {
        status: "blocked",
        summaryText: "Briefing blocked because selected tools are not all declared read tools.",
        sourceMetadata: { degraded: false, gaps: [], blockedReason: "non_read_tool" }
      });
      return { run, created: true };
    }

    // Capture ONE `now` so the lock-day, the existing-run comparison, and compose's
    // local-day window all agree even across a local-midnight boundary.
    const now = new Date();

    // Scheduled local-day idempotency under a transaction-scoped advisory lock so two
    // concurrent cron fires (multi-replica worker, or a retry overlapping the first)
    // cannot both pass check-then-insert (F2). `scopedDb.db` is ALREADY the Kysely
    // Transaction opened by withDataContext (DataContextDb.db: Transaction<...>), so we
    // take the lock ON that existing transaction — do NOT open a nested transaction. The
    // lock auto-releases when withDataContext's transaction commits/rolls back.
    if (input.runKind === "scheduled") {
      // hashtextextended(text, 0) → stable bigint key per (definition, local day).
      const lockKey = `${definition.id}:${localDayString(definition, now)}`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(scopedDb.db);
      const existing = await this.findScheduledRunForLocalDay(scopedDb, definition, now);
      if (existing) {
        return { run: existing, created: false };
      }
    }

    const composed = await composeBriefing(scopedDb, definition, {
      runKind: input.runKind,
      runId: input.runId,
      jobId: input.jobId,
      now
    }, input.composeDeps);
    const run = await this.persistRun(scopedDb, definition, input, composed);
    return { run, created: true };
  }
```

> The advisory lock is taken on the EXISTING `withDataContext` transaction (`scopedDb.db` is a Kysely
> `Transaction`), not a nested one — `DataContextDb.db` is already `Transaction<JarvisDatabase>`
> (verified). The lock is held until that transaction ends, which spans synthesis (an HTTP call). That
> is acceptable: the lock is per (definition, day), not global, and the exclusive queue policy +
> retryLimit:0 mean at most a small number of contending fires. If synthesis latency under lock proves a
> problem, a follow-up can move to a unique partial index on
> `(definition_id, ((created_at AT TIME ZONE tz)::date)) WHERE run_kind = 'scheduled'` and catch the
> unique violation — note this option in the PR. Thread the single captured `now` into both
> `localDayString` and `findScheduledRunForLocalDay`, and into `composeBriefing` (add `now` to
> `ComposeRunInput`; compose uses it instead of its own `new Date()`).

- Add `persistRun` (the existing insert + `last_run_at` bump, taking the compose result) and
  `findScheduledRunForLocalDay` (selects the most recent scheduled run and compares its `created_at`
  local day in the definition's tz to today's local day — use `timezoneFor(definition.schedule_metadata)`
  and `Intl.DateTimeFormat(..., { timeZone, year/month/day })` to derive the local date string for both
  `now` and the candidate `created_at`; equal → same day). COMPLETE code:

```ts
  private async persistRun(
    scopedDb: DataContextDb,
    definition: BriefingDefinition,
    input: GenerateBriefingRunInput,
    composed: { status: BriefingRunStatus; summaryText: string; sourceMetadata: Record<string, unknown> }
  ): Promise<BriefingRun> {
    const createdAt = new Date();
    const run = await scopedDb.db
      .insertInto("app.briefing_runs")
      .values({
        id: input.runId ?? randomUUID(),
        definition_id: definition.id,
        owner_user_id: definition.owner_user_id,
        status: composed.status,
        run_kind: input.runKind,
        summary_text: composed.summaryText,
        source_metadata: composed.sourceMetadata,
        created_at: createdAt
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await scopedDb.db
      .updateTable("app.briefing_definitions")
      .set({ last_run_at: createdAt, updated_at: createdAt })
      .where("id", "=", definition.id)
      .execute();

    return run;
  }

  private async findScheduledRunForLocalDay(
    scopedDb: DataContextDb,
    definition: BriefingDefinition,
    now: Date
  ): Promise<BriefingRun | undefined> {
    const timeZone = timezoneFor(definition.schedule_metadata);
    const localDate = (d: Date): string =>
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const today = localDayString(definition, now);

    const recent = await scopedDb.db
      .selectFrom("app.briefing_runs")
      .selectAll()
      .where("definition_id", "=", definition.id)
      .where("run_kind", "=", "scheduled")
      .orderBy("created_at", "desc")
      .limit(5)
      .execute();

    return recent.find((run) => {
      const created = run.created_at instanceof Date ? run.created_at : new Date(run.created_at);
      return localDate(created) === today;
    });
  }
```

Add the shared module-scope helper (used by both the advisory-lock key and
`findScheduledRunForLocalDay`) and import `sql` from `kysely`:

```ts
import { sql } from "kysely";

/** Local calendar-day string ("YYYY-MM-DD") for `now` in the definition's IANA tz. */
function localDayString(definition: BriefingDefinition, now: Date): string {
  const timeZone = timezoneFor(definition.schedule_metadata);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
```

> Confirm `sql` is not already imported in `repository.ts`; if it is, reuse the existing import. The
> advisory lock uses `hashtextextended(text, 0)` (returns `bigint`, matching `pg_advisory_xact_lock`'s
> `bigint` arg). Verify `pg_advisory_xact_lock` is callable by `jarvis_app_runtime` AND
> `jarvis_worker_runtime` (advisory-lock functions are granted to PUBLIC by default — no grant needed,
> but confirm no `REVOKE ... FROM PUBLIC` exists in the bootstrap SQL).

- Add `import { timezoneFor } from "./schedule.js";` and keep `findAssistantToolFromManifests` import.
- DELETE the now-dead deterministic helpers (`generateSummary`, `selectReadTool`, `blockedSummary`,
  `selectRunStatus`, `summarizeToolResult`, `summarizeNamedItems`, `summarizeUnknownResult`,
  `formatToolSummary`, `displayToolName`, `compactExcerpt`, and the `ToolSummary`/`SummaryResult`
  interfaces) — they are superseded by `compose.ts`. (No-stale-concepts rule.) Confirm with
  `pnpm check:file-size` that `repository.ts` is now well under 1000 lines.

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
pnpm check:file-size
```

**Step 5 — Commit:**

```
git add packages/briefings/src/repository.ts tests/integration/briefings.test.ts
git commit -m "feat(briefings): synthesize runs via compose pipeline + scheduled local-day idempotency

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A8 — Worker handler: mint runId, inject deps, fire notification

**Files**

- Modify: `packages/briefings/src/jobs.ts`
- Test: `tests/integration/briefings.test.ts` (extend; reuse the worker-job test at ≈336/446)

**Step 1 — Write the failing test.** Add a worker-level test:
- A scheduled job with no `briefingRunId` → handler mints one, the run persists, and exactly one
  "Your morning briefing is ready" notification owned by the actor with `metadata = { definitionId,
  briefingRunId }` (no content) is created.
- A manual job → no notification created.

> Read the existing worker-job test (≈336) for how it constructs `registerBriefingsJobWorkers` /
> drives a job. Pass the new deps (fake `AiRepository`, fake cipher returning `{ apiKey }`, fake
> `generateChat`, a `MemoryRetriever`, a `NotificationsRepository`).

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 3 — Minimal implementation.** In `packages/briefings/src/jobs.ts`:

- Extend `RegisterBriefingsJobWorkersOptions` with the synthesis + notification deps:

```ts
import { randomUUID } from "node:crypto";

import type { AiRepository, AiSecretCipher } from "@jarv1s/ai";
import type { MemoryRetriever } from "@jarv1s/memory";
import type { NotificationsRepository } from "@jarv1s/notifications";

import type { ComposeDeps } from "./compose.js";
```

> Import only `ComposeDeps` (the worker builds a `ComposeDeps` object). Do NOT import `GenerateChatFn`
> here — it is unused in `jobs.ts` and would trip `eslint --max-warnings=0` / `noUnusedLocals`.

```ts
export interface RegisterBriefingsJobWorkersOptions {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly memoryRetriever: MemoryRetriever;
  readonly notificationsRepository: NotificationsRepository;
  /** Injectable for tests; defaults to real HttpApiAdapter via compose. */
  readonly createAdapter?: ComposeDeps["createAdapter"];
  readonly repository?: BriefingsRepository;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<BriefingRunPayload>, result: BriefingRunResult) => void;
}
```

- Update `BriefingRunPayload` to make `briefingRunId` optional (scheduled cron carries none):

```ts
export interface BriefingRunPayload extends ActorScopedJobPayload {
  readonly definitionId: string;
  readonly briefingRunId?: string;
  readonly runKind: BriefingRunKind;
  readonly idempotencyKey?: string;
}
```

- In the worker callback: mint `briefingRunId` when absent, build `composeDeps`, call `generateRun`,
  and fire the notification for scheduled runs whose status is `succeeded` (degraded runs are
  `succeeded` + `degraded` flag, so this covers both):

```ts
    async (job, scopedDb) => {
      if (!isBriefingRunPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)) {
        throw new Error(`Briefing job ${job.id} contains non-metadata payload fields`);
      }

      // Normalize the optional scheduled payload to a guaranteed run id before
      // constructing the typed repository input (F13): scheduled cron data carries no
      // briefingRunId, so mint one here at the handler boundary. Manual runs always
      // carry one from the route.
      const briefingRunId = job.data.briefingRunId ?? randomUUID();
      const composeDeps: ComposeDeps = {
        moduleManifests: options.moduleManifests,
        aiRepository: options.aiRepository,
        cipher: options.cipher,
        memoryRetriever: options.memoryRetriever,
        createAdapter: options.createAdapter
      };

      const outcome = await repository.generateRun(scopedDb, job.data.definitionId, {
        moduleManifests: options.moduleManifests,
        runKind: job.data.runKind,
        runId: briefingRunId,
        jobId: job.id,
        composeDeps
      });

      // Notify ONLY for a NEWLY-created scheduled run that succeeded (F1): an
      // idempotent same-day skip returns created:false and must not re-notify.
      if (
        outcome?.created &&
        job.data.runKind === "scheduled" &&
        outcome.run.status === "succeeded"
      ) {
        try {
          await options.notificationsRepository.create(scopedDb, {
            title: "Your morning briefing is ready",
            metadata: { definitionId: outcome.run.definition_id, briefingRunId: outcome.run.id }
          });
        } catch (error) {
          const e = error instanceof Error ? error : new Error(String(error));
          console.error(
            JSON.stringify({
              event: "briefing_notification_failed",
              definitionId: outcome.run.definition_id,
              error: e.name,
              message: e.message.slice(0, 200)
            })
          );
        }
      }

      const result = {
        definitionId: job.data.definitionId,
        runId: outcome?.run.id ?? briefingRunId,
        status: outcome?.run.status ?? null,
        created: outcome?.created ?? false
      };
      options.onResult?.(job, result);
      return result;
    },
```

> The existing manual-run worker callback (and any test on `BriefingRunResult.created`) must be updated
> for the new `{ run, created }` shape — `created` now means "a NEW run row was written," not "a run was
> returned." A same-day idempotent scheduled skip is `created:false`. READ the current callback and the
> manual test (≈336/446) and adjust both.

**Notification-test additions for F1:** add a test that runs the SAME scheduled job twice on the same
local day → exactly ONE "Your morning briefing is ready" notification exists (the second fire is an
idempotent skip, `created:false`, no second notification). This is the regression test for the
duplicate-notification flaw.

> `isBriefingRunPayloadMetadataOnly` already accepts `briefingRunId` absence (it whitelists keys, never
> requires them). `ALLOWED_PAYLOAD_KEYS` already includes every key used. No payload-invariant change.

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 5 — Commit:**

```
git add packages/briefings/src/jobs.ts tests/integration/briefings.test.ts
git commit -m "feat(briefings): scheduled worker mints runId, synthesizes, notifies on completion

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A9 — Route layer: reconcile schedule on create/update (failure-isolated)

**Files**

- Modify: `packages/briefings/src/routes.ts`
- Test: `tests/integration/briefings.test.ts` (extend)

**Step 1 — Write the failing test.** Add a route-level test: creating a `daily` enabled definition via
`POST /api/briefings/definitions` results in a `boss.schedule` call keyed by the new definition id;
PATCH to `enabled:false` results in `boss.unschedule`. Inject a fake boss capturing calls (the route
deps already carry `boss`). Also assert a reconcile failure does NOT fail the HTTP request (make the
fake boss throw, expect 201/200 still).

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 3 — Minimal implementation.** In `packages/briefings/src/routes.ts`:

- `import { reconcileSchedule } from "./schedule.js";`
- After a successful `createDefinition` and `updateDefinition`, reconcile OUTSIDE the data-context
  callback (pg-boss is not RLS-scoped), using the returned definition. Wrap in try/catch — a reconcile
  failure is logged (name+message only) and never fails the mutation:

```ts
        const definition = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.createDefinition(scopedDb, input)
        );

        await reconcileScheduleSafely(dependencies.boss, definition);

        return reply.code(201).send({ definition: serializeDefinition(definition) });
```

(and the analogous insertion after `updateDefinition`, guarded on `definition` being defined.) Add the
helper at module scope:

```ts
async function reconcileScheduleSafely(boss: PgBoss, definition: BriefingDefinition): Promise<void> {
  try {
    await reconcileSchedule(boss, definition);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "briefing_schedule_reconcile_failed",
        definitionId: definition.id,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
  }
}
```

> There is no delete route today; the spec confirms `enabled:false` via PATCH is the unschedule path and
> is sufficient for this slice. Note this in the PR body.

**Step 3b — Wire the per-session self-heal (`reconcileOwnedSchedules`) so it is not dead code (F4).**
`reconcileOwnedSchedules` (A2) reconciles every definition the actor owns; without a call site it is dead
code. Wire it into the GET list-definitions handler (`GET /api/briefings/definitions`) as a best-effort,
non-blocking self-heal: after returning the list (or fire-and-forget before the response), reconcile the
actor's own definitions so a worker that restarted with an empty pg-boss schedule table re-converges on
next visit. It MUST NOT block or fail the list response, and reconciles ONLY the actor's own definitions
(RLS-scoped via the repository) — no cross-user read.

```ts
        const definitions = await dependencies.dataContext.withDataContext(
          accessContext,
          (scopedDb) => repository.listDefinitions(scopedDb)
        );

        // Best-effort self-heal: re-converge this owner's pg-boss schedules. Fire after
        // building the response payload; never block or fail the read. reconcileOwnedSchedules
        // already swallows + logs per-definition errors, but guard the whole call too.
        void dependencies.dataContext
          .withDataContext(accessContext, (scopedDb) =>
            reconcileOwnedSchedules(
              dependencies.boss,
              scopedDb,
              repository,
              accessContext.actorUserId
            )
          )
          .catch((error) => {
            const e = error instanceof Error ? error : new Error(String(error));
            console.error(
              JSON.stringify({
                event: "briefing_self_heal_failed",
                error: e.name,
                message: e.message.slice(0, 200)
              })
            );
          });

        return reply.send({ definitions: definitions.map(serializeDefinition) });
```

> Add `reconcileOwnedSchedules` to the `./schedule.js` import. READ the current GET handler first and
> preserve its exact response shape and access-context derivation. If running the reconcile inside its own
> `withDataContext` is awkward, pass the already-open `scopedDb` instead — the key constraints are
> best-effort + owner-scoped + non-blocking. Add a route test: GET list, with a fake boss, results in
> `boss.schedule`/`boss.unschedule` calls for the owner's definitions and still returns 200 even if the
> fake boss throws.

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 5 — Commit:**

```
git add packages/briefings/src/routes.ts tests/integration/briefings.test.ts
git commit -m "feat(briefings): reconcile pg-boss schedule on definition create/update (failure-isolated)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A10 — Module-registry: inject synthesis deps into briefings worker

**Files**

- Modify: `packages/module-registry/src/index.ts`
- Test: existing integration suites cover wiring; add a focused assertion in `briefings.test.ts` only if
  the suite tests `registerBuiltInModuleWorkers` directly (otherwise the gate covers it).

**Step 1 — Write the failing test.** If `briefings.test.ts` (≈171) asserts the briefings module loads
with a metadata-only queue, extend it to assert the registration is present and typechecks with the new
deps. Otherwise rely on `pnpm typecheck` + the worker test from A8. (No new red test is required if the
A8 test drives `registerBriefingsJobWorkers` directly; the registry change is then verified by
typecheck + the gate.)

**Step 2 — Run it, SEE it FAIL** (typecheck fails — `registerBriefingsJobWorkers` now requires deps):

```
pnpm typecheck
```

**Step 3 — Minimal implementation.** In `packages/module-registry/src/index.ts`, construct the deps
inside the briefings `registerWorkers` callback. The `BuiltInWorkerDependencies` already carries
`embeddingProvider` (for the `MemoryRetriever`). Import what's needed:

```ts
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import { MemoryRepository, MemoryRetriever } from "@jarv1s/memory";
import { NotificationsRepository } from "@jarv1s/notifications";
```

Update the briefings registration:

```ts
    registerWorkers: (boss, dependencies) =>
      registerBriefingsJobWorkers(boss, dependencies.dataContext, {
        moduleManifests: getBuiltInModuleManifests(),
        aiRepository: new AiRepository(),
        cipher: createAiSecretCipher(),
        memoryRetriever: new MemoryRetriever(
          dependencies.embeddingProvider,
          new MemoryRepository()
        ),
        notificationsRepository: new NotificationsRepository()
      })
```

> Verify `NotificationsRepository` and `MemoryRepository`/`MemoryRetriever` are exported from their
> package barrels; add to the barrel if missing.

**Step 4 — Run it, SEE it PASS:**

```
pnpm typecheck
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 5 — Commit:**

```
git add packages/module-registry/src/index.ts
git commit -m "feat(module-registry): wire AI/memory/notifications deps into briefings worker

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A11 — Enable the cron engine in the worker process only

**Files**

- Modify: `apps/worker/src/worker.ts`
- Test: `apps/worker/test/worker.test.ts` (if present; else assert the option at call site via a unit)

**Step 1 — Write the failing test.** READ the worker test setup. Add tests asserting:

1. `createPgBossClient` is invoked with `{ schedule: true }` at the worker call site (spy on the module,
   or extract the boss-construction to a tiny exported function and unit-test its options — preferred).
2. **(F14 — one-cron-owner invariant)** the API process boss (`apps/api/src/server.ts`) is still
   constructed WITHOUT `schedule:true` (defaults to `schedule:false`), so exactly one process owns cron.
   Assert via the same spy/wrapper approach against the API boss construction. Add a single startup log
   line in the worker — `{"event":"pgboss.schedule_mode","schedule":true}` — and assert it is emitted, so
   "who owns cron" is observable in logs.

If the worker has no unit harness for this, extract the boss-construction to a tiny exported helper and
unit-test its options (do NOT skip the red test — the one-cron-owner invariant is load-bearing for the
schedule:false→true flip).

**Step 1b — (F12) Real pg-boss schedule integration test.** In `tests/integration/briefings.test.ts`
(which already runs against the `pnpm db:up` Postgres), add a test that, against a REAL pg-boss client
built with `{ schedule: true }` on the `BRIEFINGS_RUN_QUEUE` (whose policy is `exclusive`):
calls `reconcileSchedule` for two DIFFERENT enabled daily definitions and asserts BOTH schedule rows
exist (`SELECT name, key FROM pgboss.schedule WHERE name = $queue` returns both keys) — proving the
`exclusive` queue policy does NOT collapse distinct per-definition schedules (they are keyed by
`definition.id`, and `pgboss.schedule` is `PRIMARY KEY (name, key)`). Then `reconcileSchedule` with the
definition disabled and assert its row is removed. This proves scheduling co-exists with the exclusive
dedupe policy. (Do not wait for an actual cron tick — assert the schedule ROWS, which is deterministic.)

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run apps/worker/test/worker.test.ts
```

**Step 3 — Minimal implementation.** In `apps/worker/src/worker.ts`:

```ts
  const boss = createPgBossClient(connectionString, { schedule: true });
  // F14: make the cron owner observable. Exactly one process (this worker) runs the
  // pg-boss cron engine; the API process stays schedule:false.
  console.log(JSON.stringify({ event: "pgboss.schedule_mode", schedule: true }));
```

Leave `supervise`/`migrate`/`createSchema` at their defaults (`false`). Do NOT change the API process
boss (`apps/api/src/server.ts`) — the cron engine runs in exactly one process. (If `worker.ts` already
emits a structured startup log, fold the `schedule` field into it rather than adding a second line.)

> Confirm no existing test asserts the worker boss is built with `schedule:false`; if one does, update
> it in this task (it now expects `true`).

**Step 4 — Run it, SEE it PASS** (worker unit AND the real pg-boss schedule-rows integration test from
Step 1b live in `briefings.test.ts`):

```
pnpm exec vitest run apps/worker/test/worker.test.ts
pnpm exec vitest run tests/integration/briefings.test.ts
```

**Step 5 — Commit:**

```
git add apps/worker/src/worker.ts apps/worker/test/worker.test.ts tests/integration/briefings.test.ts
git commit -m "feat(worker): enable pg-boss cron engine in the worker process only

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A12 — Implement `handleExtractFactsJob` (chat module)

**Files**

- Modify: `packages/chat/src/jobs.ts`
- Test: `tests/integration/chat.test.ts` (extend)

**Step 1 — Write the failing test.** Add:
- After a recorded non-incognito turn, running `handleExtractFactsJob` with a fake `generateChat` that
  returns JSON facts upserts rows into `app.chat_memory_facts` via `ChatMemoryFactsRepository`:
  categories constrained to `{preference, fact, profile, goal}`, `importance` in 0..1,
  `sourceThreadId` set.
- A fake `generateChat` that throws (or returns non-JSON) → no rows written, no throw (no-op degrade).
- **Idempotency (F10):** running the handler TWICE with a `generateChat` that returns the SAME fact
  content both times writes the fact only ONCE (the second run dedupes against the existing active fact
  by normalized content within the same category) — assert exactly one active row for that content.
- **Grounded supersession (F11):** seed one active fact (capture its real id); a `generateChat` that
  returns `supersedes: "<that real id>"` marks it `superseded`. A `generateChat` returning
  `supersedes: "<a random uuid NOT in the actor's active set>"` does NOT supersede anything (the id is
  validated against the bounded active-fact set first) — assert the unrelated fact stays `active`.

**Step 2 — Run it, SEE it FAIL:**

```
pnpm exec vitest run tests/integration/chat.test.ts
```

**Step 3 — Minimal implementation.** In `packages/chat/src/jobs.ts`:

- Extend `RegisterChatJobWorkersOptions` with the AI deps (mirroring briefings), and thread them into
  the extract worker. Replace the stub:

```ts
import { AiRepository, createAiSecretCipher, HttpApiAdapter } from "@jarv1s/ai";
import type { AiSecretCipher, GenerateChatInput, ProviderKind } from "@jarv1s/ai";
import { ChatMemoryFactsRepository, type FactCategory } from "@jarv1s/memory";

const FACT_CATEGORIES: ReadonlySet<FactCategory> = new Set(["preference", "fact", "profile", "goal"]);
const MAX_FACTS_PER_TURN = 8;

export interface ExtractFactsDeps {
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly factsRepository: ChatMemoryFactsRepository;
  // Use the real GenerateChatInput so `maxOutputTokens: 512` typechecks (no excess-property error).
  readonly createAdapter?: (
    kind: ProviderKind,
    apiKey: string,
    baseUrl: string | null
  ) => { generateChat: (input: GenerateChatInput) => Promise<{ readonly text: string }> };
}

export async function handleExtractFactsJob(
  scopedDb: DataContextDb,
  ownerUserId: string,
  threadId: string,
  deps: ExtractFactsDeps,
  chatRepository: ChatRepository = new ChatRepository()
): Promise<void> {
  try {
    const messages = await chatRepository.listMessages(scopedDb, threadId);
    const stored = messages.filter((m) => m.status === "stored");
    const lastTwo = stored.slice(-2);
    const userMsg = lastTwo.find((m) => m.role === "user");
    const assistantMsg = lastTwo.find((m) => m.role === "assistant");
    if (!userMsg || !assistantMsg) return;

    const model = await deps.aiRepository.selectModelForCapability(scopedDb, "summarization", "economy");
    if (!model) return;

    const provider = await deps.aiRepository.selectProviderWithCredential(scopedDb, model.provider_config_id);
    if (!provider?.encrypted_credential) return;
    const decrypted = deps.cipher.decryptJson(provider.encrypted_credential);
    const apiKey = decrypted.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0) return;

    // Ground supersession + dedupe against the actor's CURRENT active facts (F10/F11).
    const activeFacts = await deps.factsRepository.listActiveFacts(scopedDb, ownerUserId);
    const activeIds = new Set(activeFacts.map((f) => f.id));
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const existingByContent = new Set(activeFacts.map((f) => `${f.category}::${normalize(f.content)}`));
    // Expose ONLY the actor's real active-fact ids (bounded) so the model can supersede
    // a grounded fact instead of inventing an arbitrary id.
    const supersedableList = activeFacts
      .slice(0, 30)
      .map((f) => `${f.id} :: ${f.content.slice(0, 120)}`)
      .join("\n");

    const prompt =
      "Extract durable facts about the user from this conversation turn. Return ONLY a JSON array; " +
      "each item: {\"category\": \"preference|fact|profile|goal\", \"content\": string, " +
      "\"importance\": number 0..1, \"supersedes\": optional id}. The OPTIONAL supersedes id MUST be one " +
      "of the EXISTING FACT IDS listed below (omit it otherwise — never invent an id). No prose, no code fences.\n\n" +
      `EXISTING FACT IDS (id :: content):\n${supersedableList || "(none)"}\n\n` +
      `User: ${userMsg.body}\nAssistant: ${assistantMsg.body}`;

    const adapter =
      (deps.createAdapter ?? ((k, key, base) => new HttpApiAdapter(k, key, base ? { baseUrl: base } : {})))(
        model.provider_kind as ProviderKind,
        apiKey,
        provider.base_url
      );
    const { text } = await adapter.generateChat({
      model: { provider_kind: model.provider_kind, provider_model_id: model.provider_model_id },
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: 512
    });

    const parsed = parseFacts(text);
    for (const fact of parsed.slice(0, MAX_FACTS_PER_TURN)) {
      // Supersede ONLY a grounded, actor-owned active id (ignore hallucinated ids — F11).
      if (typeof fact.supersedes === "string" && activeIds.has(fact.supersedes)) {
        await deps.factsRepository.supersedeFact(scopedDb, fact.supersedes);
      }
      // Dedupe: skip a fact whose (category, normalized content) already exists active (F10).
      const contentKey = `${fact.category}::${normalize(fact.content)}`;
      if (existingByContent.has(contentKey)) {
        continue;
      }
      await deps.factsRepository.insertFact(scopedDb, ownerUserId, {
        category: fact.category,
        content: fact.content,
        sourceThreadId: threadId,
        importance: fact.importance
      });
      existingByContent.add(contentKey); // also dedupe within this same batch
    }
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "chat_extract_facts_failed",
        threadId,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
    // No-op degrade: never throw — a flaky extraction must not block the chat turn.
  }
}

interface ParsedFact {
  readonly category: FactCategory;
  readonly content: string;
  readonly importance: number;
  readonly supersedes?: string;
}

function parseFacts(text: string): ParsedFact[] {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const out: ParsedFact[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const category = r.category;
    const content = r.content;
    if (typeof category !== "string" || !FACT_CATEGORIES.has(category as FactCategory)) continue;
    if (typeof content !== "string" || content.trim().length === 0) continue;
    let importance = typeof r.importance === "number" ? r.importance : 0.5;
    importance = Math.min(1, Math.max(0, importance));
    out.push({
      category: category as FactCategory,
      content: content.trim(),
      importance,
      supersedes: typeof r.supersedes === "string" ? r.supersedes : undefined
    });
  }
  return out;
}
```

- Update `registerChatJobWorkers` to accept the new deps and pass them to `handleExtractFactsJob`. The
  signature change ripples to the registry (Task A13).

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run tests/integration/chat.test.ts
```

**Step 5 — Commit:**

```
git add packages/chat/src/jobs.ts tests/integration/chat.test.ts
git commit -m "feat(chat): implement handleExtractFactsJob (durable fact upsert, no-op degrade)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A13 — Module-registry: inject AI deps into chat worker

**Files**

- Modify: `packages/module-registry/src/index.ts`
- Test: `pnpm typecheck` + existing chat suite.

**Step 1 — Write the failing test.** Typecheck fails because `registerChatJobWorkers` now requires the
extract deps. (No new red unit needed; A12's test drives the handler directly.)

**Step 2 — Run it, SEE it FAIL:**

```
pnpm typecheck
```

**Step 3 — Minimal implementation.** Update the chat `registerWorkers` callback to pass
`{ embeddingProvider, extractFactsDeps: { aiRepository: new AiRepository(), cipher:
createAiSecretCipher(), factsRepository: new ChatMemoryFactsRepository() } }` (match the exact options
shape you defined in A12). Import `ChatMemoryFactsRepository` from `@jarv1s/memory`.

**Step 4 — Run it, SEE it PASS:**

```
pnpm typecheck
pnpm exec vitest run tests/integration/chat.test.ts
```

**Step 5 — Commit:**

```
git add packages/module-registry/src/index.ts
git commit -m "feat(module-registry): wire AI deps into chat extract-facts worker

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A14 — Engine gate checkpoint

**Files:** none (verification only).

Run the full gate on the engine work before moving to the design surface:

```
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm typecheck
pnpm db:migrate
pnpm test:briefings
pnpm test:chat
pnpm test:tasks
```

Fix any failures in their owning task's file (do not paper over with skips). When green, the
real-briefings engine is complete. Commit any formatting-only fixes with an explicit `git add` of the
touched files.

---

# Part B — Ritual Design Direction (design-direction spec)

> Part B is presentation-only: CSS + JSX + static HTML. It makes NO DTO/API change, NO migration, NO
> pg-boss payload. The pre-gate deliverable is the token scaffolding + the styles split + the UI
> primitives + the mockups. The app-wide restyle and the briefing-path e2e run ONLY after Ben signs off.

## Task B1 — `tokens.css` semantic token layer (taste-neutral scaffolding)

**Files**

- Create: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/main.tsx`
- Test: a CSS-lint-style assertion via `pnpm check:file-size` + a grep guard (see Self-Review). The
  human-facing proof is acceptance criterion #1/#2 (grep). Add a small node test under
  `apps/web/test/tokens.test.ts` if the web app has a Vitest harness; otherwise rely on the grep guard
  documented in Self-Review and the gate.

**Step 1 — Write the failing check.** If `apps/web` has a Vitest harness, write
`apps/web/test/tokens.test.ts` asserting every `var(--x)` referenced in `apps/web/src/**/*.css` is
defined in `tokens.css` (read both, regex-extract names, diff). If no harness exists, SKIP the unit and
instead make the grep guard in Self-Review the proof — note this explicitly here.

**Step 2 — Run it, SEE it FAIL** (tokens.css missing):

```
pnpm exec vitest run apps/web/test/tokens.test.ts   # if harness exists
```

**Step 3 — Minimal implementation.** Create `apps/web/src/styles/tokens.css` with three tiers:
primitive ramps (the ONLY hex), semantic aliases, and `[data-theme="dark"]` / `[data-theme="amber"]`
overlays that re-point semantic tokens only. It MUST define every token the app references today —
including the five `tasks.css` currently leaves undefined (`--text-muted`, `--surface-subtle`,
`--surface-active`, `--border-subtle`, `--border`) and re-express the nine existing `styles.css`
`:root` tokens as semantic aliases — plus the Ritual tokens: `--bucket-morning`, `--bucket-afternoon`,
`--bucket-evening`, `--provisional-opacity` (≈0.7), `--state-recovery`, `--state-attention` (amber/
muted, NEVER error-red). Light theme in `:root`. Example skeleton (fill the ramp with chosen values
within the locked direction — newsprint off-white surface, brand teal/green accent, amber states; NO
purple/blue AI-glow):

```css
:root {
  /* ── Tier 1: primitive ramps (the only hex in the app) ── */
  --c-neutral-0: #ffffff;
  --c-neutral-50: #f7f5f0; /* newsprint off-white */
  --c-neutral-900: #172026;
  --c-teal-500: #0f766e;
  --c-amber-500: #b45309;
  /* ...full ramps for neutral, teal/green, amber, and time-of-day hues... */

  /* ── Tier 2: semantic tokens (components use only these) ── */
  --surface: var(--c-neutral-50);
  --surface-raised: var(--c-neutral-0);
  --surface-subtle: var(--c-neutral-50);
  --surface-active: var(--c-neutral-50);
  --text: var(--c-neutral-900);
  --text-muted: #5b6670;
  --border-default: #d9d4ca;
  --border: var(--border-default);
  --border-subtle: #e7e2d8;
  --accent: var(--c-teal-500);
  --state-recovery: var(--c-amber-500);
  --state-attention: var(--c-amber-500);
  --danger: #b3261e; /* reserved for genuine system/validation failure only */
  --bucket-morning: #c8842b;
  --bucket-afternoon: #2f9e8f;
  --bucket-evening: #7c5cbf;  /* circadian evening, NOT an AI-glow gradient */
  --provisional-opacity: 0.7;
}

[data-theme="dark"] {
  --surface: #0e1418;
  --surface-raised: #172026;
  --text: #e7e2d8;
  /* ...re-point semantic tokens only... */
}

[data-theme="amber"] {
  /* evening amber overlay — semantic re-points only */
}
```

> Enumerate the exact referenced token names by grepping `apps/web/src` first
> (`grep -rhoE 'var\(--[a-z-]+' apps/web/src --include='*.css'` → sort -u) and define every one. Do not
> ship a partial set.

In `apps/web/src/main.tsx`, import tokens FIRST so the cascade resolves before consumers:

```ts
import "./styles/tokens.css";
import "./styles.css";
import "./tasks/tasks.css";
```

**Step 4 — Run it, SEE it PASS:**

```
pnpm exec vitest run apps/web/test/tokens.test.ts   # if harness exists
pnpm check:file-size
pnpm typecheck
```

**Step 5 — Commit:**

```
git add apps/web/src/styles/tokens.css apps/web/src/main.tsx apps/web/test/tokens.test.ts
git commit -m "feat(web): semantic token layer (Ritual direction, dark/amber-ready, light-first)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B2 — Split `styles.css` to honor the 1000-line cap

`apps/web/src/styles.css` is 952 lines; moving hex out + referencing tokens keeps it well under 1000,
but verify and split feature blocks if needed.

**Files**

- Modify: `apps/web/src/styles.css`
- Test: `pnpm check:file-size` is the proof.

**Step 1 — Establish the failing condition.** Confirm the current count and that tokens are now in
`tokens.css`:

```
pnpm check:file-size   # must currently pass; this task keeps it passing after edits
```

**Step 2 — Implementation.** In `styles.css`, replace all hardcoded hex/`rgb()` (the `:root`
color/background pair at lines 1-3, the `:root` token block at 16-24, and literals at ~124, ~169, etc.)
with semantic `var()` references defined in `tokens.css`. Remove the `:root` token definitions from
`styles.css` entirely (they live in `tokens.css` now). If the file approaches the cap, extract a
cohesive block (e.g. form/button rules) into a co-located feature CSS file imported after `styles.css`
in `main.tsx`.

**Step 3 — Run the proof, SEE it PASS:**

```
pnpm check:file-size
pnpm format:check
pnpm typecheck
```

**Step 4 — Commit:**

```
git add apps/web/src/styles.css apps/web/src/main.tsx
git commit -m "refactor(web): move hex into tokens.css; styles.css references semantic tokens

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B3 — Lightweight UI primitives

**Files**

- Create: `apps/web/src/ui/Card.tsx`, `Stack.tsx`, `SectionHeader.tsx`, `Badge.tsx`, `TimeBucket.tsx`,
  `ProvisionalRegion.tsx`, `index.ts`
- Test: `apps/web/test/ui.test.tsx` (if the web app has a React-testing harness; else assert via
  typecheck + the post-gate e2e). Read `apps/web` test config first.

**Step 1 — Write the failing test.** If a harness exists, render `Badge` with `tone="recovery"` and
assert it does NOT apply `--danger`; render `TimeBucket label="This Morning"` and assert the
`--bucket-morning` accent class; render `ProvisionalRegion` and assert `opacity: var(--provisional-
opacity)` and an accessible "provisional" affordance. If no harness, SKIP red-test and rely on
typecheck + e2e (note it).

**Step 2 — Run it, SEE it FAIL.**

**Step 3 — Minimal implementation.** Pure presentational components, no fetching, no `@jarv1s/shared`
data DTO imports, no API client. Example `ProvisionalRegion`:

```tsx
import type { ReactNode } from "react";

export function ProvisionalRegion({ children }: { children: ReactNode }) {
  return (
    <div
      className="provisional-region"
      style={{ opacity: "var(--provisional-opacity)" }}
      data-provisional="true"
      aria-label="Provisional — not yet confirmed"
    >
      {children}
    </div>
  );
}
```

Implement `Card`, `Stack`, `SectionHeader`, `Badge` (with a `tone: "recovery" | "attention" |
"neutral" | "accent"` prop mapping to semantic state tokens — never error-red), and `TimeBucket` (label
+ `--bucket-*` accent). Export all from `index.ts`.

**Step 4 — Run it, SEE it PASS:**

```
pnpm typecheck
pnpm exec vitest run apps/web/test/ui.test.tsx   # if harness exists
```

**Step 5 — Commit:**

```
git add apps/web/src/ui/
git commit -m "feat(web): lightweight Ritual UI primitives (Card/Stack/Badge/TimeBucket/ProvisionalRegion)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B4 — Static HTML mockups (the taste-gate deliverable)

**Files**

- Create: `docs/brand/mockups/briefing-reading.html`, `day-view-buckets.html`, `form-heavy.html`
- Test: none (these are review artifacts). Validate they are self-contained and openable.

**Step 1 — Implementation.** Create 2–3 self-contained static HTML files with inline `<style>` reusing
the SAME token names as `tokens.css` (so sign-off transfers to implementation), no build step:

1. `briefing-reading.html` — editorial single-column reading view (newsprint surface, comfortable
   measure, generous vertical rhythm, light section headers, a `--provisional-opacity` block).
2. `day-view-buckets.html` — tasks/day view with This Morning / This Afternoon / This Evening
   time-buckets, circadian accents, a semi-migration signifier, a governor 70%-opacity provisional
   block, and an at-risk item rendered with `--state-attention` (NOT `--danger`).
3. `form-heavy.html` — settings or auth, to prove the language holds on dense forms.

HARD STOP compliance across all three: no purple/blue AI-glow gradients, no sparkle/magic-wand icons,
no mascots/therapeutic softness, no chat-first dominance, no horizontal pagination.

**Step 2 — Validate.** Open each in a browser (or render headless) and confirm no external fetch and no
console errors. Confirm token names match `tokens.css`.

**Step 3 — Commit:**

```
git add docs/brand/mockups/briefing-reading.html docs/brand/mockups/day-view-buckets.html docs/brand/mockups/form-heavy.html
git commit -m "docs(brand): Ritual-direction static mockups for taste sign-off

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B5 — Pre-gate gate checkpoint

**Files:** none (verification only).

Confirm the pre-gate deliverable is green (it restyles no screen, so the full web gate must pass):

```
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm typecheck
```

When green, the overnight pre-gate deliverable is complete: spec (already approved) + tokens.css + the
styles split + the UI primitives + the mockups.

---

## ⛔ AWAIT BEN'S MOCKUP SIGN-OFF — HARD STOP GATE ⛔

**The autonomous overnight build MUST STOP HERE.** Do NOT proceed to any app-wide CSS restyle task
(B6+) until Ben has reviewed the mockups under `docs/brand/mockups/` and explicitly approved the
visual direction.

- The deliverable to present for sign-off: the three static mockups, `tokens.css`, the styles split,
  and the UI primitives — all on the branch, gate-green.
- Tasks **B6 through B9 below run ONLY after Ben's explicit approval.** If running unattended, the
  build agent stops, reports "pre-gate deliverable complete; awaiting Ben's mockup sign-off", and
  yields. It does not guess, does not restyle screens, and does not merge.
- Rationale (spec §"Architecture" / acceptance criterion #10): there is a hard taste gate; nothing
  app-wide ships until Ben signs off, and the restyle implements AGAINST the approved mockups.

---

## Task B6 — (POST-GATE) Editorial briefing reading surface

**Files**

- Create: `apps/web/src/briefings/briefing-reading-view.tsx`, `apps/web/src/briefings/briefings.css`
- Modify: `apps/web/src/briefings/briefings-page.tsx`, `apps/web/src/main.tsx` (import briefings.css)
- Test: covered by the e2e in B9; add a render unit if a harness exists.

**Step 1 — Write the failing test/e2e stub.** Stub the B9 e2e (selecting a run renders its
`summaryText` in a region with `aria-label="Briefing"`); it fails until the view exists.

**Step 2 — Run it, SEE it FAIL.**

**Step 3 — Minimal implementation.** `briefing-reading-view.tsx` renders `BriefingRunDto.summaryText`
in an editorial single-column layout, preserving paragraph/line breaks (split-on-newline into
paragraphs or `white-space: pre-wrap` — NO markdown parser; that is a deferred stretch). It consumes
the existing `BriefingRunDto` (`packages/shared/src/briefings-api.ts`) — make NO change to that file.
Wrap the region with `aria-label="Briefing"`. In `briefings-page.tsx`, replace the selected run's
chat-style card body with `<BriefingRunView run={selectedRun} />`, keeping the definitions/editor CRUD
column and the existing `useQuery` keys/API client untouched.

**Step 4 — Run it, SEE it PASS** (gate + the e2e once B9 lands):

```
pnpm typecheck
pnpm check:file-size
```

**Step 5 — Commit:**

```
git add apps/web/src/briefings/briefing-reading-view.tsx apps/web/src/briefings/briefings.css apps/web/src/briefings/briefings-page.tsx apps/web/src/main.tsx
git commit -m "feat(web): editorial briefing reading surface (renders existing summaryText)

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B7 — (POST-GATE) Tasks/day view token adoption + time-bucket rhythm

**Files**

- Modify: `apps/web/src/tasks/tasks.css`, `apps/web/src/tasks/tasks-page.tsx`
- Test: existing `tests/e2e/tasks.spec.ts` must still pass (verify selectors before editing markup).

**Step 1 — Establish the condition.** Run `tests/e2e/tasks.spec.ts` to capture the selectors it depends
on; preserve them.

**Step 2 — Implementation.** Replace the hardcoded priority/matrix hex (`tasks.css:60-134`:
`#dc2626`, `#ea580c`, `#ca8a04`, `#2563eb`, `#6b7280`) with semantic tokens; remove inline
`var(--x, #fallback)` fallbacks now that `tokens.css` defines every token. Apply the `TimeBucket`
primitive for the visual rhythm of grouped sections (This Morning / Afternoon / Evening). Do NOT add a
new persisted `TaskDefaultView` value or any time-bucket data field — bucketing is a presentation-only
derivation; persisted scheduling/recurrence belongs to the task-vertical slices.

**Step 3 — Run the proof, SEE it PASS:**

```
pnpm check:file-size
pnpm typecheck
pnpm test:e2e   # tasks.spec must still pass
```

**Step 4 — Commit:**

```
git add apps/web/src/tasks/tasks.css apps/web/src/tasks/tasks-page.tsx
git commit -m "refactor(web): tasks/day view to semantic tokens + time-bucket rhythm

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B8 — (POST-GATE) Coherent token pass across remaining screens

**Files**

- Modify: `apps/web/src/settings/settings-page.tsx`, `apps/web/src/chat/chat-drawer.tsx`,
  `apps/web/src/notifications/notifications-page.tsx`, `apps/web/src/auth/auth-screen.tsx` (+ their CSS)
- Test: existing e2e suites (`chat-drawer.spec.ts`, `app-shell.spec.ts`, `connect-google.spec.ts`) must
  still pass.

**Step 1 — Establish the condition.** Enumerate the selectors the existing e2e specs depend on for each
page; preserve them.

**Step 2 — Implementation.** Token/class-only restyle, no behavior change. Settings panels/provider
rows to tokens. Chat drawer stays a SECONDARY tool (no chat-first dominance); chrome to tokens;
provisional assistant content may use `ProvisionalRegion`. Notifications: calm/periphery; unread uses
`--state-attention` (amber/accent), NOT error-red. Auth: token adoption only. Do NOT rebuild
Calendar/Email — they are `ComingSoon` stubs owned by the connector-sync slice; this slice only
supplies the token layer + primitives they will consume.

**Step 3 — Run the proof, SEE it PASS:**

```
pnpm check:file-size
pnpm typecheck
pnpm test:e2e
```

**Step 4 — Commit:**

```
git add apps/web/src/settings/ apps/web/src/chat/chat-drawer.tsx apps/web/src/notifications/ apps/web/src/auth/
git commit -m "refactor(web): coherent Ritual token pass across settings/chat/notifications/auth

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B9 — (POST-GATE) Briefing-path Playwright e2e

**Files**

- Create: `tests/e2e/briefing-reading.spec.ts`
- Test: this IS the test; reuse `tests/e2e/mock-briefings-api.ts` fixtures.

**Step 1 — Write the failing test.** A spec that signs in, opens `/briefings`, selects a definition
with at least one run, and asserts the run's `summaryText` renders in the reading surface (the stable
`aria-label="Briefing"` region from B6). Reuse `tests/e2e/mock-briefings-api.ts` run fixtures.

**Step 2 — Run it, SEE it FAIL** (if run before B6) or confirm it now passes against B6's view:

```
pnpm test:e2e
```

**Step 3 — Confirm green** (B6 already implemented the surface).

**Step 4 — Commit:**

```
git add tests/e2e/briefing-reading.spec.ts
git commit -m "test(e2e): briefing reading path covers summaryText in the reading surface

Part of #48

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Self-Review

Run this section as the final review BEFORE the verify:foundation gate. It is part of the plan's
definition of done.

## Spec §-by-§ coverage — real-briefings spec

| Spec § / component | Plan task(s) |
| --- | --- |
| Component 1 — enable cron engine (`schedule:true`, worker only) | A11 |
| Component 2 — `schedule.ts` reconcile (cronExprFor/timezoneFor/reconcileSchedule/reconcileOwnedSchedules) | A1, A2 |
| Component 3 — routes wire schedule lifecycle (failure-isolated) | A9 |
| Component 4 — worker mints runId, fires notification | A8 |
| Component 5 — `compose.ts` grounded synthesis + degraded fallback + local-day idempotency | A6, A7 |
| Component 6 — worker composition injects deps | A10 |
| Component 7a — `commitments.listVisible` + worker-role grant (owner-or-share) | A3 |
| Component 7a' — calendar/email worker-role SELECT grants (so worker can read them) | A4b |
| Component 7b — vault recency seam | A5 |
| Component 7b' — economy output-token budget (`maxOutputTokens`) | A5b |
| Component 7c — `chat.listTodaysTurns` + per-user local-day bound in compose | A4, A6 |
| Component 8 — morning notification | A8 |
| Component 9 — `handleExtractFactsJob` | A12, A13 |
| Data flow (fixed priority order, caps, gaps) | A6 |
| Error-handling table (no_model/credential_error/synthesis_failed/gaps/blocked/idempotency/reconcile/notification) | A6, A7, A8, A9 |
| Testing strategy items 1–14 | A1–A12 tests |
| Acceptance criteria 1–12 | A1–A12 |
| Acceptance criterion 13 (gate) | A14 + final gate task |

## Spec §-by-§ coverage — design-direction spec

| Spec § / criterion | Plan task(s) |
| --- | --- |
| tokens.css (3 tiers, only-hex file, dark/amber-ready) — criteria 1,2,3 | B1 |
| styles.css split under cap — criterion 4 | B2 |
| 4–6 UI primitives — criterion 5 | B3 |
| Editorial reading surface, no DTO change — criterion 6 | B6 (post-gate) |
| 2–3 mockups — criterion 7 | B4 |
| Governor/anti-shame tokens — criterion 8 | B1, B4 |
| HARD STOP list honored — criterion 9 | B1, B4 |
| AWAIT BEN'S MOCKUP SIGN-OFF before app-wide restyle — criterion 10 | explicit gate between B5 and B6 |
| Pre-gate deliverable gate-green — criterion 11 | B5 |
| Post-gate briefing e2e — criterion 12 | B9 |

## Placeholder scan

Before the final gate, grep the diff for accidental stubs and confirm NONE remain in shipped code
(test fakes are fine):

```
git diff main --stat
grep -rn "TODO(phase3-facts)" packages/chat/src/jobs.ts   # must return NOTHING (stub replaced)
grep -rn "TODO\|FIXME\|placeholder\|NOT IMPLEMENTED\|throw new Error(\"unimplemented" packages apps | grep -v test
grep -rhoE 'var\(--[a-z-]+' apps/web/src --include='*.css' | sort -u   # cross-check every name is in tokens.css
grep -rE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'      # must match ONLY tokens.css (criterion 1)
```

## Type consistency checks

- `BriefingRunStatus` stays `"succeeded" | "blocked" | "failed"` — NO `degraded` enum was added; degraded
  runs are `succeeded` + `source_metadata.degraded`. Confirm `git diff` shows no change to
  `packages/db/src/types.ts` status enum and no change to `packages/shared/src/briefings-api.ts`.
- `BriefingRunPayload.briefingRunId` is now optional; `ALLOWED_PAYLOAD_KEYS` and
  `isBriefingRunPayloadMetadataOnly` unchanged (keys whitelisted, never required). Confirm the
  metadata-only assertion test still passes.
- The decrypted credential field name (`apiKey`) matches how `ai/routes.ts` stores `credentialPayload`.
  If different, every `decrypted.apiKey` site (compose.ts, chat/jobs.ts) must match — fix consistently.
- `ComposeDeps` / `ExtractFactsDeps` `createAdapter` factory signatures match the real `HttpApiAdapter`
  constructor `(kind, apiKey, { baseUrl })`.
- `commitments.listVisible` / `chat.listTodaysTurns` manifest entries match the `assistantTools` SDK
  type exactly (mirror `calendar/manifest.ts`); `risk: "read"`, empty `inputSchema`.
- `BriefingRunDto` unchanged: `packages/shared/src/briefings-api.ts` shows no diff (criterion 6).

## Secrets-never-escape audit

- The decrypted key is used only to construct the adapter; it is never logged (all error logs serialize
  `name` + bounded `message` only), never written to `summary_text` / `source_metadata` / notification
  metadata / job payloads / the prompt. The briefings secrets test (A7) asserts this directly.
- `source_metadata.notes[]` carry path/id + short excerpt only — never full note bodies.

## Hard-invariant final check

- No cross-user read anywhere (schedules written in owner context; jobs actor-scoped; reconcile lists
  only the actor's own definitions). No `BYPASSRLS`/SECURITY DEFINER/system principal.
- Metadata-only payloads preserved. DataContextDb-only; AccessContext unchanged.
- Provider-agnostic (capability router; no hardcoded provider/model).
- Module isolation (read-tool seams + public package APIs only).
- Migrations: only NEW file `0065` added; no applied migration edited; module SQL lives in the owning
  module's `sql/`.
- Spec-before-build satisfied (both specs approved). 1000-line cap honored (`compose.ts` + `schedule.ts`
  split; `styles.css` split).

---

## Final Task — `pnpm verify:foundation` gate

**Files:** none (verification only).

Run the full foundation gate and the release-hardening audit. Both must be green before opening the PR.

```
pnpm audit:preflight        # tree must be current (exit 0); record the commit
pnpm verify:foundation      # lint, format:check, check:file-size, typecheck, db:migrate, test:integration
pnpm audit:release-hardening
pnpm test:e2e               # only after the post-gate restyle (B6–B9) has landed
```

If any step fails, fix it in the owning task's file (never `| tail`, never skip a real failure), re-run
the full gate, and only then commit the fix (explicit `git add` of the touched files) and open the PR.
The PR body must:

- Name the grounded commit (from `audit:preflight`).
- Note that "disable via PATCH `enabled:false`" is the unschedule path (no delete route this slice).
- Flag the open risks for Ben: cron engine in worker-only (multi-replica double-fire backstop is the
  advisory-lock + local-day idempotency check, A7); economy budget tuning (`ECONOMY_MAX_OUTPUT_TOKENS`
  = 1024 — adjust after observing real briefings); email-signals quality until connector-sync lands
  (calendar/email worker grants ARE added this slice in A4b, so empty caches mean genuinely-empty/
  not-yet-synced, recorded as a neutral `empty` gap — NOT a missing grant); advisory-lock-held-during-
  synthesis tradeoff (the unique-partial-index alternative is noted in A7); DST sanity (cron `tz` is the
  IANA zone, so pg-boss handles DST shifts; the local-day idempotency uses the same `Intl` tz).
- End with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
