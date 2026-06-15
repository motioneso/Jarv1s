# Spec — Wellness feedback pass (8 agentation notes, 2026-06-15)

**Status:** approved (coordinator, on Ben's behalf — Ben chose "all in one pass" and refines via
agentation re-annotation). **Base:** `origin/main` `a061766` (wellness #256 + calendar #258 merged).
**Branch:** `wellness-feedback-pass`. **No GitHub CI** (disabled — billing); gate = local
`pnpm verify:foundation` REAL exit 0 + Codex review.

Source: Ben's live testing of the merged Wellness feature via agentation. 8 notes, addressed below.
All items touch `apps/web/src/wellness/*`, `apps/web/src/today/*` (Today page), and possibly
`packages/wellness/*`. **No DB migration is required** — `wellness_checkins` already supports
multiple timestamped rows/day (see `packages/wellness/sql/0082_wellness_checkins.sql:1`).

## Items

### Bugs (live regressions — fix first, with tests)

**B1 (#3) — "As needed (PRN)" can't be added.** In `manage-meds-modal.tsx`, selecting the PRN option
fails to add a medication. Make the PRN path build a VALID `CreateMedicationRequest` (`as_needed`, no
times, `timesPerDay: null`) and ensure the Add handler submits successfully. Add a test that adding a
PRN med succeeds. (This is the same modal touched by the earlier M6 fix — verify ALL options add
cleanly: once-daily, the new frequency options from F2, and PRN.)

**B2 (#4) — today's check-in doesn't appear in history.** A check-in completed today shows
"No check-ins match." in `WellnessHistory`. Backend stores multiple timestamped check-ins/day
correctly, so this is a frontend bug — investigate the history query/range, date filtering, and
query-key invalidation after a check-in create/PATCH. Likely a one-per-day assumption or a
date-range off-by-one. Fix so today's check-in(s) appear immediately after creation. Add coverage.

### Quick wins

**Q1 (#1) — insights empty/low-data state.** `WellnessInsights` must NOT render misleading insights
(especially "missed medication" / adherence) when there's insufficient history. Add a low-data guard:
until there are enough data points (≈ a week of data since first check-in/med log — pick a clear,
documented threshold), render a friendly empty state ("Insights appear after about a week of
check-ins") instead of computed/zeroed insights. Don't show a missed-medication insight derived from
near-zero data.

**Q2 (#5) — Today "Meds" widget opens an inline log modal.** On the Today page, the "Meds" widget/
button should open a medication-logging modal in place (log a dose) without navigating to /wellness.
Reuse the existing dose-log UI; invalidate the relevant queries on success.

**Q3 (#6) — Today "Check in" widget opens an inline modal.** Same idea: the Today "Check in" widget
opens the check-in modal in place (see D3 — it should use the radial picker when that tweak is on).

### Design rethinks (Ben approved "my approach"; refine via re-annotation)

**F2 (#2) — medication frequency model: separate frequency from time-of-day.** Today's dropdown
conflates them ("Morning (once daily)", "Evening (twice daily)", "As needed (PRN)") — Ben: "Evening
doesn't necessarily mean twice daily." Redesign `manage-meds-modal.tsx`:

- Pick **frequency** independently: `once_daily`, `times_per_day` (choose N), `as_needed` (PRN).
  (These already exist in `MEDICATION_FREQUENCY_TYPES`.)
- Pick **time(s) of day** separately: for `once_daily` one time (e.g. a time input or morning/evening
  preset that is just a time, not a frequency); for `times_per_day` N time slots; for `as_needed`
  none. Remove the conflated presets. Ensure every resulting payload is a valid
  `CreateMedicationRequest`. Coordinates with B1 (PRN) — all paths must add cleanly.

**F3 (#7) — multiple check-ins per day.** Ben: "Check-ins aren't just once a day — the user should be
able to check in any time." Backend already supports this (no migration). Update the UI:

- The `<CheckinToday>` "Today's check-in" card should not imply a single daily check-in. Allow adding
  a NEW check-in any time (a "Check in" action that creates a new timestamped row), while keeping the
  existing per-check-in Edit (PATCH) for correcting a specific entry.
- History (`WellnessHistory`) lists ALL check-ins (multiple per day), timestamped. Fixes/relates to
  B2.
- Decide and document the "today" card behavior (e.g., show the latest check-in + a "check in again"
  action, or a small list of today's entries). Reasonable call; Ben will refine.

**D3 (#8) — radial feeling-wheel picker.** Ben: "This should actually be the feeling-wheel version,
labeled radial in the tweaks." Wire the radial/feeling-wheel check-in picker into `CheckinModal`,
gated by the existing **"radial"** tweak flag (find it in the tweaks panel / settings). Design
reference (read-only): `WellnessCheckin.jsx` + `Wellness.jsx` in the design bundle
`/home/ben/.claude/jobs/914af5c0/tmp/design/jarvis-design-system/project/ui_kits/jarvis-app/`. This
was the deferred stretch from the original wellness port; now in scope. When the radial tweak is on,
the check-in modal (including the Today-page inline one from Q3) uses the wheel; otherwise the
existing picker.

## Constraints / invariants

- No edits to applied migrations; no new migration expected (confirm — if F3 surprises you with a
  constraint, STOP and escalate, don't edit 0082).
- Keep the partial-update PATCH semantics intact (fetch-first, omitted=preserve) — see agentmemory
  "partial-update data-loss" lesson; don't regress it.
- File-size limit 1000 lines; decompose. No secrets in responses/logs. Owner-only RLS.
- Match existing code style. Stage only changed paths.

## Verification

`pnpm verify:foundation` REAL exit 0 (no CI). Add tests for B1, B2, F2 (valid payloads incl. PRN),
F3 (multiple check-ins surfaced). Manual: the agentation notes should each be resolved on the running
dev app (`jarv1s_dev`, :5173). Then Codex adversarial code review → remediate → coordinator merges.
