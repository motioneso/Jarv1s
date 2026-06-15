# Relay handoff — Wellness feedback pass (build)

**Date:** 2026-06-15  
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/wellness-feedback`  
**Branch:** `wellness-feedback-pass`  
**Base:** `origin/main` `a061766`  
**Coordinator:** label `Wellness-Coordinator`, session `ea8e89af-52a7-4c41-9c63-09a3866ace1b`  
**Relay reason:** Session at ~68% context before any code was built — relaying to preserve full build capacity.

## What was done in this session

- Read handoff doc and spec in full.
- Invoked `coordinated-build` skill.
- Ran agentmemory recalls.
- Surveyed all 8 affected files thoroughly.
- Wrote and committed the full approved plan.
- Messaged coordinator for approval. **Plan is APPROVED.**

**Commits so far:**
- `6756209` — spec + original handoff doc (from coordinator, pre-build)
- `906d85b` — approved implementation plan `docs/superpowers/plans/2026-06-15-wellness-feedback-pass.md`

## What to build next

Execute the plan at `docs/superpowers/plans/2026-06-15-wellness-feedback-pass.md` via `coordinated-build`, **task by task, in order**. All 8 tasks still need to be built. No code has been written yet.

## Coordinator reminders (verbatim, MUST honour)

1. **B2+F3:** Tasks T1 and T3 together must surface ALL of today's check-ins in history. The one-per-day assumption in `wellness-history.tsx` (the today-exclusion filter) is the likely B2 root cause — remove it.

2. **T4 (B1+F2):** After separating frequency from time-of-day in `manage-meds-modal.tsx`, verify EVERY option adds cleanly — `once_daily`, `times_per_day` (N times + N time slots), and `as_needed`/PRN (no times). PRN add (B1) must work end-to-end.

3. **T7 (D3):** Gate the radial feeling-wheel on the **existing 'radial' tweak flag** — tweak ON = wheel, OFF = current picker. Apply to BOTH the wellness `CheckinModal` AND the Today inline check-in modal (T6/Q3). If you cannot locate an existing 'radial' tweak flag in the app code (there is none in the codebase as of this session), escalate `[DESIGN-FORK]` to the coordinator rather than guessing. **Context from this session:** There is no existing tweak system in the real app (the tweak panel exists only in the design bundle). The plan's T7 creates a `useWellnessPrefs` hook with `{ radial: boolean }` stored in localStorage at `jarvis.wellness.prefs`. This is the approach to propose to the coordinator if they want a flag rather than a toggle — but the coordinator instruction says "existing 'radial' tweak flag", so escalate first.

4. **Commit per task (green each), REAL gate exit (no `| tail` mask).** `pnpm verify:foundation` with actual exit code check.

## Key findings from code review (save tokens — don't re-read these files)

### B2 root cause
`apps/web/src/wellness/wellness-history.tsx` lines ~148–154:
```js
let rows = checkins
  .filter((c) => (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10) !== today)  // BUG: removes today
```
Fix: remove the `!== today` filter.

### B1 root cause
The frontend `manage-meds-modal.tsx` PRN path sends `scheduleTimes: null`, `timesPerDay: null` etc. The backend rejects these via the PRN validation that checks `if (value[f] != null)`. However, `null != null` is false in JS so these should pass... The likely real fix is in F2 redesign which builds a clean discriminated payload. The cleanest PRN payload is `{name, dosage, frequencyType: "as_needed"}` with NO scheduling fields at all (omit rather than null). The backend test `{name: "Prn", frequencyType: "as_needed"}` confirms this works.

### Q1
`packages/wellness/src/insights.ts` — `computeInsights` always returns insights regardless of data volume. Add guard at top: if `checkins.length < 7` OR earliest checkin < 7 days ago, return `[]`. Frontend `wellness-insights.tsx` already has empty-state rendering.

### F3
`wellness-today.tsx` `CheckinToday` component uses a single `todayCheckin: CheckinDto | null` prop. Change to `todayCheckins: readonly CheckinDto[]`, derive `latestCheckin = todayCheckins[0]`. Show latest + "Check in again" button.
`wellness-page.tsx` `openTodayEdit` needs to target the most recent same-day check-in (sort descending, take first).

### D3 — TWEAK FLAG STATUS
The design bundle (`WellnessCheckin.jsx`) uses `style` prop with values `'Guided' | 'Radial' | 'Palette'`. The real app's `checkin-modal.tsx` already has `const [pickerStyle] = useState<PickerStyle>("Guided")` with comment "Radial is deferred". There is NO existing `radial` tweak flag in the real app — escalate [DESIGN-FORK] to coordinator per the coordinator's instruction.

### Q2/Q3
`apps/web/src/today/today-page.tsx` wellness aside buttons both call `navigate("/wellness")`. Need inline modals. `MedToday` in `wellness-today.tsx` is not exported; needs `export`.

## Process
- No migration needed
- DB: `jarv1s` on :55433 (tests use this); Ben's live app uses `jarv1s_dev` (separate)
- Gate: `pnpm verify:foundation` — REAL exit code
- No push/PR/merge (coordinator's job)
- RELAY (don't `/compact`) at ~80k tokens
