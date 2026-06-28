# Relay Handoff — rfa-557-calendar-delete

**Date:** 2026-06-27  
**Branch:** rfa-557-calendar-delete  
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-557-calendar-delete  
**Spec:** docs/superpowers/specs/2026-06-28-calendar-delete-tool.md (read in coordinator worktree at ~/Jarv1s/.claude/worktrees/coordinator-rfa-overnight-20260627/docs/superpowers/specs/2026-06-28-calendar-delete-tool.md)  
**GitHub issue:** #557  
**Coordinator label:** `Coordinator` (session id: `5e1a6b62-a480-4b5c-9706-e476cfe77044`)  
**Relay threshold:** ~80–100k tokens or compaction summary  
**Risk tier:** `security`

## What's Done

1. **Plan written and committed** (`6d8389dc`): `docs/superpowers/plans/2026-06-27-calendar-delete-tool.md`
2. **Plan escalated to Coordinator**: message sent via `herdr-pane-message` to label `Coordinator` — "plan ready: docs/superpowers/plans/2026-06-27-calendar-delete-tool.md. Approve or flag fork." — queued as of relay.

## What's Next (WAIT for Coordinator approval first)

Per `coordinated-build` skill: **STOP and wait** for Coordinator plan approval before writing any code. The plan has been sent; await the reply.

Once approved:

### Task 1: Foundation types + migration SQL
**Files to change:**
- `packages/shared/src/calendar-api.ts` — add `DeleteCalendarEventResponse` + `deleteCalendarEventResponseSchema`
- `packages/calendar/src/calendar-write-service.ts` — add `DeleteEventInput`, `DeleteEventResult`, `deleteEvent` to `CalendarWriteService` interface
- `packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql` — CREATE (new file; migration slot XXXX, rename to confirmed slot before push)
- `packages/calendar/src/manifest.ts` — add migration entry only (no tool yet)
- `tests/integration/foundation.test.ts` — add XXXX migration row to the asserted list

All exact code is in the plan. Commit these together.

### Task 2: CalendarRepository.deleteById + test scaffold
- Create `tests/integration/calendar-delete.test.ts` (Section A tests — repo.deleteById RLS/happy-path tests)
- Add `"test:calendar-delete"` to `package.json`
- Implement `deleteById` in `packages/calendar/src/repository.ts`

### Task 3: GoogleApiClient.deleteEvent + Section B tests
- Add Section B to `tests/integration/calendar-delete.test.ts`
- Add `deleteVoid` + `deleteEvent` to `packages/connectors/src/google-api-client.ts`

### Task 4: Tool execute/summarize + manifest + Section C tests
- Add Section C to `tests/integration/calendar-delete.test.ts`
- Add `calendarDeleteEventExecute` + `summarizeDeleteEvent` to `packages/calendar/src/tools.ts`
- Update `packages/calendar/src/manifest.ts`: add `assistantActionFamilies` + `calendar.deleteEvent` tool

### Task 5: CalendarWriteService.deleteEvent + Section D tests
- Add Section D to `tests/integration/calendar-delete.test.ts`
- Implement `deleteEvent` in `packages/chat/src/calendar-write-impl.ts`

### Pre-push
- Rebase on origin/main
- `pnpm format:check && pnpm lint && pnpm typecheck`
- Confirm migration slot with Coordinator (XXXX → expected 0126)
- Rename XXXX files, update manifest + foundation.test.ts
- Invoke `coordinated-wrap-up` skill

## Key Invariants (from spec + handoff)

- `calendar.deleteEvent` must declare `risk: "write"` and must NOT declare `executionPolicy: "auto"`
- `calendar_management` family must be locked to `allowedTiers: ["always_confirm"]`
- All DB access through `DataContextDb` (assertDataContextDb)
- Connector credentials never in responses/logs/payloads/prompts
- Google event id from internal DB row (`row.external_id`) only — never from model input directly
- Best-effort cache mirror: cache-delete failure must NEVER rethrow
- Never edit applied migrations; new SQL in `packages/calendar/sql/` only
- Migration XXXX: placeholder, rename to 0126 (expected slot) before push — coordinator confirms

## Spec Verification (already done by prior session)

- `calendar.deleteEvent` does NOT exist in manifest, tools, or service — confirmed on branch
- `calendar_management` action family does NOT exist — confirmed
- `#534` (action permission tiers) dependency is already merged on origin/main — confirmed
- `#537` (rfa-537-commitment-extraction) is parallel and owns `packages/commitments/` only — no collision

## Test Pattern References

- Integration test patterns: `tests/integration/focus-time.test.ts` + `tests/integration/focus-time-helpers.ts`
- `captureFetch`, `callAndApprove`, `RlsRejectingCalendarRepository`, `GenericFailingCalendarRepository` patterns are in those files
- `seedGoogleAccount` helper pattern needed — implemented in plan
- All test IDs: `ids.userA`, `ids.userB` from `test-database.ts`

## Resume Command

```
[ -d node_modules ] || pnpm install; read docs/superpowers/handoffs/2026-06-27-rfa-557-calendar-delete-relay.md IN FULL and resume via coordinated-build
```
