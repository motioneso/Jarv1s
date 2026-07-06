# #689 Segmented Focus Implementation Plan

> **For agentic workers:** Executed inline by the coordinated-build agent (superpowers execution
> skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Calendar segmented controls onto the canonical `.jds-segmented` primitive,
centralize focus-visible behavior for touched controls, and snap off-scale font weights/radii to
existing tokens. Design audit B HIGH H10 §3.6/§3.7.

**Architecture:** No new machinery. `.jds-segmented` + `.jds-segmented__opt` already exist in
`apps/web/src/styles/components-core.css:630-668` with token-driven weights/radii and
`is-active` / `aria-pressed` state. Tasks already uses it (`tasks-page.tsx:177,246`,
`task-details-dialog.tsx:356`). Only Calendar is on the legacy `.segmented-control` dialect.
Global focus selector lives at `apps/web/src/styles.css:156-159` covering `button, a`.

**Tech Stack:** React 19, className-based DS, Playwright e2e (mock REST, no PG) for visual proof.

## Global Constraints

- Scope ONLY #689 acceptance criteria. Calendar view toggles + Week-type toggle → `.jds-segmented`.
- Do NOT migrate `notifications-page.tsx:62` or `auth-screen.tsx:51` — they use `.segmented-control`
  but are out of scope. Therefore legacy `.segmented-control` CSS will NOT be empty after migration
  → **keep it** (spec says "delete if empty").
- No `font-weight: 750` to remain in _migrated_ controls. The only `750` in legacy segmented CSS is
  `styles.css:266` (`.segmented-control button`). Other `750`s (styles.css:182,431,771,829,860;
  onboarding.css:43) are in unrelated controls — out of scope.
- Stage only each task's files; commit per task with `Co-Authored-By: Claude` trailer.
- Do not touch `docs/coordination/`.

## Premise verification (grounded on branch `coord/689-segmented-focus`)

1. Calendar Week-type toggle uses legacy `.segmented-control` + `active` —
   `apps/web/src/calendar/calendar-page.tsx:144-159` ✓
2. Calendar View toggle uses legacy `.segmented-control` + `active` —
   `apps/web/src/calendar/calendar-page.tsx:161-172` ✓
3. Tasks view switcher already on `.jds-segmented` + `is-active` —
   `apps/web/src/tasks/tasks-page.tsx:177,246` ✓ (acceptance: "share same treatment" —
   Calendar must converge to this, not vice-versa)
4. Canonical `.jds-segmented` exists with token weights/radii —
   `apps/web/src/styles/components-core.css:630-668` ✓
5. Legacy `.segmented-control` CSS still referenced by `notifications-page.tsx:62` (`.wide`)
   and `auth-screen.tsx:51` → **NOT empty after Calendar migration** → keep ✓
6. `font-weight: 750` in legacy segmented = `styles.css:266` only ✓
7. Global focus selector = `styles.css:156-159` (`button:focus-visible, a:focus-visible`) ✓
8. `<summary>` used as disclosure trigger in `chat-drawer.tsx:575,709,768` and
   `briefing-feedback-menu.tsx:50` with custom styling — adding to global focus selector is safe
   (no conflicting custom focus ring on those summary elements) ✓
9. Off-scale radii: legacy `.segmented-control` uses hardcoded `8px`/`6px`; canonical uses
   `--radius-lg`/`--radius-md` ✓
10. No `--weight-750` token exists; nearest are `--weight-semibold` (700) used by canonical active
    state and `--weight-medium` (500) by inactive ✓

## Tasks

### Task 1 — Migrate Calendar view + Week-type toggles to `.jds-segmented`

**Files:** `apps/web/src/calendar/calendar-page.tsx`

- [ ] Replace `<div className="segmented-control" aria-label="Week type">` (line 144) with
      `<div className="jds-segmented" role="group" aria-label="Week type">`.
- [ ] Replace the two child `<button className={workWeek ? "active" : ""}>` with
      `<button type="button" className={`jds-segmented\_\_opt ${workWeek ? "is-active" : ""}`} aria-pressed={workWeek}>`
      and the Full-week button with `aria-pressed={!workWeek}` + inverse `is-active`.
- [ ] Replace `<div className="segmented-control" aria-label="View">` (line 161) with
      `<div className="jds-segmented" role="group" aria-label="View">`.
- [ ] Replace `<button className={view === v ? "active" : ""}>` with
      `<button type="button" className={`jds-segmented\_\_opt ${view === v ? "is-active" : ""}`} aria-pressed={view === v}>`.
- [ ] Verify commit: `pnpm typecheck` green; commit `feat(calendar): migrate segmented controls to jds-segmented`.

### Task 2 — Extend global focus selector to `<summary>` (safe) + add focus-visible to `.jds-segmented__opt`

**Files:** `apps/web/src/styles.css`, `apps/web/src/styles/components-core.css`

- [ ] `styles.css:156` — extend selector to `button:focus-visible, a:focus-visible, summary:focus-visible`
      so `<summary>` disclosure triggers get the canonical ring. Verified safe: no custom focus ring
      on those summary elements conflicts.
- [ ] `components-core.css` — add `.jds-segmented__opt:focus-visible { box-shadow: 0 0 0 3px var(--focus-ring); outline: none; }`
      after the existing `.jds-segmented__opt[aria-pressed]` block (around line 664), matching the
      `.jds-btn:focus-visible` / `.jds-iconbtn:focus-visible` / `.jds-check` / `.jds-switch` pattern
      already in this file.
- [ ] Verify commit: `pnpm format:check && pnpm lint` green; commit `style(focus): canonical focus-visible on summary and jds-segmented`.

### Task 3 — Before/after proof + final gate

**Files:** (no source; proof artifacts)

- [ ] Capture before/after: confirm via grep that `calendar-page.tsx` no longer references
      `segmented-control`, and `tasks-page.tsx` + `calendar-page.tsx` both reference `jds-segmented`.
- [ ] Confirm no `font-weight: 750` remains in any _migrated_ control (Calendar segmented path).
      Legacy `.segmented-control` CSS `:266` is now orphaned by Calendar but still used by
      notifications/auth — leave it.
- [ ] Run `pnpm format:check && pnpm lint && pnpm typecheck`. Record exit codes.
- [ ] Push branch, open PR, report to Coordinator via `herdr-pane-message`.

## Verification

- `rg "segmented-control" apps/web/src/calendar/` → 0 matches (was 2).
- `rg "jds-segmented" apps/web/src/calendar/calendar-page.tsx` → ≥2 matches.
- `rg "font-weight:\s*750" apps/web/src/calendar/ apps/web/src/styles/components-core.css` → 0 matches.
- Exit codes for `format:check`, `lint`, `typecheck` all 0.
