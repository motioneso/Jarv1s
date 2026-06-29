# Plan: scanner ranking + calendar event sanitization (#564 #567)

**Date:** 2026-06-28
**Branch:** calendar-monitor
**Issues:** #564, #567
**PR title:** `fix(monitoring): scanner ranking index mismatch, sanitize calendar event title/location (#564 #567)`

---

## Spec drift (pre-planning verification)

**#564 code fix already in c7cef3c3.** The scanner at
`packages/proactive-monitoring/src/scanner.ts` uses a `signalByTitle` title-based
Map (`const signalByTitle = new Map(allowedSignals.map((s) => [s.title, s]))`) and
looks up each ranked result by `signalByTitle.get(result.title)`. No index-pairing
bug exists on this branch. Required work: **tests only**.

**#567 still real.** `packages/calendar/src/monitor-provider.ts` lines 69, 72-73
use bare `event.title` and `event.location` without `sanitizeSnippet()`. Code fix +
tests both needed.

---

## Task 1 — [#564] Unit test for scanner priority-band assignment

**File:** `tests/unit/proactive-scanner-ranking.test.ts` (new, ~70 lines)

**Approach:**

- `vi.mock('@jarv1s/priority')` to control `rankPriorityCandidates` return value
- Fake `DataContextDb` using `dataContextBrand` symbol; fluent Kysely mock for the
  one raw `selectFrom("app.preferences")` call in `ProactiveScanner`
- Minimal `ScanDependencies` — all methods `vi.fn()`, prefs return `enabled:true`
  for source=calendar, `antiSpamPolicy.check` returns `{ allow: true }`,
  `cardRepository.upsertCard` resolves to undefined
- Provider returns TWO calendar signals in this order: "Signal Alpha"
  (signalType=prep_needed), "Signal Beta" (signalType=event_changed_soon)
- `rankPriorityCandidates` mock returns them **reversed**: Beta→critical,
  Alpha→high
- Run `scanner.scan()` with `reason="source-sync"` (skips cooldown)
- Assert `cardRepository.upsertCard` called exactly twice with:
  - "Signal Beta" → `priorityBand: "critical"`
  - "Signal Alpha" → `priorityBand: "high"`

This fails under the old index-based approach and passes with title-based lookup.

**Commit:** `test(proactive-monitoring): verify priority bands stay with signals across sort (#564)`

---

## Task 2 — [#567] Sanitize calendar event.title and event.location

### 2a — Code fix

**File:** `packages/calendar/src/monitor-provider.ts`

Add before `calendarMonitorProvider` export (exact pattern from
`packages/email/src/monitor-provider.ts`):

```typescript
const AUTH_URL_PATTERN =
  /https?:\/\/\S*[?&](token|access_token|session|auth|api_key|apikey|secret|client_secret|code|refresh_token)\S*/gi;

const CREDENTIAL_LINE_PATTERN =
  /^.*(password|passwd|api[_\s-]?key|secret[_\s-]?key|auth[_\s-]?token|session[_\s-]?token|bearer\s+\S{6,}|private[_\s-]?key|access[_\s-]?token)\s*[:=]\s*\S+.*$/gim;

function sanitizeSnippet(text: string): string {
  return text
    .replace(AUTH_URL_PATTERN, "[link removed]")
    .replace(CREDENTIAL_LINE_PATTERN, "[redacted]");
}
```

Changes to `collectSignals`:

- Line 69: `title: event.title` → `title: sanitizeSnippet(event.title).slice(0, 200)`
- Line 72 (prep_needed): wrap `event.location` → `sanitizeSnippet(event.location)`
- Line 73 (event_changed_soon): same

### 2b — Unit test

**File:** `tests/unit/calendar-monitor-sanitize.test.ts` (new, ~60 lines)

- `vi.mock('../../packages/calendar/src/repository.js')` so
  `CalendarRepository.listVisible` returns a fake event with:
  - `title` containing an auth URL (`https://example.com?token=secret123`)
  - `location` containing `password: hunter2`
  - `starts_at` 2 hours from `input.now`
- Fake `DataContextDb` using `dataContextBrand`
- Call `calendarMonitorProvider.collectSignals(fakeScopedDb, minimalInput)` with
  `maxSignals=5`, `now`, `priorityAnchors=[]`
- Assert the returned signal:
  - `title` does NOT contain `token=secret123`, DOES contain `[link removed]`
  - `summary` does NOT contain `hunter2`, DOES contain `[redacted]`

**Commit:** `fix(calendar): sanitize event.title and event.location in monitor-provider (#567)`

---

## Verification

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:unit
```

Both new test files are covered by the root vitest.config.ts (`tests/**/*.test.ts`).

No migrations. No DB changes. No shared-contract changes.
