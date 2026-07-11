# JS-05 Scheduled Monitoring & Run-Now (#934) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans semantics, driven
> inline task-by-task (execution skills are disabled in this repo). Steps use checkbox (`- [ ]`)
> syntax for tracking. Read this plan BY TASK, not front-to-back.

**Goal:** Hourly per-user sweep that runs each enabled monitor's board discovery at most once per
local day (IANA tz + HH:MM due time), plus an authenticated run-now path via the existing #915
enqueue — all persisted in `module_kv`, zero migrations.

**Architecture:** New `schedule.ts` domain (DST-safe string-comparison due-check + per-monitor
`lastCompletedLocalDate` state), a `run.ts` worker handler that dispatches
`job-search.monitor-sweep` / `job-search.monitor-run-now` job kinds into one shared
`runMonitorDiscovery` core (JS-04 `fetchBoard` safe reader → `upsertOpportunity` → retention →
`recordRun`), and manifest changes (hourly cron, `allowManualRun` + `paramsSchema` on the existing
queue, optional `timezone`/`dueTime` on `monitor.save`). Run-now reuses the #915 generic route
`POST /api/modules/:moduleId/queues/:queueName/run` (platform singleton key) — **no new
route/enqueue code in this slice**.

**Tech Stack:** TypeScript ESM, vitest, `Intl.DateTimeFormat` (no tz library), existing JS-01→04
module code under `external-modules/job-search/`.

## Global Constraints (handoff 2026-07-11, security tier)

- **ZERO migrations.** All state via `ctx.kv` (`JobSearchKv`). Migration need → STOP, escalate
  `[DESIGN-FORK]`.
- **Idempotent scheduling:** ONE module-prefixed queue ticking hourly; due-check NO-OPs unless due;
  ≤1 discovery run per local day; double-tick same hour → one run (proved by test).
- **Run-now = #915 enqueue only** (`allowManualRun` + platform singleton key
  `manual:job-search:job-search.monitor-run:<userId>`). Never hand-roll a second enqueue path.
- **Metadata-only payloads/run records:** ids, job kind, idempotency key, counts, error CODES.
  Never titles, descriptions, URLs, prose, or transport error text.
- **SSRF/prompt-injection:** all network I/O through JS-04 `fetchBoard` (host-pinned `ctx.fetch`,
  compliance + courtesy gates, fixed error messages). Never a second fetcher; external text is
  data, not instructions. No network primitives in `capture.ts` (source-grep-enforced).
- **Owner-only isolation** on all KV state (worker kv pinned to scope "user"); cross-owner proof
  required (Task 6).
- **Stale marking is OUT OF SCOPE** — deferred to JS-07 (#936): `OpportunityRecord` has no
  `monitorId`, so per-monitor stale marking would cross-contaminate monitors sharing an adapter.
  JS-05 NEVER changes opportunity statuses, especially not on fetch failure (spec: failures keep
  known jobs intact).
- **UI is JS-06** (#935). If any future rendering of `description` happens: TEXT only, never
  `dangerouslySetInnerHTML` (forward-risk #960).
- Git hygiene: `git add` explicit paths only; conventional commits with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; pre-push trio before every
  push (`pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main && git rebase origin/main`).
- Run unit suites with `pnpm vitest run tests/unit/<file>` (root vitest config; `pnpm test:unit`
  runs all).

## File Map

| File                                                                | Action | Responsibility                                                                         |
| ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `external-modules/job-search/src/domain/schedule.ts`                | Create | tz validation, local date/time math, due-check, schedule state repo                    |
| `external-modules/job-search/src/domain/keys.ts`                    | Modify | add `monitorSchedule` key                                                              |
| `external-modules/job-search/src/domain/monitors.ts`                | Modify | optional `timezone`/`dueTime` on `MonitorConfig`; `deleteMonitor` drops schedule state |
| `external-modules/job-search/src/domain/index.ts`                   | Modify | barrel-export schedule.ts                                                              |
| `external-modules/job-search/src/worker/ai-port.ts`                 | Modify | `WorkerPorts.fetch`                                                                    |
| `external-modules/job-search/src/worker/index.ts`                   | Modify | wire `ctx.fetch` → `fetchFromWorkerContext`                                            |
| `external-modules/job-search/src/worker/handlers/monitor.ts`        | Modify | validate/persist/echo timezone+dueTime                                                 |
| `external-modules/job-search/src/worker/handlers/run.ts`            | Create | discovery core + sweep/run-now dispatch                                                |
| `external-modules/job-search/src/worker/registry.ts`                | Modify | `"monitor.run"` → real handler                                                         |
| `external-modules/job-search/jarvis.module.json`                    | Modify | hourly cron; queue `allowManualRun`+`paramsSchema`; monitor.save inputSchema           |
| `tests/unit/external-module-job-search-schedule.test.ts`            | Create | Task 1 tests                                                                           |
| `tests/unit/external-module-job-search-handlers-monitor.test.ts`    | Modify | Task 2 tests                                                                           |
| `tests/unit/external-module-job-search-kv-monitors.test.ts`         | Modify | delete-cleans-schedule test                                                            |
| `tests/unit/external-module-job-search-handlers-run.test.ts`        | Create | Tasks 3–4 tests                                                                        |
| `tests/unit/external-module-job-search-manifest.test.ts`            | Modify | Task 5 tests                                                                           |
| `tests/integration/external-module-job-search-kv-isolation.test.ts` | Modify | Task 6 cross-owner proof                                                               |

---

### Task 1: Schedule domain (`schedule.ts`)

**Files:**

- Create: `external-modules/job-search/src/domain/schedule.ts`
- Modify: `external-modules/job-search/src/domain/keys.ts` (keys ABI)
- Modify: `external-modules/job-search/src/domain/monitors.ts` (`deleteMonitor` cleanup)
- Modify: `external-modules/job-search/src/domain/index.ts` (barrel)
- Test: `tests/unit/external-module-job-search-schedule.test.ts`

**Interfaces:**

- Consumes: `JobSearchKv`, `NS.monitors`, `readRecord`/`writeRecord` (records.ts), `assertId`,
  `keys` (keys.ts), `JobSearchKvError` (errors.ts).
- Produces (Tasks 2/4 rely on these exact names):
  `DEFAULT_TIMEZONE = "UTC"`, `DEFAULT_DUE_TIME = "07:00"`, `DUE_TIME_PATTERN`,
  `isValidTimeZone(tz: string): boolean`,
  `localDateAndTime(now: Date, timeZone: string): { date: string; time: string }`,
  `isDue(input: { now: Date; timeZone: string; dueTime: string; lastCompletedLocalDate?: string }): boolean`,
  `MonitorScheduleState { schemaVersion: 1; monitorId: string; lastCompletedLocalDate: string }`,
  `getScheduleState(kv, monitorId): Promise<MonitorScheduleState | null>`,
  `saveScheduleState(kv, state): Promise<void>`,
  `keys.monitorSchedule(id)` → `` `schedule/${id}` `` (NS.monitors).

- [ ] **Step 1: Write the failing test** — `tests/unit/external-module-job-search-schedule.test.ts`:

```ts
// tests/unit/external-module-job-search-schedule.test.ts
//
// JS-05 (#934): DST-safe due-check math + per-monitor schedule state.
// All assertions use fixed UTC instants mapped through real IANA zones so the
// spring-forward / fall-back / no-catch-up guarantees are proved, not assumed.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  DUE_TIME_PATTERN,
  deleteMonitor,
  getScheduleState,
  isDue,
  isValidTimeZone,
  keys,
  localDateAndTime,
  saveMonitor,
  saveMonitorCursor,
  saveScheduleState
} from "../../external-modules/job-search/src/domain/index.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

describe("job-search schedule math", () => {
  it("exposes UTC/07:00 defaults and a strict HH:MM pattern", () => {
    expect(DEFAULT_TIMEZONE).toBe("UTC");
    expect(DEFAULT_DUE_TIME).toBe("07:00");
    expect(DUE_TIME_PATTERN.test("07:00")).toBe(true);
    expect(DUE_TIME_PATTERN.test("23:59")).toBe(true);
    expect(DUE_TIME_PATTERN.test("24:00")).toBe(false);
    expect(DUE_TIME_PATTERN.test("7:00")).toBe(false);
    expect(DUE_TIME_PATTERN.test("07:00:00")).toBe(false);
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("maps an instant to local date and time per zone", () => {
    const now = new Date("2026-07-11T02:30:00Z");
    expect(localDateAndTime(now, "UTC")).toEqual({ date: "2026-07-11", time: "02:30" });
    // EDT is UTC-4: 02:30Z is still the previous local day.
    expect(localDateAndTime(now, "America/New_York")).toEqual({
      date: "2026-07-10",
      time: "22:30"
    });
  });

  it("renders local midnight as 00:xx, never 24:xx (hourCycle h23)", () => {
    const midnight = new Date("2026-07-11T00:05:00Z");
    expect(localDateAndTime(midnight, "UTC").time).toBe("00:05");
  });

  it("throws a fixed domain error for a corrupt stored zone", () => {
    expect(() => localDateAndTime(new Date("2026-07-11T00:00:00Z"), "Not/AZone")).toThrow(
      JobSearchKvError
    );
    try {
      localDateAndTime(new Date("2026-07-11T00:00:00Z"), "Not/AZone");
    } catch (error) {
      // Fixed copy only — never the raw Intl message (could echo stored bytes).
      expect((error as Error).message).toBe("timezone is not a valid IANA time zone");
    }
  });

  it("is due only once the local clock passes dueTime", () => {
    const base = { timeZone: "UTC", dueTime: "07:00" };
    expect(isDue({ ...base, now: new Date("2026-07-11T06:59:00Z") })).toBe(false);
    expect(isDue({ ...base, now: new Date("2026-07-11T07:00:00Z") })).toBe(true);
    expect(isDue({ ...base, now: new Date("2026-07-11T23:00:00Z") })).toBe(true);
  });

  it("is not due again on a completed local date (double-tick → one run)", () => {
    expect(
      isDue({
        now: new Date("2026-07-11T08:00:00Z"),
        timeZone: "UTC",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-11"
      })
    ).toBe(false);
  });

  it("uses the MONITOR's local date, not UTC's", () => {
    // 2026-07-11T02:00Z = 2026-07-10 22:00 in New York: still the old local
    // day there, so a monitor completed on local 2026-07-10 is NOT due even
    // though the UTC date already rolled over.
    expect(
      isDue({
        now: new Date("2026-07-11T02:00:00Z"),
        timeZone: "America/New_York",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-10"
      })
    ).toBe(false);
  });

  it("spring forward: a due time inside the skipped hour runs on the first tick after the jump", () => {
    // America/New_York 2026-03-08: 02:00 EST jumps to 03:00 EDT — 02:30 never
    // occurs. 06:55Z = 01:55 EST (before, not due); 07:05Z = 03:05 EDT
    // (after, due) — same local date, exactly one run.
    const base = { timeZone: "America/New_York", dueTime: "02:30" };
    expect(isDue({ ...base, now: new Date("2026-03-08T06:55:00Z") })).toBe(false);
    expect(isDue({ ...base, now: new Date("2026-03-08T07:05:00Z") })).toBe(true);
    expect(
      isDue({
        ...base,
        now: new Date("2026-03-08T07:05:00Z"),
        lastCompletedLocalDate: "2026-03-08"
      })
    ).toBe(false);
  });

  it("fall back: the repeated hour does not run twice (date completion is authoritative)", () => {
    // America/New_York 2026-11-01: 01:30 occurs twice (05:30Z EDT, 06:30Z EST).
    const base = { timeZone: "America/New_York", dueTime: "01:30" };
    expect(isDue({ ...base, now: new Date("2026-11-01T05:35:00Z") })).toBe(true);
    // After the first pass completes the local date, the repeated hour no-ops.
    expect(
      isDue({
        ...base,
        now: new Date("2026-11-01T06:35:00Z"),
        lastCompletedLocalDate: "2026-11-01"
      })
    ).toBe(false);
  });

  it("no catch-up after downtime: only the current local date is compared", () => {
    // Last completed 4 days ago; the next tick is due exactly once (today),
    // never once-per-missed-day.
    expect(
      isDue({
        now: new Date("2026-07-11T09:00:00Z"),
        timeZone: "UTC",
        dueTime: "07:00",
        lastCompletedLocalDate: "2026-07-07"
      })
    ).toBe(true);
  });
});

describe("job-search schedule state", () => {
  it("round-trips state at the schedule/<id> key in NS.monitors", async () => {
    const kv = createMemoryKv();
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(keys.monitorSchedule("mon-1")).toBe("schedule/mon-1");
    expect(await kv.list(NS.monitors)).toContain("schedule/mon-1");
    expect(await getScheduleState(kv, "mon-1")).toEqual({
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await getScheduleState(kv, "mon-2")).toBeNull();
  });

  it("rejects invalid monitor ids without echoing them", async () => {
    const kv = createMemoryKv();
    await expect(getScheduleState(kv, "bad id!")).rejects.toThrow(JobSearchKvError);
  });

  it("deleteMonitor also drops schedule state (no orphaned slots)", async () => {
    const kv = createMemoryKv();
    const now = "2026-07-11T00:00:00.000Z";
    await saveMonitor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      adapterId: "greenhouse",
      enabled: true,
      query: { board: "acme" },
      createdAt: now,
      updatedAt: now
    });
    await saveMonitorCursor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      cursor: {},
      lastCheckedAt: now
    });
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await deleteMonitor(kv, "mon-1")).toBe(true);
    expect(await kv.list(NS.monitors)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-schedule.test.ts`
Expected: FAIL — `schedule.ts` exports missing from the domain barrel.

- [ ] **Step 3: Implement** — create `external-modules/job-search/src/domain/schedule.ts`:

```ts
// external-modules/job-search/src/domain/schedule.ts
//
// JS-05 (#934): DST-safe due-check math + per-monitor schedule state.
// All comparisons are STRING comparisons on Intl-derived local dates/times
// ("YYYY-MM-DD" / "HH:MM"), never epoch arithmetic, so the DST cases fall
// out for free:
//   - spring forward (a due time inside the skipped hour): the first hourly
//     tick after the jump sees local time >= dueTime and runs — one run,
//     same local day.
//   - fall back (an hour repeats): the first pass writes
//     lastCompletedLocalDate; the repeated hour compares equal-date → no-op.
//   - downtime / no catch-up: isDue compares only the CURRENT local date;
//     missed days are never replayed.
// lastCompletedLocalDate is written ONLY after a successful scheduled run —
// run-now never consumes the local-day slot (spec: run-now is additive).
import { JobSearchKvError } from "./errors.js";
import { assertId, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";

export interface MonitorScheduleState {
  schemaVersion: 1;
  monitorId: string;
  /** Local calendar date ("YYYY-MM-DD" in the monitor's zone) of the last completed scheduled run. */
  lastCompletedLocalDate: string;
}

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_DUE_TIME = "07:00";
export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True iff this runtime's Intl accepts the zone (authoritative IANA check). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant `now` expressed as the monitor's local calendar date and
 * wall-clock time. hourCycle "h23" pins midnight to "00" — some ICU builds
 * render hour 24 under plain hour12:false, which would break the string
 * comparisons in isDue.
 */
export function localDateAndTime(now: Date, timeZone: string): { date: string; time: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
  } catch {
    // Corrupt stored zone: surface a FIXED domain message the run loop can
    // record per-monitor — never the raw Intl error (it echoes the value).
    throw new JobSearchKvError("invalid_record", "timezone is not a valid IANA time zone");
  }
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

/**
 * Scheduled due-check: run when the local wall clock has passed the due time
 * AND today's local date hasn't already completed. String `>=` on "HH:MM"
 * and `!==` on "YYYY-MM-DD" — see the file header for why this is DST-safe.
 */
export function isDue(input: {
  now: Date;
  timeZone: string;
  dueTime: string;
  lastCompletedLocalDate?: string;
}): boolean {
  const local = localDateAndTime(input.now, input.timeZone);
  return local.time >= input.dueTime && local.date !== input.lastCompletedLocalDate;
}

export async function getScheduleState(
  kv: JobSearchKv,
  monitorId: string
): Promise<MonitorScheduleState | null> {
  assertId(monitorId);
  const record = await readRecord(kv, NS.monitors, keys.monitorSchedule(monitorId));
  return record as MonitorScheduleState | null;
}

export async function saveScheduleState(
  kv: JobSearchKv,
  state: MonitorScheduleState
): Promise<void> {
  assertId(state.monitorId);
  await writeRecord(kv, NS.monitors, keys.monitorSchedule(state.monitorId), state);
}
```

NOTE: before writing, open `external-modules/job-search/src/domain/records.ts` and match the real
`readRecord`/`writeRecord` signatures (monitors.ts is the reference caller — mirror exactly how it
calls them, including any schema-version argument). Adjust the two repo functions to that calling
convention; the exported names/types above must not change.

In `external-modules/job-search/src/domain/keys.ts`, add to the `keys` object (alongside
`monitor`/`monitorCursor`):

```ts
  /** JS-05 schedule state (NS.monitors). Key ABI — breaking-contract note above applies. */
  monitorSchedule: (monitorId: string) => `schedule/${monitorId}`,
```

In `external-modules/job-search/src/domain/monitors.ts` `deleteMonitor`, add a schedule-state
delete alongside the existing cursor-first delete (same orphan rationale — state-first, config
last):

```ts
await kv.delete(NS.monitors, keys.monitorSchedule(monitorId));
```

In `external-modules/job-search/src/domain/index.ts`, add:

```ts
export {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  DUE_TIME_PATTERN,
  getScheduleState,
  isDue,
  isValidTimeZone,
  localDateAndTime,
  saveScheduleState
} from "./schedule.js";
export type { MonitorScheduleState } from "./schedule.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/external-module-job-search-schedule.test.ts tests/unit/external-module-job-search-kv-monitors.test.ts tests/unit/external-module-job-search-kv-keys.test.ts`
Expected: PASS (if kv-keys pins the `keys` object shape with `toEqual`, add the new entry there).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/schedule.ts \
  external-modules/job-search/src/domain/keys.ts \
  external-modules/job-search/src/domain/monitors.ts \
  external-modules/job-search/src/domain/index.ts \
  tests/unit/external-module-job-search-schedule.test.ts \
  tests/unit/external-module-job-search-kv-keys.test.ts
git commit -m "feat(job-search): DST-safe schedule domain for JS-05 (#934)" \
  -m "Adds local-date due-check math (Intl string comparisons, h23) and per-monitor schedule state in module_kv. No migrations." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `monitor.save` timezone + dueTime

**Files:**

- Modify: `external-modules/job-search/src/domain/monitors.ts` (`MonitorConfig` fields)
- Modify: `external-modules/job-search/src/worker/handlers/monitor.ts` (save/get/list)
- Modify: `external-modules/job-search/jarvis.module.json` (monitor.save inputSchema, ~lines 226-244)
- Test: `tests/unit/external-module-job-search-handlers-monitor.test.ts` (extend)

**Interfaces:**

- Consumes: `isValidTimeZone`, `DUE_TIME_PATTERN`, `DEFAULT_TIMEZONE`, `DEFAULT_DUE_TIME` from the
  domain barrel; `readString`, `InputError` from `../validate.js`.
- Produces: `MonitorConfig` gains `timezone?: string; dueTime?: string` (OPTIONAL — pre-JS-05
  stored records stay valid; consumers apply `?? DEFAULT_*`). `monitor.save` accepts/validates/
  persists both and echoes them; `monitor.get`/`monitor.list` echo them with defaults applied.

- [ ] **Step 1: Write the failing tests** — append to
      `tests/unit/external-module-job-search-handlers-monitor.test.ts` (reuse the file's existing
      ports/save-input fixtures; the snippets below show the assertions to add — adapt fixture names
      to the file's local helpers):

```ts
it("persists and echoes timezone and dueTime", async () => {
  const result = await save({ ...validSaveInput, timezone: "America/New_York", dueTime: "06:30" });
  expect(result).toMatchObject({ status: "ok", timezone: "America/New_York", dueTime: "06:30" });
  const got = await get({ monitorId: validSaveInput.monitorId });
  expect(got).toMatchObject({ timezone: "America/New_York", dueTime: "06:30" });
});

it("defaults timezone/dueTime to UTC/07:00 when omitted", async () => {
  const result = await save({ ...validSaveInput });
  expect(result).toMatchObject({ status: "ok", timezone: "UTC", dueTime: "07:00" });
});

it("preserves previously saved timezone/dueTime when omitted on update", async () => {
  await save({ ...validSaveInput, timezone: "America/New_York", dueTime: "06:30" });
  const result = await save({ ...validSaveInput });
  expect(result).toMatchObject({ timezone: "America/New_York", dueTime: "06:30" });
});

it("rejects a non-IANA timezone naming key+constraint only", async () => {
  await expect(save({ ...validSaveInput, timezone: "Mars/Olympus" })).rejects.toThrow(
    "timezone must be a valid IANA time zone"
  );
});

it("rejects a malformed dueTime naming key+constraint only", async () => {
  await expect(save({ ...validSaveInput, dueTime: "7am" })).rejects.toThrow(
    "dueTime must be HH:MM (24-hour)"
  );
});
```

(If the file's handlers return error envelopes via `wrap` instead of throwing, assert
`{ status: "error", code: "invalid_input", message: ... }` in the file's established style.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-monitor.test.ts`
Expected: FAIL — unknown fields ignored / not echoed.

- [ ] **Step 3: Implement.**
  1. `monitors.ts` — add to `MonitorConfig`:

```ts
  /** IANA zone for the daily discovery run. Optional: pre-JS-05 records lack it (default UTC). */
  timezone?: string;
  /** Local due time "HH:MM" 24-hour. Optional: pre-JS-05 records lack it (default 07:00). */
  dueTime?: string;
```

2. `handlers/monitor.ts` `saveMonitorHandler` — after the existing `enabled` read and existing
   `getMonitor` lookup (move the `existing` lookup ABOVE this block if it currently happens
   later — the fallback needs it):

```ts
// JS-05 (#934): schedule fields. Omitted on update → preserve, else default.
// Error messages name key + constraint only — never the submitted value.
const timezoneInput = readString(input, "timezone");
if (timezoneInput !== undefined && !isValidTimeZone(timezoneInput)) {
  throw new InputError("timezone must be a valid IANA time zone");
}
const dueTimeInput = readString(input, "dueTime");
if (dueTimeInput !== undefined && !DUE_TIME_PATTERN.test(dueTimeInput)) {
  throw new InputError("dueTime must be HH:MM (24-hour)");
}
const timezone = timezoneInput ?? existing?.timezone ?? DEFAULT_TIMEZONE;
const dueTime = dueTimeInput ?? existing?.dueTime ?? DEFAULT_DUE_TIME;
```

Persist `timezone, dueTime` in the saved `MonitorConfig` and add
`timezone, dueTime` to the `{ status: "ok", ... }` response. 3. `getMonitorHandler` / `listMonitorsHandler` — in each returned monitor object add:

```ts
    timezone: config.timezone ?? DEFAULT_TIMEZONE,
    dueTime: config.dueTime ?? DEFAULT_DUE_TIME,
```

4. `jarvis.module.json` monitor.save tool `inputSchema.properties` — add (keep
   `additionalProperties: false`; do NOT add to `required`):

```json
        "timezone": {
          "type": "string",
          "description": "IANA time zone for the daily discovery run (default UTC)"
        },
        "dueTime": {
          "type": "string",
          "description": "Local due time, HH:MM 24-hour (default 07:00)"
        }
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-monitor.test.ts tests/unit/external-module-job-search-manifest.test.ts`
Expected: PASS (if the manifest test pins the monitor.save schema, update its expectation here).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/monitors.ts \
  external-modules/job-search/src/worker/handlers/monitor.ts \
  external-modules/job-search/jarvis.module.json \
  tests/unit/external-module-job-search-handlers-monitor.test.ts \
  tests/unit/external-module-job-search-manifest.test.ts
git commit -m "feat(job-search): per-monitor timezone + daily due time (#934)" \
  -m "monitor.save accepts optional IANA timezone and HH:MM dueTime (validated, defaults UTC/07:00, preserved on update)." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `WorkerPorts.fetch` + discovery core (`run.ts` part 1)

**Files:**

- Modify: `external-modules/job-search/src/worker/ai-port.ts`
- Modify: `external-modules/job-search/src/worker/index.ts`
- Create: `external-modules/job-search/src/worker/handlers/run.ts`
- Test: `tests/unit/external-module-job-search-handlers-run.test.ts`

**Interfaces:**

- Consumes: `fetchBoard`, `fetchFromWorkerContext`, `getSourceAdapter`, `JobSearchFetchError`,
  `sanitizeInlineField`, `LOCATION_MAX_CHARS`, types `AdapterFetch`/`ModuleFetchLike`/
  `BoardConfig`/`NormalizedPosting` — ALL from `../../adapters/index.js` (barrel). Domain barrel:
  `getMonitor*`, `saveMonitorCursor`, `recordRun`, `upsertOpportunity`, `runRetentionPass`,
  `saveScheduleState`, `localDateAndTime`, `DEFAULT_TIMEZONE`, `contentHash`, plus Task 1 exports.
- Produces (Task 4 relies on): `WorkerPorts` gains `readonly fetch?: AdapterFetch | null`
  (OPTIONAL so existing handler tests that build `{ kv, ai, now }` ports stay untouched);
  `runMonitorDiscovery(ports, config: MonitorConfig, opts: { runId: string; consumeSlot: boolean }): Promise<DiscoveryOutcome>`;
  `postingToOpportunity(adapterId: string, posting: NormalizedPosting): OpportunityInput`;
  `deriveRunId(idempotencyKey: string, monitorId: string): string`;
  `DiscoveryOutcome = { ran: true; runId; counts } | { ran: false; reason: "courtesy_not_due" } | { ran: false; reason: "error"; errorCode; runId }`.

- [ ] **Step 1: Write the failing tests** — create
      `tests/unit/external-module-job-search-handlers-run.test.ts`:

```ts
// tests/unit/external-module-job-search-handlers-run.test.ts
//
// JS-05 (#934): discovery core + monitor.run dispatch. Uses the REAL
// greenhouse adapter (courtesyIntervalMs = 1h) with an injected AdapterFetch
// so the JS-04 safe-reader path (compliance, courtesy, host pinning,
// normalize) is exercised end-to-end without network.
import { describe, expect, it } from "vitest";

import type { AdapterFetch } from "../../external-modules/job-search/src/adapters/index.js";
import {
  getRunSummary,
  listOpportunities,
  listRuns,
  saveMonitor,
  saveMonitorCursor,
  type MonitorConfig
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  deriveRunId,
  monitorRunHandler,
  runMonitorDiscovery
} from "../../external-modules/job-search/src/worker/handlers/run.js";
import { createMemoryKv, type MemoryKv } from "./helpers/job-search-memory-kv.js";

const T0 = "2026-07-11T08:00:00.000Z"; // 08:00 UTC — past the 07:00 default due time

const greenhousePayload = {
  jobs: [
    {
      id: 101,
      absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
      title: "Platform Engineer",
      location: { name: "Remote" },
      content: "&lt;p&gt;Build the platform.&lt;/p&gt;",
      first_published: "2026-07-01T00:00:00Z"
    },
    {
      id: 102,
      absolute_url: "https://boards.greenhouse.io/acme/jobs/102",
      title: "Staff Engineer",
      location: { name: "New York" },
      content: "&lt;p&gt;Lead things.&lt;/p&gt;",
      first_published: "2026-07-02T00:00:00Z"
    }
  ]
};

const okFetch: AdapterFetch = async () => ({
  status: 200,
  bodyText: JSON.stringify(greenhousePayload)
});
const failFetch: AdapterFetch = async () => ({ status: 500, bodyText: "upstream exploded" });

function makePorts(kv: MemoryKv, fetch: AdapterFetch | null, nowIso: string): WorkerPorts {
  return { kv, ai: null, fetch, now: () => new Date(nowIso) };
}

function monitor(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    schemaVersion: 1,
    monitorId: "mon-1",
    adapterId: "greenhouse",
    enabled: true,
    query: { board: "acme" },
    timezone: "UTC",
    dueTime: "07:00",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("runMonitorDiscovery", () => {
  it("ingests postings, records an ok run, and advances the cursor", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: { fetched: 2, ingested: 2, suppressed: 0, skipped: 0 }
    });
    expect((await listOpportunities(kv)).length).toBe(2);
    const summary = await getRunSummary(kv, "mon-1");
    expect(summary).toMatchObject({ lastStatus: "ok" });
  });

  it("re-run is idempotent on content (second run suppresses, does not duplicate)", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    // 2h later — greenhouse courtesy (1h) has elapsed, same payload.
    const outcome = await runMonitorDiscovery(
      makePorts(kv, okFetch, "2026-07-11T10:00:00.000Z"),
      config,
      { runId: "b".repeat(32), consumeSlot: false }
    );
    expect(outcome).toMatchObject({
      ran: true,
      counts: { fetched: 2, ingested: 0, suppressed: 2 }
    });
    expect((await listOpportunities(kv)).length).toBe(2);
  });

  it("courtesy-not-due skips silently: no run record, no cursor write", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    // Checked 10 minutes ago; greenhouse courtesy interval is 1h.
    await saveMonitorCursor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      cursor: {},
      lastCheckedAt: "2026-07-11T07:50:00.000Z"
    });
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: true
    });
    expect(outcome).toEqual({ ran: false, reason: "courtesy_not_due" });
    expect(await listRuns(kv, "mon-1")).toEqual([]);
  });

  it("fetch failure records an error run, keeps known jobs, preserves lastSuccessAt, never marks stale", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const before = await listOpportunities(kv);
    const outcome = await runMonitorDiscovery(
      makePorts(kv, failFetch, "2026-07-11T10:00:00.000Z"),
      config,
      { runId: "b".repeat(32), consumeSlot: true }
    );
    expect(outcome).toMatchObject({ ran: false, reason: "error", errorCode: "unexpected_status" });
    // JS-05 NEVER touches opportunity records on failure (stale marking = JS-07).
    expect(await listOpportunities(kv)).toEqual(before);
    const summary = await getRunSummary(kv, "mon-1");
    expect(summary).toMatchObject({ lastStatus: "error" });
  });

  it("run records and outcomes are metadata-only (no titles/descriptions/URLs/upstream text)", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    await runMonitorDiscovery(makePorts(kv, failFetch, "2026-07-11T10:00:00.000Z"), config, {
      runId: "b".repeat(32),
      consumeSlot: false
    });
    for (const [storageKey, value] of (kv as MemoryKv).dump()) {
      if (!storageKey.includes(" run")) continue; // runs namespace keys only
      const encoded = JSON.stringify(value);
      expect(encoded).not.toContain("Platform Engineer");
      expect(encoded).not.toContain("greenhouse.io");
      expect(encoded).not.toContain("upstream exploded");
    }
  });

  it("deriveRunId is deterministic 32-hex (duplicate delivery converges)", () => {
    const a = deriveRunId("job-search:job-search.monitor-sweep:42", "mon-1");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveRunId("job-search:job-search.monitor-sweep:42", "mon-1")).toBe(a);
    expect(deriveRunId("job-search:job-search.monitor-sweep:43", "mon-1")).not.toBe(a);
  });

  it("records fetch_unavailable when the platform gave no fetch port", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    const outcome = await runMonitorDiscovery(makePorts(kv, null, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: true
    });
    expect(outcome).toMatchObject({ ran: false, reason: "error", errorCode: "fetch_unavailable" });
  });
});
```

(The `describe("monitor.run handler")` block is added in Task 4 — this file compiles now because
`monitorRunHandler` is exported in this task, but only the blocks above are written here.)
NOTE: check how `listRuns`/`getRunSummary` distinguish run keys in `dump()` — the runs namespace is
`NS.runs` (`job-search.runs`); adjust the metadata-only filter to
`storageKey.startsWith("job-search.runs ")` if that is the actual storage-key prefix format
(`helpers/job-search-memory-kv.ts` uses `"${namespace} ${key}"`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-run.test.ts`
Expected: FAIL — `handlers/run.js` does not exist.

- [ ] **Step 3: Implement.**
  1. `ai-port.ts` — add to `WorkerPorts` (import `type { AdapterFetch } from "../adapters/index.js"`
     — verify the relative path matches ai-port.ts's location):

```ts
  /**
   * JS-05 (#934): host-pinned network port (JS-04 safe reader input).
   * Optional-nullable: absent/null until the platform provides ctx.fetch;
   * discovery records fetch_unavailable rather than crashing.
   */
  readonly fetch?: AdapterFetch | null;
```

2. `worker/index.ts` `ports(ctx)` — mirror the existing `MaybeAiContext` pattern:

```ts
type MaybeFetchContext = ModuleWorkerContext & { readonly fetch?: ModuleFetchLike };
```

and in the returned object:

```ts
    fetch: (ctx as MaybeFetchContext).fetch
      ? fetchFromWorkerContext((ctx as MaybeFetchContext).fetch as ModuleFetchLike)
      : null,
```

(import `fetchFromWorkerContext` and `type ModuleFetchLike` from `../adapters/index.js`; if
`ModuleWorkerContext` already types `fetch`, use `ctx.fetch` directly and drop the cast.) 3. Create `external-modules/job-search/src/worker/handlers/run.ts` (discovery core half;
Task 4 appends the dispatch half to this same file):

```ts
// external-modules/job-search/src/worker/handlers/run.ts
//
// JS-05 (#934): the monitor.run queue handler — hourly sweep due-check +
// run-now — and the single discovery core both paths share.
//
// Security posture (security tier, handoff 2026-07-11):
//   - ALL network I/O goes through fetchBoard (JS-04 safe reader: compliance
//     gate, courtesy gate, host re-assert, host-pinned ctx.fetch, fixed
//     error messages). No second fetcher exists in this module.
//   - run records and response envelopes carry ids, counts, and error CODES
//     only — external text (titles, descriptions, URLs, transport errors)
//     never reaches a run record, response, or log line.
//   - JS-05 never mutates opportunity statuses: stale marking is JS-07
//     (#936) — OpportunityRecord has no monitorId, so per-monitor staleness
//     here would cross-contaminate monitors sharing an adapter.
import type { BoardConfig, NormalizedPosting } from "../../adapters/index.js";
import {
  JobSearchFetchError,
  LOCATION_MAX_CHARS,
  fetchBoard,
  getSourceAdapter,
  sanitizeInlineField
} from "../../adapters/index.js";
import type { MonitorConfig, OpportunityInput } from "../../domain/index.js";
import {
  DEFAULT_DUE_TIME,
  DEFAULT_TIMEZONE,
  contentHash,
  getMonitor,
  getMonitorCursor,
  getScheduleState,
  isDue,
  listMonitorIds,
  localDateAndTime,
  recordRun,
  runRetentionPass,
  saveMonitorCursor,
  saveScheduleState,
  upsertOpportunity
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { InputError, readPlainObject, readString } from "../validate.js";

export const SWEEP_JOB_KIND = "job-search.monitor-sweep";
export const RUN_NOW_JOB_KIND = "job-search.monitor-run-now";

export type DiscoveryOutcome =
  | { readonly ran: true; readonly runId: string; readonly counts: Record<string, number> }
  | { readonly ran: false; readonly reason: "courtesy_not_due" }
  | {
      readonly ran: false;
      readonly reason: "error";
      readonly errorCode: string;
      readonly runId: string;
    };

/**
 * Deterministic run id from the pg-boss delivery's idempotency key: a
 * duplicate delivery converges on the SAME run record instead of minting a
 * second one. 32-hex output always satisfies assertId.
 */
export function deriveRunId(idempotencyKey: string, monitorId: string): string {
  return contentHash(`run ${idempotencyKey} ${monitorId}`);
}

/** Map a normalized posting into the opportunities repo input shape. */
export function postingToOpportunity(
  adapterId: string,
  posting: NormalizedPosting
): OpportunityInput {
  return {
    adapterId,
    externalId: posting.externalId,
    canonicalUrl: posting.canonicalUrl,
    posting: {
      title: posting.title,
      company: posting.company,
      ...(posting.locations.length > 0
        ? { location: sanitizeInlineField(posting.locations.join("; "), LOCATION_MAX_CHARS) }
        : {}),
      url: posting.canonicalUrl,
      description: posting.description
    }
  };
}

/**
 * One discovery run for one monitor. Fetch-layer failures become error run
 * records, never throws — pg-boss retryLimit is reserved for infra crashes,
 * not board failures. Slot consumption (lastCompletedLocalDate) is the LAST
 * write and only on success, so an interrupted or failed run retries on the
 * next hourly tick instead of silently losing the day.
 */
export async function runMonitorDiscovery(
  ports: WorkerPorts,
  config: MonitorConfig,
  opts: { readonly runId: string; readonly consumeSlot: boolean }
): Promise<DiscoveryOutcome> {
  const kv = ports.kv;
  const startedAt = ports.now().toISOString();

  const fail = async (errorCode: string): Promise<DiscoveryOutcome> => {
    await recordRun(kv, {
      schemaVersion: 1,
      monitorId: config.monitorId,
      runId: opts.runId,
      startedAt,
      finishedAt: ports.now().toISOString(),
      status: "error",
      counts: {},
      errorCode
    });
    return { ran: false, reason: "error", errorCode, runId: opts.runId };
  };

  const adapter = getSourceAdapter(config.adapterId);
  if (adapter === null) return fail("adapter_disabled");
  const fetch = ports.fetch ?? null;
  if (fetch === null) return fail("fetch_unavailable");

  // Re-validate the stored query at run time: storage drift must never
  // reach buildUrl (defense in depth on the SSRF boundary).
  let boardConfig: BoardConfig;
  try {
    boardConfig = adapter.validateConfig(config.query);
  } catch {
    return fail("invalid_config");
  }

  const cursor = await getMonitorCursor(kv, config.monitorId);

  let fetched;
  try {
    fetched = await fetchBoard(
      { fetch, now: () => ports.now() },
      adapter,
      boardConfig,
      cursor?.lastCheckedAt
    );
  } catch (error) {
    if (error instanceof JobSearchFetchError) {
      if (error.code === "courtesy_not_due") {
        // Courtesy skip: no run record, no cursor write, slot NOT consumed —
        // the next hourly tick simply retries.
        return { ran: false, reason: "courtesy_not_due" };
      }
      // Board/transport failure: known jobs untouched (stale marking is
      // JS-07), lastCheckedAt advances (the attempt counts for courtesy),
      // lastSuccessAt preserved, slot NOT consumed → retried later today.
      await saveMonitorCursor(kv, {
        schemaVersion: 1,
        monitorId: config.monitorId,
        cursor: cursor?.cursor ?? {},
        lastCheckedAt: ports.now().toISOString(),
        ...(cursor?.lastSuccessAt !== undefined ? { lastSuccessAt: cursor.lastSuccessAt } : {})
      });
      return fail(error.code);
    }
    throw error;
  }

  let ingested = 0;
  let suppressed = 0;
  for (const posting of fetched.postings) {
    const result = await upsertOpportunity(
      kv,
      postingToOpportunity(adapter.id, posting),
      ports.now()
    );
    if (result.suppressed) suppressed += 1;
    else ingested += 1;
  }

  const finishedAt = ports.now().toISOString();
  await saveMonitorCursor(kv, {
    schemaVersion: 1,
    monitorId: config.monitorId,
    cursor: cursor?.cursor ?? {},
    lastCheckedAt: finishedAt,
    lastSuccessAt: finishedAt
  });

  // runRetentionPass ends with a feed rebuild — no separate rebuildFeed call.
  await runRetentionPass(kv, ports.now());

  const counts = {
    fetched: fetched.postings.length,
    ingested,
    suppressed,
    skipped: fetched.evidence.skippedCount
  };
  await recordRun(kv, {
    schemaVersion: 1,
    monitorId: config.monitorId,
    runId: opts.runId,
    startedAt,
    finishedAt,
    status: "ok",
    counts
  });

  if (opts.consumeSlot) {
    await saveScheduleState(kv, {
      schemaVersion: 1,
      monitorId: config.monitorId,
      lastCompletedLocalDate: localDateAndTime(ports.now(), config.timezone ?? DEFAULT_TIMEZONE)
        .date
    });
  }

  return { ran: true, runId: opts.runId, counts };
}
```

NOTE before implementing: open `external-modules/job-search/src/domain/runs.ts` and confirm the
exact `RunRecord` field set/optionality and `fetchBoard`'s return field name for skips
(`evidence.skippedCount` — confirm in `adapters/fetch-board.ts`/`types.ts`, adjust if it is
`skippedCount` on the result). Confirm `upsertOpportunity`'s `location` field name in
`OpportunityInput.posting` matches `opportunities.ts`. Adjust ONLY names, never structure.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-run.test.ts`
Expected: the `runMonitorDiscovery` describe block PASSES (Task 4's handler block not yet written).
Also run: `pnpm vitest run tests/unit/external-module-job-search-handlers-capture.test.ts tests/unit/external-module-job-search-failclosed.test.ts` — the ports type change must not break
existing suites (fetch is optional).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/worker/ai-port.ts \
  external-modules/job-search/src/worker/index.ts \
  external-modules/job-search/src/worker/handlers/run.ts \
  tests/unit/external-module-job-search-handlers-run.test.ts
git commit -m "feat(job-search): discovery core over the JS-04 safe reader (#934)" \
  -m "runMonitorDiscovery: fetchBoard -> upsertOpportunity -> retention -> metadata-only run record; courtesy skips silently; failures keep known jobs and never consume the daily slot." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `monitor.run` dispatch (sweep + run-now) + registry

**Files:**

- Modify: `external-modules/job-search/src/worker/handlers/run.ts` (append)
- Modify: `external-modules/job-search/src/worker/registry.ts`
- Test: `tests/unit/external-module-job-search-handlers-run.test.ts` (extend)
- Test: whichever test pins the `HANDLERS` table / not-implemented response — run
  `grep -rn "monitor.run" tests/unit/` and update every pin (manifest test references the queue
  handler string; a bundle/failclosed test may assert `{ status: "not-implemented" }` — flip it to
  the real handler's behavior).

**Interfaces:**

- Consumes: everything Task 3 produced; `getMonitor`, `listMonitorIds`, `getScheduleState`,
  `isDue`, `DEFAULT_TIMEZONE`, `DEFAULT_DUE_TIME` (domain barrel); `readString`,
  `readPlainObject`, `InputError` (validate.js).
- Produces: `monitorRunHandler(ports: WorkerPorts)` → `(input: Record<string, unknown>) => Promise<Record<string, unknown>>`, registered as `"monitor.run"` in `HANDLERS`. Sweep response
  `{ status: "ok", jobKind, checked, ran, skipped, failed }`; run-now responses
  `{ status: "ok", ran: true, runId, counts }` / `{ status: "ok", ran: false, reason: "courtesy_not_due" }` /
  `{ status: "error", code, message }` (fixed messages).

- [ ] **Step 1: Write the failing tests** — append to
      `tests/unit/external-module-job-search-handlers-run.test.ts`:

```ts
describe("monitor.run handler", () => {
  const sweepInput = (idempotencyKey: string) => ({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    jobKind: "job-search.monitor-sweep",
    idempotencyKey,
    params: {}
  });
  const runNowInput = (idempotencyKey: string, monitorId: string) => ({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    jobKind: "job-search.monitor-run-now",
    idempotencyKey,
    params: { monitorId }
  });

  it("sweep runs a due monitor once; a second tick the same hour/day no-ops (idempotency proof)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    const first = await handler(sweepInput("job-search:sweep:1"));
    expect(first).toMatchObject({ status: "ok", checked: 1, ran: 1 });
    // Double-tick: same local day, slot consumed → due-check no-ops. No
    // second fetch, no second run record.
    const again = monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T09:00:00.000Z"));
    const second = await again(sweepInput("job-search:sweep:2"));
    expect(second).toMatchObject({ status: "ok", checked: 1, ran: 0, skipped: 1 });
    expect((await listRuns(kv, "mon-1")).length).toBe(1);
  });

  it("sweep skips before the local due time", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ dueTime: "22:00" }));
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0)); // 08:00 UTC
    expect(await handler(sweepInput("k1"))).toMatchObject({ ran: 0, skipped: 1 });
    expect(await listRuns(kv, "mon-1")).toEqual([]);
  });

  it("sweep ignores disabled monitors", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ enabled: false }));
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    expect(await handler(sweepInput("k1"))).toMatchObject({ checked: 0, ran: 0 });
  });

  it("sweep failure does not consume the slot: a later tick the same day retries", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    await monitorRunHandler(makePorts(kv, failFetch, T0))(sweepInput("k1"));
    // 2h later (courtesy elapsed), fetch healthy again → runs the SAME day.
    const result = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T10:00:00.000Z"))(
      sweepInput("k2")
    );
    expect(result).toMatchObject({ ran: 1 });
  });

  it("sweep isolates per-monitor failures (one bad monitor never aborts the rest)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ monitorId: "mon-bad", adapterId: "greenhouse" }));
    // Corrupt the stored query so validateConfig throws at run time.
    const bad = await getMonitor(kv, "mon-bad");
    await saveMonitor(kv, { ...(bad as MonitorConfig), query: { board: "NOT A TOKEN!!" } });
    await saveMonitor(kv, monitor({ monitorId: "mon-good" }));
    const result = await monitorRunHandler(makePorts(kv, okFetch, T0))(sweepInput("k1"));
    expect(result).toMatchObject({ checked: 2, ran: 1, failed: 1 });
  });

  it("run-now runs immediately without consuming the daily slot", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    const runNow = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T05:00:00.000Z"))(
      runNowInput("manual:1", "mon-1")
    );
    expect(runNow).toMatchObject({ status: "ok", ran: true });
    // The scheduled sweep at 08:00 still runs today — run-now is additive.
    const sweep = await monitorRunHandler(makePorts(kv, okFetch, T0))(sweepInput("k1"));
    expect(sweep).toMatchObject({ ran: 1 });
  });

  it("run-now respects courtesy (compliance floor applies to manual runs too)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    await monitorRunHandler(makePorts(kv, okFetch, T0))(runNowInput("manual:1", "mon-1"));
    const second = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T08:10:00.000Z"))(
      runNowInput("manual:2", "mon-1")
    );
    expect(second).toMatchObject({ status: "ok", ran: false, reason: "courtesy_not_due" });
    expect((await listRuns(kv, "mon-1")).length).toBe(1);
  });

  it("run-now rejects unknown and disabled monitors with fixed messages", async () => {
    const kv = createMemoryKv();
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    expect(await handler(runNowInput("k1", "mon-x"))).toMatchObject({
      status: "error",
      code: "monitor_not_found"
    });
    await saveMonitor(kv, monitor({ enabled: false }));
    expect(await handler(runNowInput("k2", "mon-1"))).toMatchObject({
      status: "error",
      code: "monitor_disabled"
    });
  });

  it("rejects an unsupported jobKind naming the key only", async () => {
    const kv = createMemoryKv();
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    await expect(
      handler({ jobKind: "job-search.other", idempotencyKey: "k1", params: {} })
    ).rejects.toThrow("jobKind is not supported");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-run.test.ts`
Expected: FAIL — `monitorRunHandler` not exported.

- [ ] **Step 3: Implement** — append to `run.ts`:

```ts
/**
 * The "monitor.run" queue tool. ctx.input (per #915 worker delivery) is
 * { actorUserId, jobKind, idempotencyKey, params } — actorUserId is ignored
 * here because ports.kv is already pinned to the acting user's scope.
 */
export function monitorRunHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const jobKind = readString(input, "jobKind", { required: true });
    const idempotencyKey = readString(input, "idempotencyKey", { required: true });
    if (jobKind === SWEEP_JOB_KIND) return sweep(ports, idempotencyKey);
    if (jobKind === RUN_NOW_JOB_KIND) {
      return runNow(ports, idempotencyKey, readPlainObject(input, "params") ?? {});
    }
    throw new InputError("jobKind is not supported");
  };
}

async function sweep(ports: WorkerPorts, idempotencyKey: string): Promise<Record<string, unknown>> {
  const now = ports.now();
  let checked = 0;
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  for (const monitorId of await listMonitorIds(ports.kv)) {
    // Per-monitor isolation: a corrupt record or adapter bug in one monitor
    // must never abort the rest of the sweep.
    try {
      const config = await getMonitor(ports.kv, monitorId);
      if (config === null || !config.enabled) continue;
      checked += 1;
      const state = await getScheduleState(ports.kv, monitorId);
      const due = isDue({
        now,
        timeZone: config.timezone ?? DEFAULT_TIMEZONE,
        dueTime: config.dueTime ?? DEFAULT_DUE_TIME,
        ...(state?.lastCompletedLocalDate !== undefined
          ? { lastCompletedLocalDate: state.lastCompletedLocalDate }
          : {})
      });
      if (!due) {
        skipped += 1;
        continue;
      }
      const outcome = await runMonitorDiscovery(ports, config, {
        runId: deriveRunId(idempotencyKey, monitorId),
        consumeSlot: true
      });
      if (outcome.ran) ran += 1;
      else if (outcome.reason === "error") failed += 1;
      else skipped += 1;
    } catch {
      // Unexpected (non-fetch-layer) failure: counted only — never rethrown
      // and never echoed; the message could derive from stored bytes.
      failed += 1;
    }
  }
  // Counts only: the sweep response is a metadata surface.
  return { status: "ok", jobKind: SWEEP_JOB_KIND, checked, ran, skipped, failed };
}

async function runNow(
  ports: WorkerPorts,
  idempotencyKey: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const monitorId = readString(params, "monitorId", { required: true });
  const config = await getMonitor(ports.kv, monitorId);
  if (config === null) {
    return { status: "error", code: "monitor_not_found", message: "monitor not found" };
  }
  if (!config.enabled) {
    return { status: "error", code: "monitor_disabled", message: "monitor is not enabled" };
  }
  const outcome = await runMonitorDiscovery(ports, config, {
    runId: deriveRunId(idempotencyKey, monitorId),
    // Run-now is additive: it NEVER consumes the scheduled local-day slot.
    consumeSlot: false
  });
  if (outcome.ran) {
    return { status: "ok", ran: true, runId: outcome.runId, counts: outcome.counts };
  }
  if (outcome.reason === "courtesy_not_due") {
    return { status: "ok", ran: false, reason: "courtesy_not_due" };
  }
  return { status: "error", code: outcome.errorCode, message: "monitor run failed" };
}
```

Registry (`worker/registry.ts`): import `{ monitorRunHandler } from "./handlers/run.js"` and
replace `"monitor.run": notImplemented` with `"monitor.run": monitorRunHandler`. If
`notImplemented` becomes unused, delete it AND its comment (no dead scaffolding). Update every
test pin found by `grep -rn "monitor.run" tests/unit/`.

NOTE: `readString(params, "monitorId", { required: true })` throws InputError if absent — `wrap`
maps it to `{ status: "error", code: "invalid_input" }` at the tool boundary, which is the correct
envelope for a malformed manual payload.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/external-module-job-search-handlers-run.test.ts` then the pinned
suites you updated, then the full module sweep:
`pnpm vitest run tests/unit --testPathPattern external-module-job-search` (or list the files).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/worker/handlers/run.ts \
  external-modules/job-search/src/worker/registry.ts \
  tests/unit/external-module-job-search-handlers-run.test.ts
# plus any pinned test files updated in Step 3
git commit -m "feat(job-search): hourly sweep due-check + run-now dispatch (#934)" \
  -m "monitor.run dispatches sweep (once per local day per monitor, per-monitor failure isolation) and run-now (additive, courtesy-gated, never consumes the daily slot). Duplicate deliveries converge on one run record." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Manifest — hourly cron, allowManualRun, paramsSchema

**Files:**

- Modify: `external-modules/job-search/jarvis.module.json` (worker section, ~lines 341-360)
- Test: `tests/unit/external-module-job-search-manifest.test.ts` (extend)

**Interfaces:**

- Consumes: `assertModuleJobPayload` from `@jarv1s/jobs` (workspace package).
- Produces: run-now becomes reachable through the #915 route
  `POST /api/modules/job-search/queues/job-search.monitor-run/run` (requires `allowManualRun`;
  platform singleton key collapses double-clicks). NO new route code — this manifest change IS the
  run-now enablement.

- [ ] **Step 1: Write the failing tests** — extend the manifest test:

```ts
it("declares an hourly sweep and a manually runnable queue with a monitorId params schema", () => {
  const queue = manifest.worker.queues[0];
  expect(queue).toMatchObject({
    name: "job-search.monitor-run",
    handler: "monitor.run",
    retryLimit: 3,
    allowManualRun: true,
    paramsSchema: { type: "object", fields: { monitorId: { type: "identifier" } } }
  });
  expect(manifest.worker.schedules[0]).toMatchObject({
    id: "job-search.monitor-sweep",
    cron: "0 * * * *",
    scope: "user",
    jobKind: "job-search.monitor-sweep",
    queue: "job-search.monitor-run"
  });
});

it("payloads pass the platform metadata-only gate (sweep, run-now) and reject prose", () => {
  const queue = manifest.worker.queues[0];
  const base = {
    actorUserId: "11111111-1111-4111-8111-111111111111",
    moduleId: "job-search",
    manifestHash: `sha256:${"a".repeat(64)}`
  };
  expect(() =>
    assertModuleJobPayload(queue, { ...base, jobKind: "job-search.monitor-sweep" })
  ).not.toThrow();
  expect(() =>
    assertModuleJobPayload(queue, {
      ...base,
      jobKind: "job-search.monitor-run-now",
      params: { monitorId: "mon-1" }
    })
  ).not.toThrow();
  // Undeclared param keys (e.g. smuggled content) are rejected by the schema.
  expect(() =>
    assertModuleJobPayload(queue, {
      ...base,
      jobKind: "job-search.monitor-run-now",
      params: { title: "Senior Engineer — apply now!" }
    })
  ).toThrow();
});
```

(Import `assertModuleJobPayload` from `@jarv1s/jobs`; follow how the manifest test file already
loads `manifest`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts`
Expected: FAIL — cron still `*/15 * * * *`, no `allowManualRun`/`paramsSchema`.

- [ ] **Step 3: Implement** — in `jarvis.module.json`:

```json
    "queues": [
      {
        "name": "job-search.monitor-run",
        "handler": "monitor.run",
        "retryLimit": 3,
        "allowManualRun": true,
        "paramsSchema": {
          "type": "object",
          "fields": { "monitorId": { "type": "identifier" } }
        }
      }
    ],
```

and change the schedule's `"cron"` from `"*/15 * * * *"` to `"0 * * * *"` (hourly tick; the KV
due-check makes it ≤1 discovery/local day). Keep id/jobKind/queue/scope unchanged.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/external-module-job-search-manifest.test.ts tests/unit/external-module-job-search-bundle.test.ts`
Expected: PASS (manifest hash changes are fine — the reconciler re-registers by hash).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/jarvis.module.json \
  tests/unit/external-module-job-search-manifest.test.ts
git commit -m "feat(job-search): hourly monitor sweep + run-now via #915 manual enqueue (#934)" \
  -m "Queue gains allowManualRun + a monitorId-only paramsSchema so POST /api/modules/job-search/queues/job-search.monitor-run/run (platform singleton key) is the ONLY run-now path. Schedule ticks hourly; the KV due-check keeps discovery at most once per local day." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Cross-owner isolation proof (integration)

**Files:**

- Modify: `tests/integration/external-module-job-search-kv-isolation.test.ts`

**Interfaces:**

- Consumes: the file's existing two-owner scoped-kv fixtures (it already proves monitor/cursor/
  opportunity isolation — reuse the same fixture names) + Task 1's `saveScheduleState`/
  `getScheduleState`.
- Produces: the handoff's required owner-only proof for the NEW `schedule/<id>` state.

- [ ] **Step 1: Write the failing test** — add a case following the file's established pattern
      (adapt `kvOwnerA`/`kvOwnerB` to the file's actual fixture names):

```ts
it("schedule state is invisible across owners", async () => {
  await saveScheduleState(kvOwnerA, {
    schemaVersion: 1,
    monitorId: "mon-iso",
    lastCompletedLocalDate: "2026-07-11"
  });
  expect(await getScheduleState(kvOwnerB, "mon-iso")).toBeNull();
  expect(await kvOwnerB.list(NS.monitors)).not.toContain("schedule/mon-iso");
  // Owner A still sees their own state — the write itself landed.
  expect(await getScheduleState(kvOwnerA, "mon-iso")).toMatchObject({
    lastCompletedLocalDate: "2026-07-11"
  });
});
```

- [ ] **Step 2: Run** (integration needs the dev Postgres; per memory, do NOT run concurrently
      with another session's integration suite):

Run: `tsx scripts/test-integration.ts tests/integration/external-module-job-search-kv-isolation.test.ts`
Expected: FAIL only on missing imports before wiring; PASS once imports are added (the isolation
itself comes from module_kv RLS + the scoped kv — this test PROVES it for the new key).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/external-module-job-search-kv-isolation.test.ts
git commit -m "test(job-search): cross-owner isolation proof for schedule state (#934)" \
  -m "Owner A's schedule/<id> KV rows are invisible to owner B (module_kv RLS + user-scoped kv)." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Exit Criteria Mapping (spec → tasks)

| Spec requirement                                                                   | Task                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| Per-monitor IANA tz + local due time, validated, defaulted                         | 1, 2                                                |
| Hourly single-queue tick; due-check no-op; ≤1 run/local day; DST-safe; no catch-up | 1, 4, 5                                             |
| Double-tick idempotency proof                                                      | 4 (sweep test #1)                                   |
| Discovery over JS-04 safe reader; courtesy honored; SSRF boundary unchanged        | 3                                                   |
| Failure keeps known jobs; error runs recorded as codes; retry later same day       | 3, 4                                                |
| No stale marking (JS-07)                                                           | 3 (test asserts opportunities untouched on failure) |
| Run-now via #915 enqueue, singleton key, additive, courtesy-gated                  | 4, 5                                                |
| Metadata-only payloads + run records                                               | 3 (dump scan), 5 (assertModuleJobPayload)           |
| Owner-only KV; cross-owner proof                                                   | 6                                                   |
| Zero migrations                                                                    | all (module_kv only — no SQL touched anywhere)      |

## Wrap-up

After Task 6: pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`), `git fetch
origin main && git rebase origin/main`, full `pnpm verify:foundation`, then the
`coordinated-wrap-up` skill — PR titled `feat(job-search): scheduled monitoring + run-now (#934)`
with `Closes #934`, user-facing summary ("Job Search now checks your saved job boards once a day
at a time you choose, and you can trigger a check on demand"), report to Coordinator. No board/
merge actions.
