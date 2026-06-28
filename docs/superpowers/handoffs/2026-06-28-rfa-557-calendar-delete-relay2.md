# Relay Handoff 2 — rfa-557-calendar-delete

**Date:** 2026-06-28  
**Branch:** rfa-557-calendar-delete  
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-557-calendar-delete  
**Spec:** docs/superpowers/specs/2026-06-28-calendar-delete-tool.md  
**GitHub issue:** #557  
**Coordinator label:** `Coordinator` (session id: `5e1a6b62-a480-4b5c-9706-e476cfe77044`)  
**Relay threshold:** ~80–100k tokens or compaction summary  
**Risk tier:** `security`

## What's Done — ALL 5 TASKS COMPLETE

All implementation is committed and green. Last commit: `ad418488`.

| Task                                                  | Commit     | Status |
| ----------------------------------------------------- | ---------- | ------ |
| Task 1: Types + migration SQL                         | `4b0478bb` | ✅     |
| Task 2: CalendarRepository.deleteById + test scaffold | `b295d1a6` | ✅     |
| Task 3: GoogleApiClient.deleteEvent + Section B       | `541f6b33` | ✅     |
| Task 4: Tool + manifest + Section C gateway tests     | `6d187f6b` | ✅     |
| Task 5: CalendarWriteService.deleteEvent + Section D  | `ad418488` | ✅     |

28/28 integration tests pass on lane DB `jarvis_build_557`.

### Notable implementation decisions

- **Section C test fix:** `resolveActionRequest` uses `"rejected"` not `"denied"` (postgres enum).
- **Section D scope test fix:** INSERT RLS requires calendar scope; test seeds userB with calendar scope, inserts the row, then downgrades to gmail-only via `upsertGoogleAccount` (upserts in-place) so `getCalendarWriteScopeState` sees `hasScope:false` when `deleteEvent` runs.
- **Unit test fix (`focus-time-logic.test.ts`):** Added `deleteEvent` stub to satisfy the updated `CalendarWriteService` interface.
- **`calendar-write-impl.ts` stub:** Task 1 added a "not yet implemented" stub; Task 5 replaced it with the full implementation + `deleteCachedEvent` helper.

## What's Next — PRE-PUSH CHECKLIST

### Step 1: Fast trio + rebase

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

### Step 2: Confirm migration slot with Coordinator

Message Coordinator (label `Coordinator`) via `herdr-pane-message`:

> "All 5 tasks done, 28 tests green. Need migration slot for #557 (expected 0126). Confirm before push."

### Step 3: Rename XXXX → confirmed slot (expected 0126)

Once confirmed:

```bash
mv packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql \
   packages/calendar/sql/0126_app_runtime_calendar_events_delete.sql
```

Then update two files:

- `packages/calendar/src/manifest.ts`: replace `"sql/XXXX_app_runtime_calendar_events_delete.sql"` with `"sql/0126_app_runtime_calendar_events_delete.sql"`
- `tests/integration/foundation.test.ts`: replace `{ version: "XXXX", name: "XXXX_app_runtime_calendar_events_delete.sql" }` with `{ version: "0126", name: "0126_app_runtime_calendar_events_delete.sql" }`

### Step 4: Run gate after rename

```bash
pnpm format:check && pnpm lint && pnpm typecheck
JARVIS_PGDATABASE=jarvis_build_557 pnpm test:calendar-delete 2>&1 | tail -5
JARVIS_PGDATABASE=jarvis_build_557 pnpm test:focus-time 2>&1 | tail -5
```

Also run any regressions from the spec:

```bash
JARVIS_PGDATABASE=jarvis_build_557 pnpm test:connectors 2>&1 | tail -5
JARVIS_PGDATABASE=jarvis_build_557 pnpm test:ai 2>&1 | tail -5
JARVIS_PGDATABASE=jarvis_build_557 pnpm test:ai-tools 2>&1 | tail -5
```

### Step 5: Commit renamed files

```bash
git add packages/calendar/sql/0126_app_runtime_calendar_events_delete.sql \
        packages/calendar/src/manifest.ts \
        tests/integration/foundation.test.ts
git commit -m "chore(calendar): rename migration XXXX→0126 for calendar.deleteEvent (#557)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Step 6: Invoke `coordinated-wrap-up`

Push, open PR, report to Coordinator.

## Key Invariants (still in effect)

- `calendar.deleteEvent` has `risk: "write"`, no `executionPolicy: "auto"` ✓
- `calendar_management` family `allowedTiers: ["always_confirm"]` ✓
- All DB access through `DataContextDb` (assertDataContextDb) ✓
- Google event id from `row.external_id` (never model-supplied) ✓
- Best-effort cache mirror: cache-delete failure never rethrows ✓
- Connector credentials never in result ✓

## Resume Command

```
continue rfa-557-calendar-delete; [ -d node_modules ] || pnpm install; read docs/superpowers/handoffs/2026-06-28-rfa-557-calendar-delete-relay2.md IN FULL and resume via coordinated-build. All 5 tasks done — proceed with pre-push checklist.
```
