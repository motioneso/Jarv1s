# Phase 3: Calendar — design port (Day/Week/Month time grid) + DTO egress hardening

**Status:** Draft (Codex adversarial plan review **in lieu of** human sign-off — this run is fully
autonomous per Ben's 2026-06-15 authorization).
**Date:** 2026-06-15
**Owner:** Calendar coordinator (autonomous run)
**GitHub:** New task issue (to be opened) linked to Epic **#48 · Phase 3 — Core Value (Real
Briefings)**, the epic that owns connector sync + focus-time self-scheduling. Folds in the MED/LOW
findings of audit issue **#145** (`[OTNR-P13] Module calendar`).
**Grounded on:** `origin/main` == `435792a` at session start (main CI green). Global migration
high-water mark = **`0087`** (owned by `packages/calendar/sql/`). Build agent re-runs
`pnpm audit:preflight` (exit 0) and records the verified commit at build time.

**Design source (read-only):** Claude Design "Jarvis Design System", primary file
`ui_kits/jarvis-app/Calendar.jsx` (+ `calendar-data.js`, and the `cal-*` rules already present in
`apps/web/src/styles/kit-calendar.css`). The design is an **Outlook-style Day / Week / Month time
grid**: hard events (external / user-created) read as **committed**; Jarvis-held blocks (focus,
prep, buffer, travel, rituals) read as **movable** — the "Governor" treatment. Clicking any item
opens a detail **peek**. Tone: calm, "Jarvis is holding this around what matters today"; hard events
always come first.

---

## Context

Unlike Wellness (whose web surface was a minimal placeholder), the Calendar **backend is already
built and the web surface already works** — it is just not the design:

- `packages/calendar` owns `app.calendar_events` (ENABLE+FORCE RLS, **owner-or-share** after
  migration `0020`). Real Google events are synced in by the connector engine
  (`packages/connectors/src/sync-jobs.ts` → `calendarRepo.upsertCachedEvent`). Jarvis focus blocks
  are inserted as **real Google events** via `proposeFocusBlock`
  (`packages/chat/src/calendar-write-impl.ts`) and mirror back through the same sync. There is **no**
  separate "block" DB entity — a Jarvis-held block is just a `calendar_events` row tagged in
  `external_metadata`.
- `apps/web/src/calendar/calendar-page.tsx` already renders a **real vertical event feed** from
  `listCalendarEvents()` via React Query (`queryKeys.calendar.list`). It already imports
  `../styles/kit-calendar.css` (the full time-grid kit), but only uses the feed layout today.

So this is a **frontend-dominant** slice (replace the feed with the design's time grid) plus a
**small, security-relevant backend seam**: the shared `CalendarEventDto` currently has no `allDay`,
no Jarvis-block discriminator, and passes the **raw `external_metadata` jsonb blob verbatim** to the
frontend (audit #145 LOW — unallowlisted egress of synced third-party content).

### What the backend can faithfully source (verified)

| Design concept                                            | Backend source                                                                                                                                                                                                                                                                                                                                | Decision                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Jarvis-held **block** vs hard **event**                   | **`external_id` starts with `jfb`** — the Google event id minted by `focusBlockEventId()` (`focus-time.ts:172-195`, fixed `jfb` tag) and stored as `externalId` on the local mirror (`calendar-write-impl.ts:99-101`, `externalId: inserted.id`). The Google event id is the upsert **conflict key**, so it is **immutable across re-syncs**. | **Derive** `isJarvisBlock = /^jfb[0-9a-v]{32}$/.test(externalId)`                                 |
| **all-day**                                               | `external_metadata.allDay` (set by sync at `sync-jobs.ts:310`)                                                                                                                                                                                                                                                                                | **Derive** `allDay`                                                                               |
| attendees                                                 | `external_metadata.attendeeCount` (a **count**, no PII)                                                                                                                                                                                                                                                                                       | **Derive** `attendeeCount`                                                                        |
| event status                                              | `external_metadata.status` (confirmed/tentative/cancelled)                                                                                                                                                                                                                                                                                    | **Derive** `status`                                                                               |
| block **subtype** (focus/prep/buffer/travel/ritual/admin) | only `proposeFocusBlock` exists → **focus only**                                                                                                                                                                                                                                                                                              | **Do not fabricate** subtypes; all Jarvis blocks render with the single focus/Governor treatment  |
| **category** (work / personal / family)                   | **not sourced anywhere**                                                                                                                                                                                                                                                                                                                      | **Do not fabricate**; external events get one "committed" treatment (no invented per-event color) |
| **moved / rescheduled** flag + note                       | **not tracked**                                                                                                                                                                                                                                                                                                                               | **Omit** (no fabrication)                                                                         |
| `where` (location)                                        | `calendar_events.location` column                                                                                                                                                                                                                                                                                                             | map to `where`                                                                                    |
| `who` (named attendees)                                   | **not stored** (only a count)                                                                                                                                                                                                                                                                                                                 | show count-only ("3 people"), never names                                                         |

This is a **UI-honesty** boundary (Phase-1 principle): the port renders only what the backend can
source. No fabricated categories, block subtypes, or reschedule history.

> **Codex plan-review R1 (resolved).** The Jarvis-block marker must **not** be
> `external_metadata.jarvisCreated`: Google sync (`sync-jobs.ts:306`) **replaces** `external_metadata`
> on conflict (`repository.ts:96`) and does not preserve Google `extendedProperties.private`, so a
> later re-sync **erases** the `jarvisCreated` flag. The `external_id` `jfb` prefix is the conflict
> key and survives re-sync — it is the only reliable marker, and it keeps the "no connectors change"
> scope intact. Tests must prove a re-synced focus block (metadata flag gone) still derives
> `isJarvisBlock=true`.

---

## Goals

1. Replace the Calendar web surface (`apps/web/src/calendar/`) with a faithful port of the design's
   **Day / Week / Month** time grid: overlap packing, all-day strip, current-time line, the detail
   **peek** panel, the committed-vs-Jarvis-holding legend, and view/cursor/work-week persistence —
   wired to **real** data from `listCalendarEvents()` via React Query (no synthetic fixture dates).
2. **Harden the calendar DTO egress**: replace the raw `external_metadata` passthrough with an
   **allowlisted** projection, exposing only the derived display fields the UI needs
   (`isJarvisBlock`, `allDay`, `attendeeCount`, `status`). Fixes audit #145 LOW.
3. Extract a pure **`serialize.ts`** (DTO mapping) so `tools.ts` no longer imports from the HTTP
   route layer (fixes audit #145 LOW coupling), and move test-only `createCachedEventForTest` out of
   the production repository (fixes audit #145 MED).
4. Keep everything inside the calendar blast radius: `packages/calendar/*`,
   `packages/shared/src/calendar-api.ts`, `apps/web/src/calendar/*`,
   `apps/web/src/api/{client.ts,query-keys.ts}` (only if a field rename is needed), and
   `apps/web/src/styles/kit-calendar.css`. **No migration. No other module changed.**

## Non-Goals (deferred)

- **No new calendar backend capability**: no new sync, no new write path, no focus-block scheduler
  trigger, no event create/edit/delete from the web (the surface is **read + peek** only, matching
  the design — the peek has no Save/Move buttons).
- **No block-subtype taxonomy** (prep/buffer/travel/ritual/admin). Only Jarvis **focus** blocks
  exist today; render them with the one Governor treatment.
- **No category model** (work/personal/family) and **no reschedule history** — not sourced; omit.
- **No RLS / policy / migration change.** The owner-or-share model is untouched; this slice adds
  zero schema.
- **No Tweaks wiring** (`calDensity` Comfortable/Compact, `calBlockStyle` Ghost/Hatched). Ship a
  fixed sensible default (Comfortable + Ghost); a Tweaks panel is later.
- **No drag-to-move / drag-to-resize.** The "movable" reading is **visual** (the Governor
  treatment + peek copy), not an interaction this slice.

---

## Resolved Decisions

1. **DTO becomes a derived view model, not a column mirror.** In `packages/shared/src/calendar-api.ts`,
   `CalendarEventDto` keeps `id, connectorAccountId, ownerUserId, title, startsAt, endsAt,
location|null, summary|null, bodyExcerpt|null, externalId, createdAt, updatedAt` and **replaces
   the raw `externalMetadata` field** with the allowlisted derived fields, each **type-narrowed**
   (never pass a raw value through under an allowlisted key — Codex R1 BLOCKER 2):
   - `isJarvisBlock: boolean` — `/^jfb[0-9a-v]{32}$/.test(externalId)` — the **exact** minted
     focus-block id shape (`jfb` + 32 base32hex chars, `focus-time.ts:187-194`), immutable across
     re-sync; **not** a loose `startsWith('jfb')` (an arbitrary external Google id could begin `jfb`
     and be a false positive — Codex R2) and **not** the sync-erasable metadata flag
   - `allDay: boolean` — `external_metadata.allDay === true` (strict `=== true`)
   - `attendeeCount: number` — `typeof md.attendeeCount === 'number' && Number.isFinite(md.attendeeCount) ? md.attendeeCount : 0`
   - `status: string | null` — `typeof md.status === 'string' ? md.status : null`
     Update `calendarEventDtoSchema` accordingly. Browser-safe: **no `node:*` imports** (this file is
     Vite-bundled — see the Shared Browser Bundle memory).
2. **New `packages/calendar/src/serialize.ts`** — a pure `serializeCalendarEvent(row): CalendarEventDto`
   that performs the allowlisted derivation above. It is the **single** place `external_metadata` is
   read; the raw blob never leaves this function. `routes.ts` and `tools.ts` both import from here
   (tools no longer imports from `routes.ts` — fixes #145 LOW coupling). `routes.ts` keeps its
   existing `withDataContext` + `handleRouteError` flow (the #145 MED 401-swallow finding already
   appears fixed — the build agent **verifies** `handleRouteError` is used and the catch does not
   blanket-map to 401).
3. **Egress allowlist is the security control — key-select AND value-narrow.** The derivation reads
   only the known-safe keys and **drops everything else** in `external_metadata` (Gmail `historyId`,
   `labelIds`, `htmlLink`, raw Google blobs, future unknown keys). Crucially it also **type-narrows
   every projected value** (Decision 1): a non-scalar under an allowlisted key (e.g. an object in
   `status`) is coerced to the safe default, never passed through. No raw metadata, no attendee
   names/emails, no conferencing payloads, no nested blobs reach the frontend — or `tools.ts`/MCP, or
   AI prompts. (LLM-field-exfiltration-class lesson applied to sync egress: allowlist keys IN **and**
   validate value shape — key selection alone is not enough.)
4. **Move `createCachedEventForTest` out of the production repository** into the integration-test
   fixtures (fixes #145 MED). Production `CalendarRepository` exposes only real methods
   (`listVisible`, `getById`, `upsertCachedEvent`, …).
5. **Frontend port uses real dates, not the fixture serial model.** `calendar-data.js`'s synthetic
   2026 serial calendar is design-fixture only. The port computes Day/Week/Month ranges and
   navigation from **real `Date`** math over the events' ISO `startsAt`/`endsAt`. "Today" is the
   real today; the now-line uses the real current minute.
6. **View model mapping (frontend).** Each `CalendarEventDto` → a view event:
   `kind = isJarvisBlock ? 'block' : 'event'`; timed vs `allDay` from the DTO; `where = location`;
   attendees shown as a **count** ("N people") only when `attendeeCount > 0`. Jarvis blocks get the
   `cal-ev--block` + Governor (ghost) treatment and the peek's "Jarvis is holding this" copy;
   external events get the single committed treatment. **No category color** is invented — the
   committed treatment is one neutral accent (the design's near-monochrome system already collapses
   most categories to "steel"; using one committed color is faithful and honest).
7. **Decompose the port to stay < 1000 lines/file** (`pnpm check:file-size`):
   - `calendar-page.tsx` — toolbar (Today / prev-next / range label), view + work-week segmented
     controls (className-based `segmented-control`, per the web DS pattern), legend, body switch, and
     React-Query wiring to `listCalendarEvents`.
   - `calendar-time-grid.tsx` — the Day/Week shared time grid: day headers, all-day strip, scrollable
     24h timeline, now-line, overlap **packing** (port `packDay`), `EventBlock`.
   - `calendar-month.tsx` — the month grid (6/5-week trim, per-cell event chips + "N more").
   - `calendar-peek.tsx` — the detail peek panel (committed vs holding header, time/dur, where,
     attendee count, holding note).
   - `calendar-model.ts` — real-date helpers (range build, day-of-week, fmtTime/fmtHour/fmtDur) +
     DTO→view mapping. Browser-only.
     These render via the existing **className-based** DS classes (`segmented-control`, button classes,
     the `cal-*` rules in `kit-calendar.css`) — there are no `SegmentedControl`/`IconButton` React
     components in the web app; use plain elements + classNames (the wellness/settings passes
     established this).
8. **Styles.** Reuse / extend the existing `apps/web/src/styles/kit-calendar.css` (already imported
   by the page). Port any missing `cal-*` rules from the design's CSS. Keep the file < 1000 lines
   (split a `kit-calendar-grid.css` if needed, preserving import order).

---

## Architecture (deltas only)

### A. Shared contract (`packages/shared/src/calendar-api.ts`)

- `CalendarEventDto`: drop `externalMetadata`; add `isJarvisBlock`, `allDay`, `attendeeCount`,
  `status`. Update `calendarEventDtoSchema` + the route response schemas. Keep browser-safe.

### B. Calendar package (`packages/calendar/src/`)

- **`serialize.ts`** (new): `serializeCalendarEvent(row)` — the only reader of `external_metadata`;
  key-allowlist + per-value type-narrowing (Decision 1/3); `isJarvisBlock` from `externalId`
  `jfb`-prefix.
- `routes.ts`: import `serializeCalendarEvent` from `./serialize` (was inline); keep
  `withDataContext` + `handleRouteError`; verify no blanket-401 catch.
- `tools.ts`: import `serializeCalendarEvent` from `./serialize` (was from `./routes`).
- `repository.ts`: remove `createCachedEventForTest` (relocate to test fixtures). **Keep the
  write-path `externalMetadata?` input field on `upsertCachedEvent`/insert** — only the **read/egress
  DTO** drops it. The connector sync (`sync-jobs.ts`) and focus-block writer
  (`calendar-write-impl.ts`) still write `external_metadata`; that is untouched.
- `index.ts`: re-export `serializeCalendarEvent` from `./serialize` (keep public surface stable).
- `manifest.ts`: unchanged (routes already declared).

### C. Web (`apps/web/src/calendar/` + styles)

- Replace the feed with `calendar-page.tsx` + `calendar-time-grid.tsx` + `calendar-month.tsx` +
  `calendar-peek.tsx` + `calendar-model.ts` (Decision 7). Wire to existing
  `listCalendarEvents()` / `queryKeys.calendar.list`. View/cursor/work-week persisted to
  `localStorage` (`jarvis.cal.*`, matching the design keys).
- `apps/web/src/api/client.ts` / `query-keys.ts`: update the `CalendarEventDto`-typed fetch fn; the
  list endpoint URL is unchanged.
- **Update ALL `CalendarEventDto` consumers / constructors** that the field removal breaks (Codex R1
  note — the earlier "no consumers" claim was too narrow). Typecheck will flag them; known set:
  `apps/web/src/today/today-page.tsx`, `apps/web/src/chat/seeds.ts`, `apps/web/src/chat/chat-drawer.tsx`,
  and the e2e mock factories `tests/e2e/mock-calendar-email-api.ts` + `tests/e2e/mock-api.ts` (these
  construct `externalMetadata` and must switch to the new derived fields). Grep `externalMetadata`
  and `CalendarEventDto` repo-wide before finishing.
- `apps/web/src/styles/kit-calendar.css`: port missing `cal-*` rules; keep < 1000 lines.

---

## Testing strategy

Extend `tests/integration/calendar-email.test.ts` (**`pnpm test:calendar-email`** — the real suite;
there is no `test:calendar` script) — **egress / value-shape focus**:

- **Serialize / egress allowlist (the security-critical test):** a row with `external_id`
  not-`jfb` whose `external_metadata` contains `{ allDay:true, attendeeCount:3, status:'confirmed',
historyId:'x', labelIds:[...], htmlLink:'…', secretJunk:'should-not-leak' }` serializes to a DTO
  with exactly `allDay=true, attendeeCount=3, status='confirmed', isJarvisBlock=false` and **no**
  `historyId`, `labelIds`, `htmlLink`, `secretJunk`, or any `externalMetadata` key. A row with no
  metadata → `isJarvisBlock=false, allDay=false, attendeeCount=0, status=null`.
- **Value-shape narrowing (Codex R1 BLOCKER 2):** a row whose allowlisted keys hold WRONG types —
  `{ status:{nested:'blob'}, attendeeCount:'12', allDay:'yes' }` — serializes to `status=null,
attendeeCount=0, allDay=false` (no object/blob passed through under an allowlisted key).
- **Jarvis-block marker robustness + false-positive (Codex R1 B1 / R2):** a real minted id
  (`jfb`+32 base32hex) → `isJarvisBlock=true` **even when `external_metadata` has NO `jarvisCreated`**
  (post-sync row, metadata overwritten); a normal Google id → `false`; and a **false-positive guard**:
  an arbitrary external id that merely starts with `jfb` but is NOT the exact `jfb[0-9a-v]{32}` shape
  (e.g. `jfbMEETING_2026`) → `isJarvisBlock=false`.
- **tools.ts egress:** `calendarListVisibleEventsExecute` (AI/MCP path) returns the same allowlisted,
  value-narrowed shape via `./serialize` — no raw metadata leaks through `renderToolResult` JSON.
- **RLS unchanged:** owner-or-share still holds (actor B sees A's event only via a share); add no
  new policy assertions beyond confirming nothing regressed.
- **`tools.ts` decoupling:** `calendarListVisibleEventsExecute` returns the same allowlisted shape
  (no raw metadata) via `./serialize`.
- **Web (Playwright smoke):** `/calendar` renders the time grid (Day default); switching to Week and
  Month renders; a Jarvis-held block shows the "holding" treatment and its peek says "Jarvis is
  holding this"; an external event's peek shows time/location/attendee-count; no console errors.
- **Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green; no source file > 1000
  lines.

---

## Exit Criteria

1. `CalendarEventDto` exposes `isJarvisBlock`, `allDay`, `attendeeCount`, `status` and **no longer
   carries the raw `externalMetadata` blob**; schemas updated; browser-safe.
2. `serialize.ts` is the single reader of `external_metadata`, allowlisting the safe keys, **type-
   narrowing each projected value** (non-scalars → safe default), and deriving `isJarvisBlock` from
   the exact `/^jfb[0-9a-v]{32}$/` id shape (not a loose prefix, not the sync-erasable metadata flag); it drops all other keys.
   `routes.ts` and `tools.ts` both import it; `tools.ts` no longer imports from `routes.ts`. (Audit
   #145 LOW × 2 resolved; Codex R1 BLOCKERS 1+2 resolved.)
3. `createCachedEventForTest` removed from the production repository (audit #145 MED resolved); the
   route error handler verified to surface non-session errors (not blanket-401).
4. Web Calendar matches the design: Day/Week/Month time grid with overlap packing, all-day strip,
   current-time line, detail peek, committed-vs-holding legend, Today/prev-next nav, work-week
   toggle, view/cursor persistence — all from **real** `listCalendarEvents` data. The old feed is
   gone. No fabricated categories / block subtypes / reschedule flags.
5. RLS, migrations, and all other modules untouched (no schema change; owner-or-share preserved).
6. Egress held: no raw `external_metadata`, attendee names/emails, or non-allowlisted keys reach any
   frontend response, log, job payload, or AI prompt. The allowlist test proves it.
7. Gate + release-hardening green; no file > 1000 lines.

**Stretch (not blocking):** Tweaks wiring (density/block-style); honoring a real Google
`colorId`/category if one is later added to sync; keyboard nav of the grid.

---

## Hard Invariants Honored (from CLAUDE.md)

- **Secrets / private content never escape:** the egress allowlist is the centerpiece — synced
  third-party metadata is projected down to four known-safe derived fields; everything else is
  dropped at `serialize.ts`. No attendee PII, no raw blobs, anywhere downstream.
- **Private by default / owner-or-share preserved:** no RLS or policy change; the calendar stays
  owner-or-share exactly as migration `0020`/`0087` left it.
- **DataContextDb only:** all reads stay under `withDataContext`; `assertDataContextDb` first; no new
  raw-Kysely access.
- **Never edit applied migrations:** **no migration is added or edited** this slice.
- **Module isolation:** changes confined to `packages/calendar` + `shared` (calendar-api) +
  `apps/web/src/calendar` + styles; no other module imported; no other module's tables queried.
- **Provider-agnostic AI:** no provider/model hardcoded (calendar tools unchanged in that respect).
- **Spec before build:** this document is that gate; Codex adversarial review substitutes for the
  human approval on this autonomous run.

---

## Open Risks

1. **Real-date port correctness.** Replacing the fixture serial model with real `Date` math
   (week boundaries, month grid, DST-naive minute math for the now-line) is the main bug surface.
   Mitigation: keep date helpers pure in `calendar-model.ts` and unit-test the range/packing math.
2. **Overlap packing fidelity.** The design's `packDay` column algorithm must be ported faithfully or
   overlapping meetings render wrong. Mitigation: port verbatim; test with the design's Thursday set.
3. **Egress regression.** If a future sync adds a new `external_metadata` key, OR puts a non-scalar
   under an existing allowlisted key, the projection must not silently pass it. Mitigation:
   allowlist-in (not blocklist-out) **plus per-value type-narrowing** + tests asserting unknown keys
   dropped and wrong-typed values coerced to safe defaults (Codex R1 BLOCKER 2).
4. **File-size gate** on the CSS / page. Mitigation: decomposition plan in Decision 7/8; split if
   approaching 1000 lines, preserving import order (see the File-size gate memory).
5. **DTO field rename breaking other callers.** ✅ Pre-verified at spec time: a repo-wide grep found
   **no consumer reads `CalendarEventDto.externalMetadata`** — all other `externalMetadata` hits are
   the unrelated _email_ DTO or the calendar **write path** (`sync-jobs.ts`,
   `calendar-write-impl.ts`, repo input), which stay. Build agent re-confirms before removing the DTO
   field.
