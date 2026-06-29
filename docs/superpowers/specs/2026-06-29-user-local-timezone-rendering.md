# User-local timezone rendering for all user-facing dates/times (#579)

**Status:** Draft - RFA
**Date:** 2026-06-29
**Owner:** Ben + Coordinator fleet
**Issue:** #579 — "All dates/times shown to user should be in their local timezone"
**Tier:** routine (frontend consumption sweep + one server formatter fix on an **existing** persisted
locale store; no new tables, no migration, no RLS/auth surface, no new module)
**Grounded on:** verified `origin/main` @ `14b0e372` (isolated worktree, shared tree untouched).
Key files read:

- `~/Jarv1s/packages/settings/src/locale-routes.ts` — persisted locale store (SoT)
- `~/Jarv1s/packages/shared/src/settings-api.ts` (`LocaleSettingsDto`, quiet-hours tz)
- `~/Jarv1s/packages/chat/src/locale-utils.ts` (`extractTimezone`)
- `~/Jarv1s/packages/chat/src/live/runtime.ts` (system-prompt tz injection, ~line 481)
- `~/Jarv1s/packages/chat/src/live/cross-tool-reasoning.ts` (~line 244, ambient formatter)
- `~/Jarv1s/packages/briefings/src/compose.ts`, `schedule.ts` (already tz-aware)
- `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx` (locale pane, wired)
- `~/Jarv1s/apps/web/src/wellness/wellness-page.tsx` (already consumes locale tz)

## 1. Problem

Raw timestamps are stored in UTC (correct). But user-facing surfaces render them with the **ambient
runtime timezone** — `new Date(iso).toLocaleString()` with no `timeZone` option resolves to the
_browser's_ zone, and on the headless server box to the _server's_ zone. Neither is guaranteed to be
the user's. A user in `America/New_York` viewing the app served from a `UTC` box, or annotating from
a phone in a different zone than their laptop, sees wrong wall-clock dates/times on wellness logs,
calendar events, audit entries, task due dates, and chat provenance.

The user already has a **persisted, owner-scoped timezone preference** (see §2). The defect is that
most display sites ignore it.

## 2. What already exists (do NOT rebuild)

Per design-fork discipline, this was grepped before scoping. A large part of #579 is **already
built**; this spec completes the consumption, it does not re-architect.

- **Persisted single source of truth.** `packages/settings/src/locale-routes.ts` exposes
  `GET/PUT /api/me/locale` backed by the per-user `ProfilePreferencesPort` under key `"locale"`,
  returning `LocaleSettingsDto = { timezone: IANA, region, dateFormat: "12" | "24" }`, owner-scoped
  through `withDataContext`. This is the human-mandated persisted SoT (not per-request inference).
- **Validation.** `extractTimezone()` (chat/locale-utils) validates an IANA zone via
  `Intl.DateTimeFormat`, returning `null` on garbage.
- **AI / system-prompt path — done.** `chat/live/runtime.ts` already reads the stored locale and
  injects `User's local timezone: <tz>. Always display dates and times in this timezone.` into the
  system prompt, so model-authored dates are already correct.
- **Briefings — done.** `briefings/compose.ts` + `schedule.ts` compute "local day" windows in the
  definition's IANA tz (`timezoneFor`, `withinLocalDay`).
- **Frontend store wiring — done.** The locale pane (`settings-personal-data-panes.tsx`) is wired to
  `getLocaleSettings`/`putLocaleSettings`; `wellness-page.tsx` already fetches the locale and passes
  `timeZone` into its formatter. The pattern exists — just applied ad-hoc, not everywhere.

## 3. Decision

Introduce **one shared web formatting layer** that reads the persisted locale (`timezone` +
`dateFormat`) and route **every** user-facing date/time site through it, replacing bare
`toLocale*`/`Intl` calls. Fix the **one** remaining server-side ambient formatter. Add a guard so new
bare calls cannot silently regress the invariant. No new persistence, no migration, no browser tz
inference.

### 3.1 Web: shared locale-format module

New `apps/web/src/locale/locale-format.ts` (+ co-located test):

- `useUserLocale(): LocaleSettingsDto` — thin wrapper over the existing
  `useQuery(queryKeys.settings.locale, getLocaleSettings)`, returning the server `DEFAULT_LOCALE_SETTINGS`
  until loaded (no flash of ambient-zone dates). Single fetch, React-Query cached/shared across surfaces.
- Pure formatters that take an explicit locale so they are unit-testable without React:
  - `formatDate(iso, locale, opts?)`, `formatDateTime(iso, locale, opts?)`, `formatTime(iso, locale, opts?)`
  - each passes `{ timeZone: locale.timezone, hour12: locale.dateFormat === "12" }` into
    `Intl.DateTimeFormat`, derives the BCP-47 locale tag from `locale.region`, and returns the raw
    ISO string unchanged on an unparseable/invalid input (preserves today's defensive fallbacks,
    e.g. memory-dashboard's `isNaN` guard).
- Convenience hooks `useFormatDate()` / `useFormatDateTime()` binding `useUserLocale()` for component
  call sites.

### 3.2 Web: route all display sites through it

Replace the bare calls at these 12 grounded sites (file:line @ `14b0e372`):

- `wellness/wellness-therapy-notes.tsx:83`, `wellness/wellness-trends.tsx:53`
- `chat/answer-provenance.tsx:57`, `chat/chat-drawer.tsx:705`
- `settings/settings-activity-pane.tsx:184`, `settings/settings-audit.ts:91`
- `settings/settings-profile-subviews.tsx:210`
- `settings/settings-memory-dashboard.tsx:54,60`
- `app-route-metadata.ts:131,132,143` (the "current date" chrome — must reflect the user's _today_)

`wellness-page.tsx`'s existing ad-hoc `todayIso(timeZone)` is refactored onto the shared module so
there is one implementation. Pure (non-React) helpers like `settings-audit.ts` take an injected
`locale` argument from their caller.

### 3.3 Server: fix the one ambient formatter

`chat/live/cross-tool-reasoning.ts:244` formats a calendar `startsAt` with `toLocaleString("en-US", …)`
and **no** `timeZone`, so the model receives a server-zone string in its reasoning context. Pass the
already-available stored `timezone` (same value injected into the system prompt). All other server
date surfaces are already tz-aware (§2).

### 3.4 Guard against regression

Add a lint rule (or a focused `check:no-ambient-dates` script + test) that fails on
`toLocale(Date|Time|)String`/`new Intl.DateTimeFormat` outside `locale-format.ts`, so future code
must go through the shared layer. Mirrors the repo's existing `check:file-size` gate style.

### 3.5 Data flow

One direction, UTC at rest, convert only at the edge:

```
DB (UTC ISO timestamp)
  └─ /api/me/locale  → persisted { timezone, region, dateFormat }   (single source of truth)
       ├─ WEB:    useUserLocale() → formatInUserTimezone(iso, locale, opts) → rendered string
       └─ SERVER: stored timezone → (a) system-prompt injection (chat/live/runtime.ts, exists)
                                    (b) cross-tool-reasoning calendar formatter (§3.3, to fix)
```

The instant never mutates; only its **presentation** is zoned. No tz is written back into any record.

## 4. Testing

- **Unit** (`locale-format.test.ts`): a fixed UTC instant formats differently under
  `America/New_York` vs `Asia/Tokyo`; `dateFormat: "12"` vs `"24"` flips `hour12`; invalid ISO and
  invalid tz fall back without throwing; DST boundary instant renders the correct offset.
- **Component/integration**: render one wellness and one settings/audit surface with a mocked
  `getLocaleSettings` returning a non-UTC tz; assert the displayed wall-clock matches the user's zone,
  not the runtime's.
- **Server**: `cross-tool-reasoning` test asserts the calendar line uses the supplied tz.
- **Guard**: the no-ambient-dates check passes on the swept tree and fails on a planted bare call.
- Full gate before PR: `pnpm verify:foundation` (lint + format:check + check:file-size + typecheck +
  unit + web e2e). Record exit codes.

## 5. Non-goals

- No new `timezone` DB column / migration — the locale preference store already persists it.
- No browser/`resolvedOptions()` inference (human rejected per-request inference).
- No new settings module or new public API; reuse `/api/me/locale`.
- No change to UTC-at-rest storage or to the already-correct chat/briefings tz paths.
- No redesign of the locale settings pane UI.

## 6. Risks & mitigations

- **Loading flash**: dates could render in the default zone before locale loads → mitigate by
  defaulting to the server `DEFAULT_LOCALE_SETTINGS` and (where cheap) gating on `localeQuery` like
  wellness-page does.
- **`region` → BCP-47 validity**: an invalid region tag must not throw → wrap in the same
  try/return-raw fallback as `extractTimezone`.
- **Per-render `Intl.DateTimeFormat` cost**: negligible at these volumes; memoize the formatter by
  `(timezone, dateFormat, opts)` inside the module if profiling ever flags it.

## 7. Definition of Done

1. `locale-format.ts` + tests landed; all 12 web sites + the one server formatter routed through the
   persisted locale; ad-hoc `wellness-page` formatter consolidated.
2. Regression guard in place and wired into the gate.
3. `pnpm verify:foundation` green (exit 0 recorded).
4. PR on `feat/local-tz-579` off `origin/main`; **no merge**; gate = two non-claude reviewers +
   green CI.

## 8. Migration safety & rollout

god's brief requested a schema change + additive migration. **Grounded recon shows none is needed** —
the persisted per-user `locale` preference (timezone + region + dateFormat) already exists and is
owner-scoped (§2). So:

- **No migration.** No new column, no `infra/` change, no applied-migration edit. The hard
  "never edit applied migrations" invariant is trivially satisfied because we add no migration at all.
- **No data backfill / no RLS change.** Existing rows already carry (or default) a locale; the SoT
  and its RLS scoping are unchanged. Admins gain no bypass — display formatting is per-actor only.
- **Rollout is pure display-layer.** The change is reversible by `git revert` with zero data
  consequences; no flag, no migration ordering, no staged enablement required.
- **If the human instead wants tz promoted out of the `locale` JSON blob into a first-class profile
  column**, that becomes a _separate_ additive-migration slice — out of scope here, called out so the
  decision is explicit rather than silent.

## 9. Open question for approval

The issue text says "every user-facing date/time." This spec treats the **12 grounded web sites + 1
server formatter** as the complete set at `14b0e372`. If a surface is intentionally excluded (e.g.
relative "2h ago" strings, which carry no zone), confirm — otherwise the sweep is exhaustive per the
grep.
