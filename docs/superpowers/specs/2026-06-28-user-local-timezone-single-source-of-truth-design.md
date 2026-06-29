# User-local timezone — single source of truth (design)

- **Issue:** #579 — all dates/times in the user's local timezone (cross-cutting)
- **Date:** 2026-06-28
- **Status:** approved design, ready for implementation plan
- **Scope:** shared time utilities (`packages/shared`), server request plumbing
  (Fastify), web API client, wellness + medication day-bucketing, the Claude live
  chat engines, and any module tool that returns timestamps.

## Problem

Dates and times are not reliably expressed in the user's local timezone. Two
distinct symptoms, two different layers:

1. **Day-bucketing (confirmed bug).** A check-in made Friday evening registered as
   Saturday. The check-in instant is stored correctly
   (`app.wellness_checkins.checked_in_at timestamptz`), but the calendar **day** is
   derived from the UTC instant, not the user's zone, so a late-evening US check-in
   lands on the next UTC day.
2. **AI / server-generated text.** When Jarvis states a time in chat, a tool
   returns a formatted timestamp, or a worker composes a notification/briefing,
   nothing guarantees the user's zone — the model is left to do timezone math, or
   the server formats in UTC/server-local.

The web **display** of an individual timestamp is mostly fine (it uses
`Intl.DateTimeFormat(undefined, …)` = browser zone), but **deriving a day from an
instant** is not.

## Root cause (grounded on this tree)

- `apps/web/src/wellness/wellness-today.tsx:696` filters today's check-ins with
  `(c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) === todayStr`. `checkedInAt`
  is a UTC ISO instant (`…T01:00:00Z`), so `.slice(0,10)` yields the **UTC**
  calendar date, while `todayStr` (lines 9–10) is built from **local**
  `getFullYear/getMonth/getDate`. Friday 8pm ET = `Saturday…Z` → mismatch.
- `apps/web/src/wellness/wellness-history.tsx:180` buckets history with the same
  `fullIso.slice(0,10)` UTC-date pattern.
- `packages/wellness/src/repository.ts:271` (`listLogsForDate`) builds day
  boundaries with `Date.UTC(date.getUTCFullYear(), getUTCMonth(), getUTCDate(), …)`
  — the same class of bug on the server side for medication logs.

These are instances of one defect class: **deriving a calendar day from an instant
in UTC instead of the user's resolved zone.**

## Single source of truth — hybrid resolution

One precedence rule, one implementation, read by every layer:

```
resolveTimeZone(headerTz, storedTz):
  1. live per-request X-Timezone header (browser Intl), if a valid IANA zone  → use it
  2. else stored settings.timezone (valid IANA)                               → use it
  3. else "UTC"
```

- **Live browser wins per-request** (handles travel/VPN); **stored setting is the
  default and the only thing backend jobs have** (workers, scheduled briefings,
  notifications — no browser, so header is absent → stored → UTC).
- Validation: a zone is accepted only if `new Intl.DateTimeFormat(undefined, {
  timeZone })` does not throw. Invalid header → ignored, fall through.

### Hard-invariant constraint: not via `AccessContext`

`AccessContext` is permanently `{actorUserId, requestId}` (workspaceId was removed
in Slice 1f). The per-request zone therefore travels as an **explicit request
signal**, never inside `AccessContext`:

- **Client:** the central web API client adds `X-Timezone:
  <Intl().resolvedOptions().timeZone>` to every `/api` request (one interceptor).
- **Server:** a Fastify `onRequest` hook reads and validates `x-timezone` and
  exposes it (e.g. `request.timeZone`). The stored setting is read only when the
  header is missing/invalid (no per-request DB read on the common path). Routes and
  tools pass the resolved zone **explicitly** to formatters/buckets.

## Shared utilities (single code source)

All three live in `@jarv1s/shared` and must be **pure / `Intl`-only** (shared is
Vite-bundled for the browser — no `node:*` imports, per existing invariant):

- `resolveTimeZone(headerTz, storedTz): string` — the precedence rule above.
- `localDay(instant, tz): string` — the civil `YYYY-MM-DD` for an instant in a
  zone, via `Intl.DateTimeFormat("en-CA", { timeZone: tz, year, month, day })` /
  `formatToParts`. **The only sanctioned way to get a day from an instant.**
- `formatInZone(instant, tz, opts): string` — wraps `Intl.DateTimeFormat`; the
  only sanctioned server-side time formatter.

## Layer 1 — day-bucketing (the wellness bug + repo-wide)

- Replace every "day from an instant" derivation with `localDay(instant, tz)`.
- **Invariant (new, enforced in review):** never compute a calendar day with
  `.slice(0,10)` on a UTC ISO string, with `Date.UTC(...)` day boundaries, or with
  `getUTC*` date parts. Use `localDay` / zone-aware boundaries.
- **Implementation plan must grep every module** for these patterns
  (`\.slice(0, ?10)` on ISO, `Date.UTC(`, `getUTCDate(`, `getUTCFullYear(`) and fix
  all sites, not only the three confirmed ones.
- The web wellness fix needs no header/settings plumbing to land — the browser
  already knows its zone, so `localDay(checkedInAt, Intl().resolvedOptions().timeZone)`
  corrects today/history/chart immediately. Server-side buckets
  (`listLogsForDate`) use the request's resolved zone.

## Layer 2 — AI / chat & server formatting

- **System prompt carries the *timezone* (stable for the session), not a static
  "current time" line.** The persistent TUI engine launches once and lives across
  turns, so a hardcoded "now" goes stale. Inject the IANA zone authoritatively at
  launch (`cli-chat-engine.ts` / `claude-print-chat-engine.ts` persona /
  `--append-system-prompt-file`); instruct the model to express all times in it.
- **Current time / data comes already-local from tools.** Module tools that return
  timestamps (calendar, email, tasks, briefings, wellness) format via
  `formatInZone` (or emit ISO + an explicit zone tag) using the request's resolved
  zone, so the model echoes correct local times instead of doing DST math.
- Server-composed text in no-browser contexts (workers, briefings, notifications)
  formats via `formatInZone` with the stored zone.

## Layer 3 — settings wiring

Stored `settings.timezone` (IANA) persists as the fallback. The browser
auto-detects and proposes populating it when unset. **The plan must first verify
whether the existing `timezone` field in `settings-api.ts` / `platform-api.ts` is
fully persisted or a `NotWired` stub**, and complete the wiring if needed before
layers 1–2 depend on it.

## Verification

- Unit tests for `resolveTimeZone` (precedence + invalid-zone fallthrough),
  `localDay` (DST edges, e.g. a US `…T01:00:00Z` instant → Friday, not Saturday),
  `formatInZone`.
- Regression test reproducing the reported bug: a check-in instant corresponding to
  Friday 20:00 in a US zone buckets to **Friday** under that zone.
- Grep audit shows **zero** remaining UTC day-derivations in module source.
- Manual: with the browser zone set to a US zone, a late-evening check-in appears
  under the correct local day in today/history/chart; chat states times in the
  local zone.

## Non-goals

- No change to per-timestamp **display** formatting that already uses
  `Intl(undefined)` correctly (that part is fine; only day-derivation is broken).
- No per-event/per-record stored timezone column; the user's resolved zone governs.
- No timezone-picker visual redesign beyond persisting the setting and the
  auto-detect prompt.
- `AccessContext` is not extended (hard invariant).
